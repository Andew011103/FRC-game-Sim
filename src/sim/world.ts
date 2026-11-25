import RAPIER, { type RigidBody, type World } from '@dimforge/rapier3d-compat';
import type { Alliance, BoxElement, GameDefinition, GameRules, PropElement } from '../games/types';
import { NEUTRAL_INPUT, type DriverInput } from '../input/types';
import type { RobotDefinition } from '../robots/types';
import { Match, type MatchMode } from './match';
import { quatFromEuler, seededRandom, v3, type Quat, type Vec3 } from './math';
import { FIELD_GROUPS, LOW_BAR_GROUPS, MOVING_GROUPS } from './groups';
import { PieceSet } from './pieces';
import { SimRobot } from './robot';

/** The simulation always advances in steps of this many seconds. */
export const SIM_DT = 1 / 60;
/** How long a piece lies outside the field before it is thrown back in. */
const STRAY_RETURN_SECONDS = 1;

let physicsReady: Promise<void> | null = null;

/** Loads the physics engine. Must finish before a SimWorld is created. */
export function initPhysics(): Promise<void> {
  physicsReady ??= RAPIER.init();
  return physicsReady;
}

export interface SimProp {
  def: PropElement;
  body: RigidBody;
  prevPos: Vec3;
  prevRot: Quat;
}

/** One running field: the physics world plus everything on it. No rendering. */
export class SimWorld {
  readonly world: World;
  readonly robots: SimRobot[] = [];
  readonly props: SimProp[] = [];
  readonly pieces: PieceSet;
  /** Walls plus the game's own fixed elements, for the renderer to draw. */
  readonly statics: BoxElement[];
  /** Repeatable random numbers for anything in the simulation that varies. */
  readonly random: () => number;

  /** The game's scoring logic and the match clock; both null for games without rules. */
  readonly rules: GameRules | null;
  readonly match: Match | null;
  /** Pieces currently outside the field, and for how many seconds each has been. */
  private readonly strays = new Map<number, number>();

