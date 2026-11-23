import RAPIER, { type RigidBody, type World } from '@dimforge/rapier3d-compat';
import type { PieceGroup } from '../games/types';
import { MOVING_GROUPS } from './groups';
import { v3, type Vec3 } from './math';

/** heldBy value for a piece that is loose on the field. */
const LOOSE = -1;
/** heldBy value for a piece that has left the field, for example into a human player's hands. */
export const OFF_FIELD = -3;
/** heldBy value for a spare piece waiting to be preloaded into a robot. */
const RESERVE = -2;
/** Steps after which a shot piece that never reached the floor stops showing its effect. */
const LAUNCH_STEPS = 360;

/**
 * Every game piece in a match. A piece is either loose (a live physics
 * body) or held inside a robot (its body is switched off until it is released).
 */
export class PieceSet {
  readonly bodies: RigidBody[] = [];
  readonly radii: number[] = [];
  readonly colors: string[] = [];
  /** Index of the robot holding each piece, -1 when loose, -2 when in reserve. */
  readonly heldBy: number[] = [];
  /** The robot that last had each piece inside it, or -1. Says whose score a piece is when it lands in a goal. */
  readonly lastRobot: number[] = [];
  /**
   * The robot that shot each piece, while it is still in the air, or -1. Only
   * for drawing: a shot piece shows its shooter's game piece effect until it lands.
   */
  readonly launchedBy: number[] = [];
  private readonly launchAge: number[] = [];
  /** Positions before and after the latest step, three numbers per piece. */
  readonly prev: Float32Array;
  readonly cur: Float32Array;

  /** reserve is how many spare pieces to create for robots to start with. */
  constructor(world: World, groups: PieceGroup[], reserve = 0) {
    for (const group of groups) {
      for (const [x, z] of group.positions) this.create(world, group, x, z, LOOSE);
    }
    if (groups.length > 0) {
      for (let i = 0; i < reserve; i++) this.create(world, groups[0], 0, 0, RESERVE);
    }
    this.prev = new Float32Array(this.count * 3);
    this.cur = new Float32Array(this.count * 3);
    this.capture();
    this.prev.set(this.cur);
  }

  get count(): number {
    return this.bodies.length;
  }

  /** Call after each physics step to record where every loose piece is. */
  capture(): void {
    this.prev.set(this.cur);
    for (let i = 0; i < this.count; i++) {
      if (this.heldBy[i] !== LOOSE) continue;
      const t = this.bodies[i].translation();
      this.cur[i * 3] = t.x;
      this.cur[i * 3 + 1] = t.y;
      this.cur[i * 3 + 2] = t.z;
      // A shot is over once it reaches the floor, or after a few seconds caught on something.
      if (this.launchedBy[i] >= 0 && (t.y <= this.radii[i] + 0.03 || ++this.launchAge[i] > LAUNCH_STEPS)) this.launchedBy[i] = -1;
    }
  }

  position(i: number): Vec3 {
    return v3(this.cur[i * 3], this.cur[i * 3 + 1], this.cur[i * 3 + 2]);
  }

  /** Takes a loose piece off the field and into a robot. */
  hold(i: number, robotIndex: number): void {
    this.bodies[i].setEnabled(false);
    this.heldBy[i] = robotIndex;
    this.launchedBy[i] = -1;
    if (robotIndex >= 0) this.lastRobot[i] = robotIndex;
  }

  /** Hands a spare piece to a robot. Returns its index, or undefined when none are left. */
  takeReserve(robotIndex: number): number | undefined {
    const i = this.heldBy.indexOf(RESERVE);
    if (i === -1) return undefined;
    this.heldBy[i] = robotIndex;
    this.lastRobot[i] = robotIndex;
    return i;
  }

  /** Puts a piece on the field at a position, moving at a velocity. */
  release(i: number, position: Vec3, velocity: Vec3): void {
    const body = this.bodies[i];
    body.setEnabled(true);
    body.setTranslation(position, true);
    body.setLinvel(velocity, true);
    body.setAngvel(v3(), true);
    this.heldBy[i] = LOOSE;
    this.cur[i * 3] = position.x;
    this.cur[i * 3 + 1] = position.y;
    this.cur[i * 3 + 2] = position.z;
  }

  /** Marks a piece just released as shot by a robot, so it is drawn with that robot's effect until it lands. */
  launch(i: number, robotIndex: number): void {
    this.launchedBy[i] = robotIndex;
    this.launchAge[i] = 0;
  }

  private create(world: World, group: PieceGroup, x: number, z: number, state: number): void {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, group.radius, z)
        // Stands in for rolling resistance on carpet: a ball rolled at 3 m/s stops after about 2 m.
        .setAngularDamping(4)
        // Stops fast shots passing through thin walls.
        .setCcdEnabled(true),
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(group.radius)
        .setMass(group.mass)
        .setRestitution(0.45)
        .setFriction(0.5)
        .setCollisionGroups(MOVING_GROUPS),
      body,
    );
    if (state !== LOOSE) body.setEnabled(false);
    this.bodies.push(body);
    this.radii.push(group.radius);
    this.colors.push(group.color);
    this.heldBy.push(state);
    this.lastRobot.push(-1);
    this.launchedBy.push(-1);
    this.launchAge.push(0);
  }
}
