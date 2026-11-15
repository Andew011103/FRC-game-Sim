import RAPIER, { type Collider } from '@dimforge/rapier3d-compat';
import { frameTop, outlineOf } from '../../robots/chassis';
import type { SubsystemDef } from '../../robots/types';
import { add, rotate, scale, v3, type Vec3 } from '../math';
import {
  Toggle,
  numberOr,
  resolveSettings,
  shapeCenter,
  shapeFields,
  shapePart,
  sideOr,
  type PartView,
  type Shape,
  type Subsystem,
  type SubsystemContext,
  type SubsystemEnv,
  type SubsystemSpec,
} from './types';

type Direction = 'front' | 'back' | 'left' | 'right' | 'up';
type Axis = 'x' | 'y' | 'z';

interface HopperSettings extends Shape {
  round: boolean;
  capacity: number;
  expandable: boolean;
  expandDirection: Direction;
  expandDistance: number;
  expandTime: number;
  extWidth: number;
  extHeight: number;
  extShift: number;
  extLift: number;
  expandedCapacity: number;
}

/**
 * For each direction: the axis the extension grows along, and the two axes
 * its own "width" and "height" settings run along.
 */
const DIRECTIONS: Record<Direction, { axis: Axis; sign: number; width: Axis; height: Axis }> = {
  front: { axis: 'x', sign: 1, width: 'z', height: 'y' },
  back: { axis: 'x', sign: -1, width: 'z', height: 'y' },
  left: { axis: 'z', sign: -1, width: 'x', height: 'y' },
  right: { axis: 'z', sign: 1, width: 'x', height: 'y' },
  up: { axis: 'y', sign: 1, width: 'z', height: 'x' },
};

const FILL_COLOR = '#facc15';
/**
 * The fill level is drawn this much larger than the box it fills, on every
 * side, so none of its faces lie in the same plane as the box's (which flickers).
 */
const FILL_MARGIN = 0.012;
/** The most pieces that can spill out of a closing extension in one simulation step. */
const SPILL_PER_STEP = 3;

/**
 * Stores game pieces. An expanding hopper slides an extension out of one
 * face to hold more; the extension can be a different size from the hopper.
 * A yellow level shows how full it is: the hopper's own box fills first,
 * then the extension. Closing the extension spills whatever was in it.
 */
class Hopper implements Subsystem {
  readonly type = 'hopper';
  readonly parts: PartView[];
  private readonly toggle = new Toggle();
  private readonly extension: Collider | null = null;
  private readonly extensionPart: PartView | null = null;
  private readonly fill: PartView;
  private readonly extensionFill: PartView | null = null;
  /** How far out the extension is, from 0 (retracted) to 1 (fully out). */
  private extent = 0;
  /** Size and centre of the hopper's own box, in the robot's own space. */
  private readonly size: Vec3;
  private readonly center: Vec3;
  /** Size and centre of the extension as it is right now. */
  private extensionSize: Vec3;
  private extensionCenter: Vec3;

  constructor(
    private readonly settings: HopperSettings,
    env: SubsystemEnv,
  ) {
    const { robot, world } = env;
    const shape = settings.round ? 'cylinder' : 'box';
    this.size = v3(settings.sizeX, settings.sizeY, settings.sizeZ);
    this.center = shapeCenter(settings, robot);
    this.extensionSize = this.size;
    this.extensionCenter = this.center;
    this.parts = [{ ...shapePart(settings, robot, { opacity: 0.55 }), shape }];
    const level = (): PartView => ({
      size: [this.size.x, this.size.y, this.size.z],
      color: FILL_COLOR,
      position: this.center,
      yaw: 0,
      pitch: 0,
      visible: false,
    });

    if (settings.expandable) {
      this.extensionPart = { ...shapePart(settings, robot, { opacity: 0.8, visible: false }) };
      this.parts.push(this.extensionPart);
      // The extension is solid, so an expanded robot really is bigger.
      this.extension = world.createCollider(
        RAPIER.ColliderDesc.cuboid(settings.sizeX / 2, settings.sizeY / 2, settings.sizeZ / 2)
          .setDensity(0)
          .setFriction(0.25)
          .setCollisionGroups(robot.movingGroups),
        robot.body,
      );
      this.apply();
    }

    this.fill = { ...level(), shape };
    this.parts.push(this.fill);
    if (settings.expandable) {
      this.extensionFill = level();
      this.parts.push(this.extensionFill);
    }
  }

