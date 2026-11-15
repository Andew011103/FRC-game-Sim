import RAPIER from '@dimforge/rapier3d-compat';
import type { SubsystemDef } from '../../robots/types';
import { blockerSpec } from './blocker';
import { climberSpec } from './climber';
import { hopperSpec } from './hopper';
import { intakeSpec } from './intake';
import { shooterSpec } from './shooter';
import { structureSpec } from './structure';
import type { Subsystem, SubsystemEnv, SubsystemSpec } from './types';

/** Every subsystem type a robot can use. Add new mechanisms here. */
export const SUBSYSTEM_SPECS: Record<string, SubsystemSpec> = {
  [intakeSpec.type]: intakeSpec,
  [hopperSpec.type]: hopperSpec,
  [shooterSpec.type]: shooterSpec,
  [blockerSpec.type]: blockerSpec,
  [climberSpec.type]: climberSpec,
  [structureSpec.type]: structureSpec,
};

/**
 * Mechanisms whose box is a fixed part of the robot's outline. Intakes are
 * left out because they give way or fold; blockers and solid structures
 * already have their own solid shape; climbers must reach into the tower.
 */
const BLOCKED_BY_FIELD = new Set([hopperSpec.type, shooterSpec.type, structureSpec.type]);

/** Builds a robot's subsystems from its data. Unknown types are skipped with a warning. */
export function createSubsystems(defs: SubsystemDef[], env: SubsystemEnv): Subsystem[] {
  const subsystems: Subsystem[] = [];
  for (const def of defs) {
    const spec = SUBSYSTEM_SPECS[def.type];
    if (!spec) {
      console.warn(`Unknown subsystem type "${def.type}" on robot "${env.robot.def.id}"; skipped.`);
      continue;
    }
    const subsystem = spec.create(def, env);
    subsystems.push(subsystem);
    if (BLOCKED_BY_FIELD.has(spec.type)) {
      // The box cannot pass through field elements (a tall hopper will not fit
      // under the trench), but game pieces and other robots do not feel it.
      const { size, position } = subsystem.parts[0];
      env.world.createCollider(
        RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
          .setTranslation(position.x, position.y, position.z)
          .setDensity(0)
          .setFriction(0.25)
          .setCollisionGroups(env.robot.fieldOnlyGroups),
        env.robot.body,
      );
    }
  }
  return subsystems;
}
