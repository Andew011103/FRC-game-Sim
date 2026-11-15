import { SUBSYSTEM_SPECS } from '../sim/subsystems';
import { resolveSettings } from '../sim/subsystems/types';
import { frameTop } from './chassis';
import type { RobotDefinition } from './types';

// Figures worked out from a robot's data alone, for the robot selector and
// the starting-position editor. Nothing here runs the simulation.

type Parts = Record<string, unknown>[];

/** Each subsystem's settings with defaults filled in, whatever format the file is in. */
function resolvedParts(def: RobotDefinition): Parts {
  return def.subsystems.flatMap((subsystem) => {
    const spec = SUBSYSTEM_SPECS[subsystem.type];
    return spec ? [{ type: spec.type, ...resolveSettings<Record<string, unknown>>(spec, subsystem, def.chassis) }] : [];
  });
}

const num = (value: unknown): number => (typeof value === 'number' ? value : 0);

/** Height of the tallest fixed part of the robot above the carpet. Parts that fold away are not counted. */
export function robotHeight(def: RobotDefinition): number {
  let top = frameTop(def.chassis);
  for (const part of resolvedParts(def)) {
    const fixed =
      part.type === 'hopper' ||
      part.type === 'shooter' ||
      part.type === 'structure' ||
      (part.type === 'blocker' && part.deployable === false);
    if (fixed) top = Math.max(top, num(part.bottom) + num(part.sizeY));
  }
  return top;
}

/** Whether the robot may pass under a bar this far above the carpet, going by its label or else its height. */
export function fitsUnder(def: RobotDefinition, clearance: number): boolean {
  if (def.traversal === 'trench') return true;
  if (def.traversal === 'bump') return false;
  return robotHeight(def) < clearance;
}

export interface Stat {
  label: string;
  /** The figure as text, with its unit. */
  text: string;
  /** 0 to 1: how far along its bar the figure sits. */
  fraction: number;
}

/**
 * Where a value sits between two ends on a logarithmic scale, so that the
 * realistic low end of each range is spread out and not squeezed into a corner.
 */
function logFraction(value: number, least: number, most: number): number {
  if (value <= least) return 0;
  return Math.min(1, Math.log(value / least) / Math.log(most / least));
}

/** The figures shown as bars when choosing a robot. */
export function robotStats(def: RobotDefinition): Stat[] {
  const parts = resolvedParts(def);
  const shooters = parts.filter((part) => part.type === 'shooter');
  const fireRate = shooters.reduce((sum, part) => sum + num(part.lanes) * num(part.rate), 0);
  const intakeRate = parts.filter((part) => part.type === 'intake').reduce((sum, part) => sum + num(part.rate), 0);
  const capacity = parts
    .filter((part) => part.type === 'hopper')
    .reduce(
      (sum, part) =>
        sum + (part.expandable === true ? Math.max(num(part.capacity), num(part.expandedCapacity)) : num(part.capacity)),
      0,
    );
  // The tightest shooter's spread, turned into a score: no spread is 100%, the widest allowed is 0%.
  const spread = shooters.length > 0 ? Math.min(...shooters.map((part) => num(part.spread))) : 15;
  const accuracy = shooters.length > 0 ? 1 - spread / 15 : 0;
  const onTheMove = shooters.length > 0 ? Math.max(...shooters.map((part) => num(part.moveAccuracy))) / 100 : 0;
  const { maxSpeed, maxAccel } = def.drivetrain;
  const { mass } = def.chassis;

  return [
    { label: 'Speed', text: `${maxSpeed.toFixed(1)} m/s`, fraction: logFraction(maxSpeed, 0.1, 20) },
    { label: 'Acceleration', text: `${maxAccel.toFixed(1)} m/s²`, fraction: logFraction(maxAccel, 3, 20) },
    { label: 'Weight', text: `${mass.toFixed(0)} kg`, fraction: logFraction(mass, 10, 200) },
    { label: 'Fire rate', text: `${fireRate.toFixed(1)} per s`, fraction: logFraction(fireRate, 0.5, 100) },
    { label: 'Intake rate', text: `${intakeRate.toFixed(1)} per s`, fraction: logFraction(intakeRate, 0.5, 100) },
    { label: 'Capacity', text: `${capacity} fuel`, fraction: logFraction(capacity, 1, 600) },
    { label: 'Accuracy', text: `${Math.round(accuracy * 100)}%`, fraction: accuracy },
    { label: 'Shoot on move', text: `${Math.round(onTheMove * 100)}%`, fraction: onTheMove },
  ];
}

/**
 * What sets a robot apart, for the robot selector. Parts nearly every robot
 * has (a hopper, an intake, a shooter) are not listed; their absence or an
 * unusual kind of them is. lowBarClearance is the height of the field's low bars, or 0 if it has none.
 */
export function robotTags(def: RobotDefinition, lowBarClearance: number): string[] {
  const parts = resolvedParts(def);
  const of = (type: string): Parts => parts.filter((part) => part.type === type);
  const tags: string[] = [];
  if (lowBarClearance > 0 && !fitsUnder(def, lowBarClearance)) tags.push('Bump only');
  if (def.drivetrain.type === 'tank') tags.push('Tank drive');
  if (of('intake').length >= 2) tags.push('Dual intake');
  if (of('intake').some((part) => part.outtake === true)) tags.push('Outtake');
  if (of('hopper').some((part) => part.expandable === true)) tags.push('Expanding hopper');
  if (of('shooter').length === 0) tags.push('No shooter');
  if (of('shooter').some((part) => part.turret === true)) tags.push('Turret');
  if (of('blocker').length > 0) tags.push('Shot blocker');
  if (of('climber').length > 0) tags.push('Climber');
  return tags;
}