  get deployed(): boolean {
    return this.toggle.on;
  }

  /** The extra room only counts once the hopper is all the way out. */
  capacity(): number {
    return this.extent >= 1 ? this.settings.expandedCapacity : this.settings.capacity;
  }

  step(ctx: SubsystemContext): void {
    const { robot, input, dt } = ctx;
    const s = this.settings;
    const extra = Math.max(0, s.expandedCapacity - s.capacity);
    if (this.extension) {
      this.toggle.update(input.deploy);
      const goal = this.toggle.on ? 1 : 0;
      if (this.extent !== goal) {
        const change = dt / s.expandTime;
        this.extent = goal > this.extent ? Math.min(1, this.extent + change) : Math.max(0, this.extent - change);
        this.apply();
      }
      // As the extension closes, whatever no longer fits spills out of it. The hopper itself stays full.
      if (!this.toggle.on) {
        const room = robot.capacity() - this.capacity() + s.capacity + Math.round(extra * this.extent);
        for (let i = 0; i < SPILL_PER_STEP && robot.held.length > room; i++) this.spill(ctx);
      }
    }

    // This hopper's share of what the robot holds. Its own box fills first, then its extension.
    const mine = robot.held.length * (this.capacity() / Math.max(1, robot.capacity()));
    showLevel(this.fill, this.size, this.center, Math.min(1, mine / s.capacity));
    if (this.extensionFill) {
      const over = this.extent > 0 && extra > 0 ? Math.min(1, Math.max(0, mine - s.capacity) / extra) : 0;
      showLevel(this.extensionFill, this.extensionSize, this.extensionCenter, over);
    }
  }

  /** Drops one held piece out of the open end of the extension (or of the hopper, once that has closed). */
  private spill({ sim, robot }: SubsystemContext): void {
    const piece = robot.takePiece();
    if (piece === undefined) return;
    const { axis, sign, width, height } = DIRECTIONS[this.settings.expandDirection];
    const open = this.extent > 0;
    const size = open ? this.extensionSize : this.size;
    const local = { ...(open ? this.extensionCenter : this.center) };
    const radius = sim.pieces.radii[piece];
    const scatter = (span: number): number => (sim.random() - 0.5) * Math.max(0, span - 2 * radius);
    local[axis] += sign * (size[axis] / 2 + radius + 0.03);
    local[width] += scatter(size[width]);
    local[height] += scatter(size[height]);
    // Tipped out along the way the extension points, a little to either side. Upward ones are tossed clear.
    const push = v3();
    push[axis] = sign * (axis === 'y' ? 2 : 1 + sim.random());
    push[width] = (sim.random() - 0.5) * (axis === 'y' ? 3 : 1);
    push[height] = (sim.random() - 0.5) * (axis === 'y' ? 3 : 1);
    const rot = robot.rotation();
    const from = add(robot.position(), rotate(rot, local));
    sim.pieces.release(piece, from, add(robot.pointVelocity(from), rotate(rot, push)));
  }

  reset(): void {
    this.toggle.reset();
    this.extent = 0;
    this.apply();
  }

  /** Sizes and places the extension for how far out it currently is. */
  private apply(): void {
    const part = this.extensionPart;
    if (!this.extension || !part) return;
    const out = this.extent > 0;
    part.visible = out;
    this.extension.setEnabled(out);
    if (!out) return;

    const s = this.settings;
    const { axis, sign, width, height } = DIRECTIONS[s.expandDirection];
    const length = Math.max(0.004, s.expandDistance * this.extent);
    const size = { ...this.size };
    const center = { ...this.center };
    // Zero means "the same as the hopper" for the extension's own width and height.
    if (s.extWidth > 0) size[width] = s.extWidth;
    if (s.extHeight > 0) size[height] = s.extHeight;
    size[axis] = length;
    center[axis] += sign * (this.size[axis] / 2 + length / 2);
    center[width] += s.extShift;
    center[height] += s.extLift;

    this.extensionSize = size;
    this.extensionCenter = center;
    part.size = [size.x, size.y, size.z];
    part.position = center;
    this.extension.setHalfExtents(scale(size, 0.5));
    this.extension.setTranslationWrtParent(center);
  }
}

