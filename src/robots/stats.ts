import { SUBSYSTEM_SPECS } from '../sim/subsystems';
import { resolveSettings, turnedHalfHeight, type Turn } from '../sim/subsystems/types';
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
      (part.type === 'structure' && part.solid !== false) ||
      (part.type === 'blocker' && part.deployable === false);
    if (!fixed) continue;
    if (part.type === 'structure') {
      // A turned structure reaches as high as its highest corner.
      const reach = turnedHalfHeight([num(part.sizeX), num(part.sizeY), num(part.sizeZ)], part as unknown as Turn);
      top = Math.max(top, num(part.bottom) + num(part.sizeY) / 2 + reach);
    } else top = Math.max(top, num(part.bottom) + num(part.sizeY));
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
  /** False when the robot has nothing this figure is about, such as fire rate without a shooter. */
  applies: boolean;
}

/**
 * Where a value sits between two ends, bent so the scale suits the figure: a
 * bend below 1 spreads out the low end (10 to 15 fuel is a big step, 110 to
 * 115 a small one), above 1 the high end. Each bend is set so a reference
 * value lands where it should, such as 18 shots a second at three quarters.
 */
export function scaleFraction(value: number, least: number, most: number, bend: number): number {
  if (!(value > least)) return 0;
  return Math.min(1, ((value - least) / (most - least)) ** bend);
}

/** Each figure's ends and bend. The bends put 50 kg at half, 18 shots a second and 70 fuel at three quarters. */
export const STAT_SCALES = {
  speed: { least: 0.5, most: 10, bend: 0.6 },
  acceleration: { least: 0.5, most: 15, bend: 0.6 },
  weight: { least: 10, most: 70, bend: Math.log(0.5) / Math.log(40 / 60) },
  fireRate: { least: 0.5, most: 32, bend: Math.log(0.75) / Math.log(17.5 / 31.5) },
  intakeRate: { least: 0.5, most: 50, bend: 0.6 },
  capacity: { least: 1, most: 130, bend: Math.log(0.75) / Math.log(69 / 129) },
} as const;

const scaled = (value: number, scale: keyof typeof STAT_SCALES) => {
  const { least, most, bend } = STAT_SCALES[scale];
  return scaleFraction(value, least, most, bend);
};

/** The figures shown as bars when choosing a robot. */
export function robotStats(def: RobotDefinition): Stat[] {
  const parts = resolvedParts(def);
  const shooters = parts.filter((part) => part.type === 'shooter');
  const intakes = parts.filter((part) => part.type === 'intake');
  const hoppers = parts.filter((part) => part.type === 'hopper');
  const fireRate = shooters.reduce((sum, part) => sum + num(part.lanes) * num(part.rate), 0);
  const intakeRate = intakes.reduce((sum, part) => sum + num(part.rate), 0);
  const capacity = hoppers.reduce(
    (sum, part) => sum + (part.expandable === true ? Math.max(num(part.capacity), num(part.expandedCapacity)) : num(part.capacity)),
    0,
  );
  // The tightest shooter's spread, turned into a score: no spread is 100%, the widest allowed is 0%.
  const spread = shooters.length > 0 ? Math.min(...shooters.map((part) => num(part.spread))) : 15;
  const accuracy = shooters.length > 0 ? 1 - spread / 15 : 0;
  const onTheMove = shooters.length > 0 ? Math.max(...shooters.map((part) => num(part.moveAccuracy))) / 100 : 0;
  const { maxSpeed, maxAccel } = def.drivetrain;
  const { mass } = def.chassis;
  const shoots = shooters.length > 0;
  /** A figure for something the robot does not have: no bar and no number. */
  const none = (label: string): Stat => ({ label, text: 'None', fraction: 0, applies: false });

  return [
    { label: 'Speed', text: `${maxSpeed.toFixed(1)} m/s`, fraction: scaled(maxSpeed, 'speed'), applies: true },
    { label: 'Acceleration', text: `${maxAccel.toFixed(1)} m/s²`, fraction: scaled(maxAccel, 'acceleration'), applies: true },
    { label: 'Weight', text: `${mass.toFixed(0)} kg`, fraction: scaled(mass, 'weight'), applies: true },
    shoots ? { label: 'Fire rate', text: `${fireRate.toFixed(1)} per s`, fraction: scaled(fireRate, 'fireRate'), applies: true } : none('Fire rate'),
    intakes.length > 0
      ? { label: 'Intake rate', text: `${intakeRate.toFixed(1)} per s`, fraction: scaled(intakeRate, 'intakeRate'), applies: true }
      : none('Intake rate'),
    hoppers.length > 0 ? { label: 'Capacity', text: `${capacity} fuel`, fraction: scaled(capacity, 'capacity'), applies: true } : none('Capacity'),
    shoots ? { label: 'Accuracy', text: `${Math.round(accuracy * 100)}%`, fraction: accuracy, applies: true } : none('Accuracy'),
    shoots ? { label: 'Shoot on move', text: `${Math.round(onTheMove * 100)}%`, fraction: onTheMove, applies: true } : none('Shoot on move'),
  ];
}

/**
 * What sets a robot apart, for the robot selector. Parts nearly every robot
 * has (a hopper, an intake, a shooter) are not listed; their absence or an
 * unusual kind of them is. lowBarClearance is the height of the field's low bars, or 0 if it has none.
 */
/** A turret that turns less than this, in all, is a turreted dumper rather than a limited turret. */
export const DUMPER_RANGE = 60;

export function robotTags(def: RobotDefinition, lowBarClearance: number): string[] {
  const parts = resolvedParts(def);
  const of = (type: string): Parts => parts.filter((part) => part.type === type);
  const tags: string[] = [];
  if (lowBarClearance > 0 && !fitsUnder(def, lowBarClearance)) tags.push('Bump only');
  if (def.drivetrain.type === 'tank') tags.push('Tank drive');
  // Two tags are hard to tell from the parts alone, so an official robot may set them itself.
  if (def.dualIntake ?? of('intake').length >= 2) tags.push('Dual intake');
  if (of('intake').some((part) => part.outtake === true)) tags.push('Outtake');
  if (of('hopper').some((part) => part.expandable === true)) tags.push('Expanding hopper');
  if (of('hopper').some((part) => part.openTop === true)) tags.push('Open top');
  const shooters = of('shooter');
  if (shooters.length === 0) tags.push('No shooter');
  else if (shooters.every((part) => part.canPass === false)) tags.push('No passing');
  const turrets = shooters.filter((part) => part.turret === true);
  const ranges = turrets.map((part) => (typeof part.turretRange === 'number' ? part.turretRange : 360));
  const double = def.doubleTurret ?? turrets.length >= 2;
  if (ranges.some((range) => range < DUMPER_RANGE)) tags.push('Turreted dumper');
  else if (ranges.some((range) => range < 360)) tags.push('Limited turret');
  else if (turrets.length > 0 && !double) tags.push('Turret');
  if (double) tags.push('Double turret');
  if (of('blocker').length > 0) tags.push('Shot blocker');
  if (of('climber').length > 0) tags.push('Climber');
  return tags;
}
