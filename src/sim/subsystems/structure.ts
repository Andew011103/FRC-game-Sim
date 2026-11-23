import RAPIER from '@dimforge/rapier3d-compat';
import { frameTop } from '../../robots/chassis';
import type { SubsystemDef } from '../../robots/types';
import {
  resolveSettings,
  shapeFields,
  shapePart,
  type PartView,
  type Shape,
  turnFields,
  turnQuat,
  type Subsystem,
  type SubsystemEnv,
  type SubsystemSpec,
  type Turn,
} from './types';

interface StructureSettings extends Shape, Turn {
  solid: boolean;
}

const RAD = Math.PI / 180;

/** A plain box with no mechanism: superstructure, electronics, a mast, a ramp. */
class Structure implements Subsystem {
  readonly type = 'structure';
  readonly parts: PartView[];
  /** A see-through structure is only for looks: nothing feels it, not even the field. */
  readonly solid: boolean;

  constructor(settings: StructureSettings, env: SubsystemEnv) {
    const part = { ...shapePart(settings, env.robot), yaw: settings.yaw * RAD, pitch: settings.pitch * RAD, roll: settings.roll * RAD };
    this.parts = [part];
    this.solid = settings.solid;
    if (settings.solid) {
      env.world.createCollider(
        RAPIER.ColliderDesc.cuboid(part.size[0] / 2, part.size[1] / 2, part.size[2] / 2)
          .setTranslation(part.position.x, part.position.y, part.position.z)
          .setRotation(turnQuat(settings))
          .setDensity(0)
          .setFriction(0.4)
          .setCollisionGroups(env.robot.movingGroups),
        env.robot.body,
      );
    }
  }

  step(): void {}

  reset(): void {}
}

export const structureSpec: SubsystemSpec = {
  type: 'structure',
  label: 'Structure',
  description:
    'A plain box that does nothing by itself. Use it to shape the robot, or turn off Solid for a see-through part that is only for looks (it does not count toward the subsystem limit).',
  fields: [
    ...shapeFields('#64748b'),
    ...turnFields(),
    { key: 'solid', label: 'Solid (things bounce off it)', kind: 'boolean', default: true },
  ],
  upgrade: (def, chassis) => ({ bottom: frameTop(chassis), ...def }),
  create: (def: SubsystemDef, env) =>
    new Structure(resolveSettings<StructureSettings>(structureSpec, def, env.robot.def.chassis), env),
};
