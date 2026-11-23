import type { World } from '@dimforge/rapier3d-compat';
import type { DriverInput } from '../../input/types';
import type { ChassisDef, SubsystemDef } from '../../robots/types';
import { clamp, v3, type Vec3 } from '../math';
import type { SimRobot } from '../robot';
import type { SimWorld } from '../world';

// A subsystem is one mechanism on a robot (intake, hopper, shooter, blocker).
// Each is a box the designer sizes and places anywhere on the robot.
// Each type declares its settings as a list of fields, so robot files are
// plain data and the robot builder can generate its form from the same list.

export type Side = 'front' | 'back' | 'left' | 'right';

interface FieldBase {
  key: string;
  label: string;
  /** Only shown in the builder when this other (boolean) setting is on. */
  showIf?: string;
  /** Hidden in the builder when this other (boolean) setting is on. */
  hideIf?: string;
  /** Shape fields are listed together in the builder, apart from what the mechanism does. */
  group?: 'shape';
}

export type FieldSpec =
  | (FieldBase & {
      kind: 'number';
      default: number;
      min: number;
      max: number;
      /** Slider increment in the builder. Use 1 for whole numbers. */
      step?: number;
      unit?: string;
    })
  | (FieldBase & { kind: 'boolean'; default: boolean })
  | (FieldBase & { kind: 'choice'; default: string; options: { value: string; label: string }[] })
  | (FieldBase & { kind: 'color'; default: string });

/**
 * Every subsystem is a box the robot's designer sizes and places freely.
 * x runs back (-) to front (+), z runs left (-) to right (+), and bottom is
 * the height of the box's underside above the floor when the robot is at rest.
 */
export interface Shape {
  x: number;
  z: number;
  bottom: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  color: string;
}

export function shapeFields(color: string): FieldSpec[] {
  const group = 'shape' as const;
  const step = 0.01;
  return [
    { key: 'x', label: 'Position, back to front', kind: 'number', default: 0, min: -1, max: 1, step, unit: 'm', group },
    { key: 'z', label: 'Position, left to right', kind: 'number', default: 0, min: -1, max: 1, step, unit: 'm', group },
    { key: 'bottom', label: 'Height off the floor', kind: 'number', default: 0.3, min: 0, max: 1.6, step, unit: 'm', group },
    { key: 'sizeX', label: 'Length', kind: 'number', default: 0.3, min: 0.02, max: 1.2, step, unit: 'm', group },
    { key: 'sizeZ', label: 'Width', kind: 'number', default: 0.3, min: 0.02, max: 1.2, step, unit: 'm', group },
    { key: 'sizeY', label: 'Height', kind: 'number', default: 0.3, min: 0.02, max: 1.4, step, unit: 'm', group },
    { key: 'color', label: 'Colour', kind: 'color', default: color, group },
  ];
}

/** How a part is turned, in degrees: about the up axis, then tipped front up, then rolled about its length. */
export interface Turn {
  yaw: number;
  pitch: number;
  roll: number;
}

/** Fields that turn a part any way at all, for parts that only sit there (lights, structures). */
export function turnFields(): FieldSpec[] {
  const group = 'shape' as const;
  const angle = { kind: 'number' as const, default: 0, min: -180, max: 180, step: 1, unit: '°', group };
  return [
    { key: 'yaw', label: 'Turn (about the up axis)', ...angle },
    { key: 'pitch', label: 'Tilt (front up or down)', ...angle },
    { key: 'roll', label: 'Roll (side up or down)', ...angle },
  ];
}

const RAD = Math.PI / 180;

/** A point in a part's own space, turned the way the part is (yaw, then pitch, then roll, as the renderer draws it). */
export function turnPoint(p: Vec3, turn: Turn): Vec3 {
  const [y, z, x] = [turn.yaw * RAD, turn.pitch * RAD, turn.roll * RAD];
  // Roll about x, then pitch about z, then yaw about y.
  const a = v3(p.x, p.y * Math.cos(x) - p.z * Math.sin(x), p.y * Math.sin(x) + p.z * Math.cos(x));
  const b = v3(a.x * Math.cos(z) - a.y * Math.sin(z), a.x * Math.sin(z) + a.y * Math.cos(z), a.z);
  return v3(b.x * Math.cos(y) + b.z * Math.sin(y), b.y, -b.x * Math.sin(y) + b.z * Math.cos(y));
}

/** The same turn as a quaternion, for physics. */
export function turnQuat(turn: Turn): { x: number; y: number; z: number; w: number } {
  type Q = [number, number, number, number];
  const mul = (a: Q, b: Q): Q => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  const half = (deg: number) => (deg * RAD) / 2;
  const qy: Q = [0, Math.sin(half(turn.yaw)), 0, Math.cos(half(turn.yaw))];
  const qz: Q = [0, 0, Math.sin(half(turn.pitch)), Math.cos(half(turn.pitch))];
  const qx: Q = [Math.sin(half(turn.roll)), 0, 0, Math.cos(half(turn.roll))];
  const [x, y, z, w] = mul(mul(qy, qz), qx);
  return { x, y, z, w };
}

/** How far a turned box reaches above (and below) its centre. */
export function turnedHalfHeight(size: [number, number, number], turn: Turn): number {
  return (
    Math.abs(turnPoint(v3(size[0] / 2, 0, 0), turn).y) +
    Math.abs(turnPoint(v3(0, size[1] / 2, 0), turn).y) +
    Math.abs(turnPoint(v3(0, 0, size[2] / 2), turn).y)
  );
}

