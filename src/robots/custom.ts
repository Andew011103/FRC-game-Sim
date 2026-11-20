import { cleanEpa } from './epa';
import { SUBSYSTEM_SPECS } from '../sim/subsystems';
import { resolveFields, resolveSettings } from '../sim/subsystems/types';
import { CHASSIS_FIELDS, DRIVE_FIELDS, MAX_SUBSYSTEMS, WHEEL_INSET, WHEEL_RADIUS } from './spec';
import { iconOf, teamOf } from './team';
import type { ChassisDef, DrivetrainDef, RobotDefinition, SubsystemDef } from './types';

// Custom robots are made by players in the builder and kept in the browser.
// They are never official, so they can never appear on a leaderboard.

const STORAGE_KEY = 'drive-practice.robots';
const ID_PREFIX = 'custom-';

function newId(): string {
  return `${ID_PREFIX}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * Turns anything (a saved robot, an imported file, a half-edited draft) into
 * a valid custom robot: unknown parts are dropped, missing values get
 * defaults and every number is clamped to its limits. Returns null when the
 * input is not robot-shaped at all.
 */
export function sanitizeRobot(raw: unknown): RobotDefinition | null {
  if (raw === null || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const driveData = asRecord(data.drivetrain);
  if (data.chassis === undefined && data.drivetrain === undefined) return null;

  // Older files had one bumper thickness for all four sides.
  const chassisData = asRecord(data.chassis);
  const all = chassisData.bumperThickness;
  const size = resolveFields<ChassisDef>(CHASSIS_FIELDS, {
    bumperFront: all,
    bumperBack: all,
    bumperLeft: all,
    bumperRight: all,
    ...chassisData,
  });
  if (size.round) {
    // A disc: as wide as it is long, with one ring of bumper.
    size.width = size.length;
    size.bumperBack = size.bumperLeft = size.bumperRight = size.bumperFront;
  } else {
    delete size.round;
  }
  // On a round frame the four wheels sit on a square inside the circle, each as far in from the edge as on a square frame.
  const wheelSpan = size.round ? (size.length - 2 * WHEEL_INSET) / Math.SQRT2 : null;
  const type = driveData.type === 'tank' ? 'tank' : 'swerve';
  const drivetrain = {
    type,
    wheelBase: wheelSpan ?? size.length - 2 * WHEEL_INSET,
    trackWidth: wheelSpan ?? size.width - 2 * WHEEL_INSET,
    wheelRadius: WHEEL_RADIUS,
    ...resolveFields<Record<string, number>>(DRIVE_FIELDS[type], driveData),
  } as DrivetrainDef;

  const subsystems: SubsystemDef[] = (Array.isArray(data.subsystems) ? data.subsystems : [])
    .map(asRecord)
    .filter((subsystem) => typeof subsystem.type === 'string' && SUBSYSTEM_SPECS[subsystem.type] !== undefined)
    .slice(0, MAX_SUBSYSTEMS)
    .map((subsystem) => {
      const spec = SUBSYSTEM_SPECS[subsystem.type as string];
      return { type: spec.type, ...resolveSettings<Record<string, unknown>>(spec, subsystem as SubsystemDef, size) };
    });

  const name = typeof data.name === 'string' ? data.name.trim().slice(0, 40) : '';
  const color = typeof data.color === 'string' && /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : '#9aa3af';
  return {
    id: typeof data.id === 'string' && data.id.startsWith(ID_PREFIX) ? data.id : newId(),
    name: name || 'Custom robot',
    description: 'Custom robot',
    official: false,
    color,
    team: teamOf(data),
    icon: iconOf(data),
    // Kept so the official builder can set it; it is only ever shown for official robots.
    epa: cleanEpa(data.epa),
    traversal: data.traversal === 'trench' || data.traversal === 'bump' ? data.traversal : 'auto',
    chassis: size,
    drivetrain,
    subsystems,
  };
}

/** A fresh custom robot, optionally starting as a copy of another one. */
export function newRobot(base?: RobotDefinition): RobotDefinition {
  const robot = sanitizeRobot({
    ...(base ?? { chassis: {}, drivetrain: { type: 'swerve' }, subsystems: [] }),
    id: undefined,
    name: base ? `${base.name} copy` : 'My robot',
  });
  return robot!;
}

export function loadCustomRobots(): RobotDefinition[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.map(sanitizeRobot).filter((robot): robot is RobotDefinition => robot !== null);
  } catch {
    return [];
  }
}

export function saveCustomRobots(robots: RobotDefinition[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(robots));
  } catch {
    // Storage can be full or blocked; the robots still work until the page closes.
  }
}
