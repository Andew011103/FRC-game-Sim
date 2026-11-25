import { outlineOf } from '../../robots/chassis';
import type { SubsystemDef } from '../../robots/types';
import { add, conjugate, normalize, rotate, scale, sub, v3, type Vec3 } from '../math';
import {
  numberOr,
  resolveSettings,
  shapeCenter,
  shapeFields,
  shapePart,
  sideOr,
  sideShape,
  type PartView,
  type Shape,
  type Subsystem,
  type SubsystemContext,
  type SubsystemEnv,
  type SubsystemSpec,
} from './types';

type OuttakeDirection = 'away' | 'front' | 'back' | 'left' | 'right';

interface IntakeSettings extends Shape {
  rate: number;
  reach: number;
  outtake: boolean;
  outtakeDirection: OuttakeDirection;
  outtakeSpeed: number;
}

const DIRECTIONS: Record<Exclude<OuttakeDirection, 'away'>, Vec3> = {
  front: v3(1, 0, 0),
  back: v3(-1, 0, 0),
  left: v3(0, 0, -1),
  right: v3(0, 0, 1),
};

/** Outtaken pieces fan out by up to this angle either side, and vary in speed by this share. */
const OUT_SPREAD = (12 * Math.PI) / 180;
const OUT_SPEED_JITTER = 0.12;

/**
 * Picks up loose game pieces that touch its box while the intake button is
 * held. If it can outtake, the outtake button pushes held pieces back out.
 */
class Intake implements Subsystem {
  readonly type = 'intake';
  readonly parts: PartView[];
  private cooldown = 0;
  /** Where across the box the last outtaken piece left from. */
  private lastSlot = -1;
  private readonly center: Vec3;
  private readonly halfSize: Vec3;
  /** Pieces further than this from the robot's centre cannot be touching the box. */
  private readonly range: number;
  /** Which way pieces leave when outtaking, in the robot's own space. */
  private readonly outDir: Vec3;

  constructor(
    private readonly settings: IntakeSettings,
    env: SubsystemEnv,
  ) {
    this.center = shapeCenter(settings, env.robot);
    this.halfSize = v3(settings.sizeX / 2, settings.sizeY / 2, settings.sizeZ / 2);
    this.range = Math.hypot(Math.abs(this.center.x) + this.halfSize.x, Math.abs(this.center.z) + this.halfSize.z) + 0.3 + settings.reach;
    this.parts = [shapePart(settings, env.robot, { visible: false })];
    this.outDir =
      settings.outtakeDirection === 'away'
        ? normalize(v3(this.center.x, 0, this.center.z))
        : DIRECTIONS[settings.outtakeDirection];
  }

  /**
   * Pushes one held piece out of the box. Pieces leave anywhere across the
   * box's width, at slightly different angles, speeds and moments, so they
   * come out as a loose spray and not a single file.
   */
  private expel({ sim, robot }: SubsystemContext): void {
    const piece = robot.takePiece();
    if (piece === undefined) return;
    const { center, halfSize, outDir } = this;
    const radius = sim.pieces.radii[piece];
    const across = v3(-outDir.z, 0, outDir.x);
    const halfAcross = Math.abs(across.x) * halfSize.x + Math.abs(across.z) * halfSize.z;
    // As many side-by-side slots as pieces fit across; never the same slot twice running.
    const slots = Math.max(1, Math.floor(halfAcross / radius));
    let slot = Math.floor(sim.random() * slots);
    if (slots > 1 && slot === this.lastSlot) slot = (slot + 1 + Math.floor(sim.random() * (slots - 1))) % slots;
    this.lastSlot = slot;
    const room = Math.max(0, halfAcross - radius);
    const offset = slots > 1 ? -room + (2 * room * slot) / (slots - 1) : 0;

    const angle = (sim.random() - 0.5) * 2 * OUT_SPREAD;
    const direction = add(scale(outDir, Math.cos(angle)), scale(across, Math.sin(angle)));
    const speed = this.settings.outtakeSpeed * (1 + (sim.random() - 0.5) * 2 * OUT_SPEED_JITTER);
    const reach = Math.abs(outDir.x) * halfSize.x + Math.abs(outDir.z) * halfSize.z + radius + 0.02;
    const rot = robot.rotation();
    const from = add(robot.position(), rotate(rot, add(center, add(scale(outDir, reach), scale(across, offset)))));
    sim.pieces.release(piece, from, add(robot.pointVelocity(from), scale(rotate(rot, direction), speed)));
    this.cooldown = (0.4 + 1.2 * sim.random()) / this.settings.rate;
  }

