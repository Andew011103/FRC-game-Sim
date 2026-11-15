import RAPIER, { type Collider } from '@dimforge/rapier3d-compat';
import { frameTop } from '../../robots/chassis';
import type { SubsystemDef } from '../../robots/types';
import { v3, type Vec3 } from '../math';
import {
  Toggle,
  numberOr,
  resolveSettings,
  shapeCenter,
  shapeFields,
  shapePart,
  sideOr,
  sideShape,
  type PartView,
  type Shape,
  type Side,
  type Subsystem,
  type SubsystemContext,
  type SubsystemEnv,
  type SubsystemSpec,
} from './types';

type Motion = 'pop' | 'rise' | 'flip';

interface BlockerSettings extends Shape {
  deployable: boolean;
  motion: Motion;
  foldToward: Side;
  deployTime: number;
}

const LEGACY_THICKNESS = 0.03;
/** Which way a flip-out panel reaches when it is out. Its hinge is on the opposite edge. */
const FOLD: Record<Side, { axis: 'x' | 'z'; sign: number }> = {
  front: { axis: 'x', sign: 1 },
  back: { axis: 'x', sign: -1 },
  left: { axis: 'z', sign: -1 },
  right: { axis: 'z', sign: 1 },
};

/**
 * A solid box that knocks down shots. A deployable blocker comes out on a
 * button: it can appear at once, rise from its base, or flip out. A flip-out
 * blocker hangs straight down against the robot when stowed and swings up a
 * quarter turn to where it was designed, for example a flat roof held over
 * another robot's shooter.
 */
class Blocker implements Subsystem {
  readonly type = 'blocker';
  readonly parts: PartView[];
  private readonly toggle = new Toggle();
  private readonly panel: Collider;
  /** How far out it is, from 0 (stowed) to 1 (fully up). */
  private extent: number;
  /** Centre of the box when fully up, in the robot's own space. */
  private readonly center: Vec3;

  constructor(
    private readonly settings: BlockerSettings,
    env: SubsystemEnv,
  ) {
    const { robot, world } = env;
    const part = shapePart(settings, robot, { opacity: 0.5 });
    this.center = shapeCenter(settings, robot);
    // A panel that folds sideways is drawn turned a quarter turn, so its tilt is about the right edge.
    if (this.flips && FOLD[settings.foldToward].axis === 'z') {
      part.size = [settings.sizeZ, settings.sizeY, settings.sizeX];
      part.yaw = Math.PI / 2;
    }
    this.parts = [part];
    this.panel = world.createCollider(
      RAPIER.ColliderDesc.cuboid(settings.sizeX / 2, settings.sizeY / 2, settings.sizeZ / 2)
        .setDensity(0)
        .setRestitution(0.2)
        .setCollisionGroups(robot.movingGroups),
      robot.body,
    );
    this.extent = settings.deployable ? 0 : 1;
    this.apply();
  }

  private get flips(): boolean {
    return this.settings.deployable && this.settings.motion === 'flip';
  }

  get deployed(): boolean {
    return !this.settings.deployable || this.toggle.on;
  }

  step({ input, dt }: SubsystemContext): void {
    if (!this.settings.deployable) return;
    this.toggle.update(input.block);
    const goal = this.toggle.on ? 1 : 0;
    if (this.extent === goal) return;
    if (this.settings.motion === 'pop') {
      this.extent = goal;
    } else {
      const change = dt / this.settings.deployTime;
      this.extent = goal > this.extent ? Math.min(1, this.extent + change) : Math.max(0, this.extent - change);
    }
    this.apply();
  }

  reset(): void {
    this.toggle.reset();
    this.extent = this.settings.deployable ? 0 : 1;
    this.apply();
  }