  constructor(
    readonly game: GameDefinition,
    /** `robots` is how many robots will be added, when that is more than the game's usual starting spots. */
    options: { seed?: number; mode?: MatchMode; robots?: number; pauses?: boolean } = {},
  ) {
    this.world = new RAPIER.World(v3(0, -9.81, 0));
    this.world.timestep = SIM_DT;
    this.random = seededRandom(options.seed ?? 1);
    this.rules = game.createRules?.() ?? null;
    this.match = this.rules ? new Match(this.rules.phases, options.mode ?? 'practice', options.pauses ?? false) : null;

    const { length, width } = game.field;
    this.addFixedBox({ size: [length + 8, 1, width + 8], position: [0, -0.5, 0], color: '#000000' }, 0.9);

    this.statics = [...perimeterWalls(game), ...game.statics];
    // Walls and field structures are slick: their friction multiplies whatever touches them, so a
    // robot's bumpers (0.25) slide along them at 0.25 x WALL_FRICTION instead of dragging, while
    // robots still grip each other as before. The floor keeps its own grip for the fuel.
    for (const element of this.statics) this.addFixedBox(element, WALL_FRICTION, RAPIER.CoefficientCombineRule.Multiply);

    for (const def of game.props) {
      const rot = quatFromEuler(...(def.rotation ?? [0, 0, 0]));
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(...def.position)
          .setRotation(rot),
      );
      const [sx, sy, sz] = def.size;
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
          .setMass(def.mass)
          .setFriction(0.7)
          .setCollisionGroups(MOVING_GROUPS),
        body,
      );
      this.props.push({ def, body, prevPos: v3(...def.position), prevRot: rot });
    }

    const reserve = (game.preload ?? 0) * Math.max(game.spawns.length, options.robots ?? 0);
    this.pieces = new PieceSet(this.world, game.pieces ?? [], reserve);
    this.rules?.init?.(this);
  }

  /** Puts a robot on one of the game's starting spots, or at a place of the caller's choosing on that alliance. */
  addRobot(def: RobotDefinition, spawnIndex = 0, at?: { x: number; z: number; yaw: number }): SimRobot {
    const spawn = { ...this.game.spawns[spawnIndex % this.game.spawns.length], ...at };
    const robot = new SimRobot(this.world, def, spawn, SIM_DT, this.robots.length);
    this.robots.push(robot);

    // Robots start holding the game's preload, or as much of it as fits.
    const preload = Math.min(this.game.preload ?? 0, robot.capacity());
    for (let i = 0; i < preload; i++) {
      const piece = this.pieces.takeReserve(robot.index);
      if (piece === undefined) break;
      robot.held.push(piece);
    }
    return robot;
  }

  /**
   * Where a robot standing at a spot should send its game pieces: its goal,
   * or a place to pass them to when the game says it cannot score from there.
   */
  aimFor(alliance: Alliance, from: Vec3, robot?: SimRobot): { point: Vec3; pass: boolean } | null {
    // Whether to pass goes by the whole robot: where its centre is and how far its outline reaches along the field.
    const heading = robot?.heading() ?? 0;
    const reach = robot ? Math.abs(robot.half.x * Math.cos(heading)) + Math.abs(robot.half.z * Math.sin(heading)) : 0;
    const pass = this.game.passTarget?.(alliance, robot?.position() ?? from, reach);
    if (pass) return { point: v3(...pass), pass: true };
    const point = this.targetFor(alliance, from);
    return point ? { point, pass: false } : null;
  }

  /** The closest point an alliance scores at, or null if the game has none. */
  targetFor(alliance: Alliance, from: Vec3): Vec3 | null {
    let best: Vec3 | null = null;
    let bestDistance = Infinity;
    for (const target of this.game.targets ?? []) {
      if (target.alliance !== alliance) continue;
      const [x, y, z] = target.position;
      const distance = Math.hypot(x - from.x, z - from.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = v3(x, y, z);
      }
    }
    return best;
  }

  /** Advances one fixed step. inputs[i] drives robots[i]. */
  step(inputs: DriverInput[]): void {
    // Robots stop responding once the game says the drivers' time is up.
    // They also stand still through the countdown and the pause after auto.
    const driving = (this.rules?.driving?.(this) ?? true) && !this.match?.holding;
    this.robots.forEach((robot, i) => robot.step(this, driving ? (inputs[i] ?? NEUTRAL_INPUT) : NEUTRAL_INPUT));
    for (const prop of this.props) {
      const t = prop.body.translation();
      const r = prop.body.rotation();
      prop.prevPos = v3(t.x, t.y, t.z);
      prop.prevRot = { x: r.x, y: r.y, z: r.z, w: r.w };
    }
    this.world.step();
    this.pieces.capture();
    this.returnStrays();

    if (this.rules && this.match && !this.match.finished) {
      // Nothing happens on the field before the countdown ends.
      if (this.match.holdReason !== 'start') this.rules.step(this);
      const ended = this.match.advance(SIM_DT);
      if (ended) this.rules.phaseEnded(this, ended);
    }
  }

  /**
   * A piece that has left the field is thrown back in after a moment, from
   * just outside the wall where it went out, as a person standing there would.
   */
  private returnStrays(): void {
    const { pieces } = this;
    const halfLength = this.game.field.length / 2;
    const halfWidth = this.game.field.width / 2;
    for (let i = 0; i < pieces.count; i++) {
      if (pieces.heldBy[i] !== -1) continue;
      const k = i * 3;
      const x = pieces.cur[k];
      const z = pieces.cur[k + 2];
      const radius = pieces.radii[i];
      const outside = Math.abs(x) > halfLength + radius || Math.abs(z) > halfWidth + radius;
      if (!outside) {
        if (this.strays.size > 0) this.strays.delete(i);
        continue;
      }
      const waited = (this.strays.get(i) ?? 0) + SIM_DT;
      if (waited < STRAY_RETURN_SECONDS) {
        this.strays.set(i, waited);
        continue;
      }
      this.strays.delete(i);

      const clampTo = (value: number, limit: number): number => Math.min(limit, Math.max(-limit, value));
      const from = v3(clampTo(x, halfLength + 0.3), 1.2, clampTo(z, halfWidth + 0.3));
      // Aimed at the nearest floor a little way inside, give or take.
      const bearing =
        Math.atan2(clampTo(z, halfWidth - 1) - from.z, clampTo(x, halfLength - 1) - from.x) + (this.random() - 0.5) * 0.6;
      const speed = 2.5 + this.random();
      pieces.release(i, from, v3(Math.cos(bearing) * speed, 2, Math.sin(bearing) * speed));
    }
  }

  /**
   * Turns a copy of the field that was only drawn from snapshots into one
   * that is simulated, as when a player takes a room over from a host who
   * left: every body is put where the copy shows it, at rest, and woken.
   */
  takeOver(): void {
    const still = v3();
    for (const robot of this.robots) {
      robot.body.setLinvel(still, true);
      robot.body.setAngvel(still, true);
    }
    for (const prop of this.props) prop.body.wakeUp();
    const { pieces } = this;
    for (let i = 0; i < pieces.count; i++) {
      const body = pieces.bodies[i];
      if (pieces.heldBy[i] !== -1) {
        body.setEnabled(false);
        continue;
      }
      body.setEnabled(true);
      body.setTranslation(pieces.position(i), true);
      body.setLinvel(still, true);
      body.setAngvel(still, true);
    }
  }

  dispose(): void {
    this.world.free();
  }

  private addFixedBox(element: BoxElement, friction: number, combine = RAPIER.CoefficientCombineRule.Average): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(...element.position)
        .setRotation(quatFromEuler(...(element.rotation ?? [0, 0, 0]))),
    );
    const [sx, sy, sz] = element.size;
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
        .setFriction(friction)
        .setFrictionCombineRule(combine)
        .setCollisionGroups(element.lowBar ? LOW_BAR_GROUPS : FIELD_GROUPS),
      body,
    );
  }
}

/**
 * Friction of walls and field structures, multiplied by that of what touches
 * them: 0.1 against a robot's bumpers, 0.2 against fuel. It was 0.43 against
 * bumpers, which held a robot driving into a wall almost still.
 */
export const WALL_FRICTION = 0.4;

function perimeterWalls(game: GameDefinition): BoxElement[] {
  const { length, width, wallHeight: h } = game.field;
  const t = 0.1;
  const side = { color: '#cbd5e1', opacity: 0.25 };
  return [
    { size: [t, h, width + 2 * t], position: [-(length / 2 + t / 2), h / 2, 0], color: '#3b82f6', opacity: 0.35 },
    { size: [t, h, width + 2 * t], position: [length / 2 + t / 2, h / 2, 0], color: '#ef4444', opacity: 0.35 },
    { size: [length, h, t], position: [0, h / 2, -(width / 2 + t / 2)], ...side },
    { size: [length, h, t], position: [0, h / 2, width / 2 + t / 2], ...side },
  ];
}
