import { epaColor, epaOf } from '../robots/epa';
import type { RobotDefinition } from '../robots/types';

/** An official robot's EPA in a rounded tag coloured by where it ranks. Nothing for robots without one. */
export function EpaTag({ robot, className = '' }: { robot: RobotDefinition; className?: string }) {
  const epa = epaOf(robot);
  if (epa === null) return null;
  return (
    <span className={`epa-tag ${className}`} style={{ background: epaColor(epa) }} title="EPA: how strong this robot is, 0 to 100">
      {epa.toFixed(1)}
    </span>
  );
}
