import RAPIER from '@dimforge/rapier3d-compat';
import { frameTop } from '../../robots/chassis';
import type { SubsystemDef } from '../../robots/types';
import {
  resolveSettings,
  shapeFields,
  shapePart,
  type PartView,
  type Shape,
  type Subsystem,
  type SubsystemEnv,
  type SubsystemSpec,
} from './types';

interface StructureSettings extends Shape {
  solid: boolean;
}

/** A plain box with no mechanism: superstructure, electronics, a mast, a ramp. */
class Structure implements Subsystem {
  readonly type = 'structure';
  readonly parts: PartView[];

  constructor(settings: StructureSettings, env: SubsystemEnv) {
    const part = shapePart(settings, env.robot);
    this.parts = [part];
    if (settings.solid) {
      env.world.createCollider(
        RAPIER.ColliderDesc.cuboid(part.size[0] / 2, part.size[1] / 2, part.size[2] / 2)
          .setTranslation(part.position.x, part.position.y, part.position.z)
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
  description: 'A plain box that does nothing by itself. Use it to shape the robot.',
  fields: [
    ...shapeFields('#64748b'),
    { key: 'solid', label: 'Solid (things bounce off it)', kind: 'boolean', default: true },
  ],
  upgrade: (def, chassis) => ({ bottom: frameTop(chassis), ...def }),
  create: (def: SubsystemDef, env) =>
    new Structure(resolveSettings<StructureSettings>(structureSpec, def, env.robot.def.chassis), env),
};