/** A box the renderer draws for a subsystem. The subsystem moves and shows or hides it. */
export interface PartView {
  /** A box, or an upright drum whose two diameters are the first and last sizes. */
  shape?: 'box' | 'cylinder';
  /**
   * A box with its corners cut: its outline seen from above, scaled to a box
   * of size 1, so it stretches with the part's size like any box.
   */
  outline?: { x: number; z: number }[];
  /** Lights: drawn glowing in their colour, which can change from moment to moment. */
  glow?: boolean;
  size: [number, number, number];
  color: string;
  opacity?: number;
  /** Centre, in the robot's own space. */
  position: Vec3;
  /** Radians: yaw about the robot's up axis, then pitch upward, then roll about the part's own length. */
  yaw: number;
  pitch: number;
  roll?: number;
  visible: boolean;
}

export interface SubsystemContext {
  sim: SimWorld;
  robot: SimRobot;
  input: DriverInput;
  dt: number;
}

export interface Subsystem {
  readonly type: string;
  readonly parts: PartView[];
  step(ctx: SubsystemContext): void;
  /** Returns the mechanism to its starting position. */
  reset(): void;
  /** How many game pieces this subsystem lets the robot hold right now. */
  capacity?(): number;
  /** Whether a deployable mechanism is currently out. */
  readonly deployed?: boolean;
  /**
   * For mechanisms the whole robot has to point: the turn rate they want, in
   * radians per second counter-clockwise, or null when they have no say.
   * Asked only while the shoot button is held.
   */
  chassisTurn?(ctx: SubsystemContext): number | null;
  /** For hoppers: open on top, so fuel falling onto it drops straight in. */
  readonly openTop?: boolean;
  /** For shooters: whether it is firing right now, and whether at a spot to pass to rather than its goal. */
  readonly shooting?: boolean;
  readonly passing?: boolean;
  /** For climbers: the tower level currently reached, 0 when not climbing. */
  readonly climbLevel?: number;
}

export interface SubsystemEnv {
  world: World;
  robot: SimRobot;
}

export interface SubsystemSpec {
  type: string;
  label: string;
  description: string;
  fields: FieldSpec[];
  /**
   * Fills in settings a robot file leaves out with values that suit its
   * chassis, and converts files written before subsystems were free boxes.
   */
  upgrade(def: SubsystemDef, chassis: ChassisDef): SubsystemDef;
  create(def: SubsystemDef, env: SubsystemEnv): Subsystem;
}

const SIDE_NAMES: Side[] = ['front', 'back', 'left', 'right'];

/** Reads a subsystem's settings from robot data, filling defaults and clamping to each field's limits. */
export function resolveSettings<T>(spec: SubsystemSpec, def: SubsystemDef, chassis: ChassisDef): T {
  return resolveFields<T>(spec.fields, spec.upgrade(def, chassis));
}

/** Reads a set of fields from untrusted data, filling defaults and clamping numbers to their limits. */
export function resolveFields<T>(fields: FieldSpec[], data: Record<string, unknown>): T {
  const settings: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = data[field.key];
    if (field.kind === 'number') {
      const value = typeof raw === 'number' && Number.isFinite(raw) ? clamp(raw, field.min, field.max) : field.default;
      settings[field.key] = field.step === 1 ? Math.round(value) : value;
    } else if (field.kind === 'boolean') {
      settings[field.key] = typeof raw === 'boolean' ? raw : field.default;
    } else if (field.kind === 'choice') {
      settings[field.key] = field.options.some((option) => option.value === raw) ? raw : field.default;
    } else {
      settings[field.key] = typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? raw : field.default;
    }
  }
  return settings as T;
}

/** A number from untrusted data, or a fallback. */
export const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** A side name from an older robot file, or a fallback. */
export const sideOr = (value: unknown, fallback: Side): Side =>
  SIDE_NAMES.includes(value as Side) ? (value as Side) : fallback;

/**
 * Footprint of a box mounted on one side of the robot: it starts `start`
 * metres from the robot's centre, runs `depth` further out and is `width` across.
 */
export function sideShape(
  side: Side,
  start: number,
  depth: number,
  width: number,
): Pick<Shape, 'x' | 'z' | 'sizeX' | 'sizeZ'> {
  const mid = start + depth / 2;
  if (side === 'front') return { x: mid, z: 0, sizeX: depth, sizeZ: width };
  if (side === 'back') return { x: -mid, z: 0, sizeX: depth, sizeZ: width };
  if (side === 'left') return { x: 0, z: -mid, sizeX: width, sizeZ: depth };
  return { x: 0, z: mid, sizeX: width, sizeZ: depth };
}

/** Centre of a shape in the robot's own space, whose origin is the middle of the frame. */
export function shapeCenter(shape: Shape, robot: SimRobot): Vec3 {
  return v3(shape.x, shape.bottom + shape.sizeY / 2 - robot.rig.rideHeight, shape.z);
}

/** The box the renderer draws for a shape. */
export function shapePart(
  shape: Shape,
  robot: SimRobot,
  options: { opacity?: number; visible?: boolean } = {},
): PartView {
  return {
    size: [shape.sizeX, shape.sizeY, shape.sizeZ],
    color: shape.color,
    opacity: options.opacity,
    position: shapeCenter(shape, robot),
    yaw: 0,
    pitch: 0,
    visible: options.visible ?? true,
  };
}

/** Turns a held button into an on/off switch that flips on each press. */
export class Toggle {
  on = false;
  private wasPressed = false;

  /** Returns true when the switch flipped this step. */
  update(pressed: boolean, allowed = true): boolean {
    const flipped = pressed && !this.wasPressed && allowed;
    this.wasPressed = pressed;
    if (flipped) this.on = !this.on;
    return flipped;
  }

  reset(): void {
    this.on = false;
    this.wasPressed = false;
  }
}