/**
 * Draws a fill level on a box: a thin line along the bottom when nearly
 * empty, the whole box when full, and nothing at all when empty.
 */
function showLevel(part: PartView, box: Vec3, center: Vec3, fraction: number): void {
  const full = box.y + FILL_MARGIN;
  const height = Math.max(0.012, fraction * full);
  part.visible = fraction > 0;
  part.size = [box.x + FILL_MARGIN, height, box.z + FILL_MARGIN];
  part.position = v3(center.x, center.y - full / 2 + height / 2, center.z);
}

const whenExpandable = { showIf: 'expandable' } as const;

export const hopperSpec: SubsystemSpec = {
  type: 'hopper',
  label: 'Hopper',
  description:
    'Holds collected game pieces and shows how full the robot is. Can optionally slide out an extension, of any size, for extra room.',
  fields: [
    ...shapeFields('#475569'),
    { key: 'round', label: 'Round (a drum; length and width are its two diameters)', kind: 'boolean', default: false },
    { key: 'capacity', label: 'Capacity', kind: 'number', default: 20, min: 1, max: 115, step: 1, unit: 'pieces' },
    { key: 'expandable', label: 'Expands', kind: 'boolean', default: false },
    {
      key: 'expandDirection',
      label: 'Expands toward',
      kind: 'choice',
      default: 'back',
      options: [
        { value: 'front', label: 'Front' },
        { value: 'back', label: 'Back' },
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
        { value: 'up', label: 'Up' },
      ],
      ...whenExpandable,
    },
    { key: 'expandDistance', label: 'Grows by', kind: 'number', default: 0.3, min: 0.02, max: 0.8, step: 0.01, unit: 'm', ...whenExpandable },
    { key: 'expandTime', label: 'Time to expand', kind: 'number', default: 0.4, min: 0.05, max: 2, step: 0.05, unit: 's', ...whenExpandable },
    { key: 'extWidth', label: 'Extension width (0 = as hopper)', kind: 'number', default: 0, min: 0, max: 1.2, step: 0.01, unit: 'm', ...whenExpandable },
    { key: 'extHeight', label: 'Extension height (0 = as hopper)', kind: 'number', default: 0, min: 0, max: 1.4, step: 0.01, unit: 'm', ...whenExpandable },
    { key: 'extShift', label: 'Extension moved sideways', kind: 'number', default: 0, min: -0.6, max: 0.6, step: 0.01, unit: 'm', ...whenExpandable },
    { key: 'extLift', label: 'Extension moved up', kind: 'number', default: 0, min: -0.6, max: 0.6, step: 0.01, unit: 'm', ...whenExpandable },
    { key: 'expandedCapacity', label: 'Capacity when expanded', kind: 'number', default: 40, min: 1, max: 150, step: 1, unit: 'pieces', ...whenExpandable },
  ],
  upgrade: (def, chassis) => {
    const upgraded: SubsystemDef = {
      x: 0,
      z: 0,
      bottom: frameTop(chassis),
      sizeX: chassis.length * 0.86,
      sizeY: 0.16,
      sizeZ: chassis.width * 0.86,
      ...def,
    };
    // Older files measured the expansion from the outside of the bumper on a named side.
    if (def.expandDirection === undefined && def.expandSide !== undefined) {
      const side = sideOr(def.expandSide, 'back');
      const { axis, sign } = DIRECTIONS[side];
      const face = sign * numberOr(upgraded[axis], 0) + numberOr(upgraded[axis === 'x' ? 'sizeX' : 'sizeZ'], 0) / 2;
      upgraded.expandDirection = side;
      upgraded.expandDistance = Math.max(0, outlineOf(chassis)[side] - face) + numberOr(def.expandDistance, 0.25);
    }
    return upgraded;
  },
  create: (def: SubsystemDef, env) =>
    new Hopper(resolveSettings<HopperSettings>(hopperSpec, def, env.robot.def.chassis), env),
};
