import RAPIER from '@dimforge/rapier3d-compat';
import type { Tower } from '../../games/types';
import { frameTop, outlineOf } from '../../robots/chassis';
import type { SubsystemDef } from '../../robots/types';
import { quatFromYaw, v3, type Quat } from '../math';
import {
  resolveSettings,
  shapeFields,
  shapePart,
  type PartView,
  type Shape,
  type Subsystem,
  type SubsystemContext,
  type SubsystemEnv,
  type SubsystemSpec,
} from './types';

interface ClimberSettings extends Shape {
  maxLevel: number;
  speed: number;
  /** Seconds to go from the floor to the top; 0 climbs at the speed instead. */
  climbTime: number;
}

/** How close the robot's centre must be to its tower to grab on. */
const GRAB_RANGE_X = 0.8;
const GRAB_RANGE_Z = 0.9;
/** How far the bumpers must clear a rung to count as above it. */
const RUNG_CLEARANCE = 0.06;
const LEVEL_1_LIFT = 0.12;

/**
 * Lifts the robot up its alliance's tower. While climbing, the robot is
 * carried straight up or down by the climber and cannot drive.
 */
class Climber implements Subsystem {
  readonly type = 'climber';
  readonly parts: PartView[];
  climbLevel = 0;
  private tower: Tower | null = null;
  private height = 0;
  private hold: { x: number; z: number; rot: Quat } | null = null;

  constructor(
    private readonly settings: ClimberSettings,
    private readonly env: SubsystemEnv,
  ) {
    this.parts = [shapePart(settings, env.robot)];
  }

  step({ sim, robot, input, dt }: SubsystemContext): void {
    const rest = robot.rig.rideHeight;

    if (!this.hold) {
      if (!input.climbUp) return;
      const tower = this.towerInReach(sim.game.towers ?? []);
      if (!tower) return;
      const position = robot.position();
      this.tower = tower;
      this.height = position.y;
      // Level the robot out and freeze where it stands.
      this.hold = { x: position.x, z: position.z, rot: quatFromYaw(robot.heading()) };
      robot.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      robot.climbing = true;
    }

    const top = this.topHeight(this.tower!, rest);
    const speed = this.settings.climbTime > 0 ? Math.max(0.01, top - rest) / this.settings.climbTime : this.settings.speed;
    if (input.climbUp) this.height = Math.min(top, this.height + speed * dt);
    else if (input.climbDown) this.height = Math.max(rest, this.height - speed * dt);

    robot.body.setNextKinematicTranslation(v3(this.hold.x, this.height, this.hold.z));
    robot.body.setNextKinematicRotation(this.hold.rot);
    this.climbLevel = this.levelAt(this.tower!, rest);

    if (input.climbDown && this.height <= rest + 1e-6) this.letGo();
  }

  reset(): void {
    this.letGo();
  }

  private letGo(): void {
    if (!this.hold) return;
    const { robot } = this.env;
    robot.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    robot.climbing = false;
    this.hold = null;
    this.tower = null;
    this.climbLevel = 0;
  }

  private towerInReach(towers: Tower[]): Tower | null {
    const { robot } = this.env;
    const position = robot.position();
    return (
      towers.find(
        (tower) =>
          tower.alliance === robot.alliance &&
          Math.abs(position.x - tower.x) <= GRAB_RANGE_X &&
          Math.abs(position.z - tower.z) <= GRAB_RANGE_Z,
      ) ?? null
    );
  }

  /** Height of the robot's centre when it is as high as this climber goes. */
  private topHeight(tower: Tower, rest: number): number {
    const { robot } = this.env;
    const level = Math.round(this.settings.maxLevel);
    if (level <= 1) return rest + LEVEL_1_LIFT;
    return tower.rungs[level - 2] + RUNG_CLEARANCE + robot.half.y;
  }

  /** Level 1 is off the floor; levels 2 and 3 need the bumpers fully above the low and mid rungs. */
  private levelAt(tower: Tower, rest: number): number {
    const bumperBottom = this.height - this.env.robot.half.y;
    if (bumperBottom > tower.rungs[1] + 0.03) return 3;
    if (bumperBottom > tower.rungs[0] + 0.03) return 2;
    return this.height - rest > 0.04 ? 1 : 0;
  }
}

export const climberSpec: SubsystemSpec = {
  type: 'climber',
  label: 'Climber',
  description: 'Lifts the robot up its alliance tower. Hold the climb control next to the tower to go up; let go and hold it again to come down.',
  fields: [
    ...shapeFields('#a3e635'),
    { key: 'maxLevel', label: 'Highest level', kind: 'number', default: 1, min: 1, max: 3, step: 1 },
    { key: 'speed', label: 'Climb speed', kind: 'number', default: 0.5, min: 0.1, max: 2, unit: 'm/s' },
    { key: 'climbTime', label: 'Time to climb to the top (0 = use the speed)', kind: 'number', default: 0, min: 0, max: 10, step: 0.1, unit: 's' },
  ],
  upgrade: (def, chassis) => ({
    x: -outlineOf(chassis).back * 0.5,
    z: 0,
    bottom: frameTop(chassis),
    sizeX: 0.07,
    sizeZ: 0.07,
    sizeY: 0.5,
    ...def,
  }),
  create: (def: SubsystemDef, env) =>
    new Climber(resolveSettings<ClimberSettings>(climberSpec, def, env.robot.def.chassis), env),
};