  /** Places the panel and its solid shape for how far out it currently is. */
  private apply(): void {
    const s = this.settings;
    const part = this.parts[0];
    const { center } = this;

    if (this.flips) {
      // Out, the box is where it was designed: usually a flat roof reaching
      // out from the robot. It is hinged along the bottom of the edge nearest
      // the robot, and stowed it hangs straight down from that hinge.
      const { axis, sign } = FOLD[s.foldToward];
      const lean = (1 - this.extent) * (Math.PI / 2);
      const halfLong = (axis === 'x' ? s.sizeX : s.sizeZ) / 2;
      const halfTall = s.sizeY / 2;
      const position = v3(center.x, center.y - halfTall, center.z);
      position[axis] += sign * (-halfLong + halfLong * Math.cos(lean) + halfTall * Math.sin(lean));
      position.y += -halfLong * Math.sin(lean) + halfTall * Math.cos(lean);
      const half = Math.sin(lean / 2);
      const whole = Math.cos(lean / 2);
      part.visible = true;
      part.position = position;
      part.pitch = axis === 'x' ? -sign * lean : sign * lean;
      this.panel.setEnabled(true);
      this.panel.setTranslationWrtParent(position);
      this.panel.setRotationWrtParent(
        axis === 'x' ? { x: 0, y: 0, z: -sign * half, w: whole } : { x: sign * half, y: 0, z: 0, w: whole },
      );
      return;
    }

    // Rising panels grow from their base; the others are simply there or not.
    const height = s.motion === 'rise' && s.deployable ? Math.max(0.004, s.sizeY * this.extent) : s.sizeY;
    const position = v3(center.x, center.y - s.sizeY / 2 + height / 2, center.z);
    const out = this.extent > 0;
    part.visible = out;
    part.size = [s.sizeX, height, s.sizeZ];
    part.position = position;
    this.panel.setEnabled(out);
    this.panel.setHalfExtents(v3(s.sizeX / 2, height / 2, s.sizeZ / 2));
    this.panel.setTranslationWrtParent(position);
  }
}

const whenDeployable = { showIf: 'deployable' } as const;

export const blockerSpec: SubsystemSpec = {
  type: 'blocker',
  label: 'Shot blocker',
  description:
    'A solid box that blocks game pieces in flight. Thin and tall makes a wall; thin and flat makes a roof to hold over another robot. Shape it as it should be when out. It can appear at once, rise, or flip out from hanging down against the robot.',
  fields: [
    ...shapeFields('#e2e8f0'),
    { key: 'deployable', label: 'Raises and lowers', kind: 'boolean', default: true },
    {
      key: 'motion',
      label: 'How it comes out',
      kind: 'choice',
      default: 'pop',
      options: [
        { value: 'pop', label: 'Appears at once' },
        { value: 'rise', label: 'Rises from its base' },
        { value: 'flip', label: 'Flips out from hanging down' },
      ],
      ...whenDeployable,
    },
    {
      key: 'foldToward',
      label: 'Reaches out toward (flip only; hinged on the opposite edge)',
      kind: 'choice',
      default: 'back',
      options: [
        { value: 'front', label: 'Front' },
        { value: 'back', label: 'Back' },
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
      ],
      ...whenDeployable,
    },
    { key: 'deployTime', label: 'Time to come out', kind: 'number', default: 0.3, min: 0.05, max: 2, step: 0.05, unit: 's', ...whenDeployable },
  ],
  upgrade: (def, chassis) => {
    // Older files gave a side, a width and a height above the frame.
    const side = sideOr(def.side, 'front');
    const edge = (side === 'front' || side === 'back' ? chassis.length : chassis.width) / 2;
    return {
      ...sideShape(side, edge - LEGACY_THICKNESS, LEGACY_THICKNESS, numberOr(def.width, 0.6)),
      bottom: frameTop(chassis),
      sizeY: numberOr(def.height, 0.7),
      ...def,
    };
  },
  create: (def: SubsystemDef, env) =>
    new Blocker(resolveSettings<BlockerSettings>(blockerSpec, def, env.robot.def.chassis), env),
};