  step(ctx: SubsystemContext): void {
    const { sim, robot, input, dt } = ctx;
    const outtaking = input.outtake && this.settings.outtake;
    this.parts[0].visible = input.intake || outtaking;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (outtaking) {
      if (this.cooldown <= 0) this.expel(ctx);
      return;
    }
    if (!input.intake || this.cooldown > 0) return;
    if (robot.held.length >= robot.capacity()) return;

    const origin = robot.position();
    const inverseRot = conjugate(robot.rotation());
    const pieces = sim.pieces;
    const { center, halfSize, range } = this;

    for (let i = 0; i < pieces.count; i++) {
      if (pieces.heldBy[i] !== -1) continue;
      const dx = pieces.cur[i * 3] - origin.x;
      const dz = pieces.cur[i * 3 + 2] - origin.z;
      if (dx * dx + dz * dz > range * range) continue;

      const local = rotate(inverseRot, sub(v3(pieces.cur[i * 3], pieces.cur[i * 3 + 1], pieces.cur[i * 3 + 2]), origin));
      // Distance from the piece's centre to the nearest point of the box.
      const gapX = Math.max(0, Math.abs(local.x - center.x) - halfSize.x);
      const gapY = Math.max(0, Math.abs(local.y - center.y) - halfSize.y);
      const gapZ = Math.max(0, Math.abs(local.z - center.z) - halfSize.z);
      // Rollers pull a piece in from a little beyond where the box would touch it.
      const pull = pieces.radii[i] + this.settings.reach;
      if (gapX * gapX + gapY * gapY + gapZ * gapZ > pull * pull) continue;

      robot.store(sim, i);
      this.cooldown = 1 / (this.settings.rate * robot.boost.intakeSpeed);
      return;
    }
  }

  reset(): void {
    this.cooldown = 0;
    this.parts[0].visible = false;
  }
}

export const intakeSpec: SubsystemSpec = {
  type: 'intake',
  label: 'Intake',
  description: 'Collects any game piece that touches this box, or comes within its reach, while the intake button is held.',
  fields: [
    ...shapeFields('#22c55e'),
    { key: 'rate', label: 'Pickup rate', kind: 'number', default: 8, min: 1, max: 30, unit: 'pieces/s' },
    { key: 'reach', label: 'Pulls pieces in from', kind: 'number', default: 0.04, min: 0, max: 0.3, step: 0.01, unit: 'm away' },
    { key: 'outtake', label: 'Can outtake (push pieces back out)', kind: 'boolean', default: false },
    {
      key: 'outtakeDirection',
      label: 'Pieces leave toward',
      kind: 'choice',
      default: 'away',
      options: [
        { value: 'away', label: 'Away from the robot' },
        { value: 'front', label: 'Front' },
        { value: 'back', label: 'Back' },
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
      ],
      showIf: 'outtake',
    },
    { key: 'outtakeSpeed', label: 'Outtake speed', kind: 'number', default: 3, min: 0.5, max: 12, step: 0.1, unit: 'm/s', showIf: 'outtake' },
  ],
  upgrade: (def, chassis) => {
    // Older files gave a side, a width and a reach past the bumper.
    const side = sideOr(def.side, 'front');
    const reach = numberOr(def.reach, 0.22);
    return {
      ...sideShape(side, outlineOf(chassis)[side], Math.max(0.05, reach - 0.07), numberOr(def.width, 0.6)),
      bottom: 0.02,
      sizeY: 0.2,
      ...def,
    };
  },
  create: (def: SubsystemDef, env) =>
    new Intake(resolveSettings<IntakeSettings>(intakeSpec, def, env.robot.def.chassis), env),
};
