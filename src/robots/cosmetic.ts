import { sanitizeRobot } from './custom';
import { OFFICIAL_ROBOTS } from './index';
import { isDecoration } from './spec';
import type { RobotDefinition, SubsystemDef } from './types';

// A player may copy an official robot in the builder and only change how it
// looks: its colors, LED strips, see-through structures. That robot drives
// exactly like the official one, so it is taken as the official robot wearing
// a skin of the player's own, and is allowed wherever the official one is
// (rooms that do not allow custom robots, and the leaderboards).

/** A setting that only changes a color. */
const colorKey = (key: string) => key === 'color' || key.endsWith('Color') || key.endsWith('Accent');
const hex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

/** Any value with its colors taken out, numbers rounded and keys in order, to compare as text. */
function plain(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6;
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => !colorKey(key))
        .sort()
        .map((key) => [key, plain((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** What makes a robot drive and play the way it does: everything but its looks, names and labels. */
function workings(robot: RobotDefinition): string {
  return JSON.stringify(
    plain({
      chassis: robot.chassis,
      drivetrain: robot.drivetrain,
      traversal: robot.traversal ?? 'auto',
      subsystems: robot.subsystems.filter((part) => !isDecoration(part)),
    }),
  );
}

/** Each official robot as the builder would hold a copy of it, with its workings, worked out once. */
let officials: { robot: RobotDefinition; workings: string }[] | null = null;
function officialWorkings() {
  officials ??= OFFICIAL_ROBOTS.map((robot) => {
    const copy = sanitizeRobot({ ...robot, id: undefined });
    return { robot, workings: copy ? workings(copy) : '' };
  });
  return officials;
}

const seen = new WeakMap<RobotDefinition, RobotDefinition>();

/**
 * A robot as it plays: a custom robot that works exactly like an official one
 * becomes that official robot, wearing the custom robot's colors and its LED
 * strips and see-through structures. Any other robot comes back as it is.
 */
export function asOfficialSkin(robot: RobotDefinition): RobotDefinition {
  if (robot.official) return robot;
  const known = seen.get(robot);
  if (known) return known;
  const mine = workings(robot);
  const match = officialWorkings().find((official) => official.workings === mine)?.robot;
  const result = match ? dressAs(robot, match) : robot;
  seen.set(robot, result);
  return result;
}

/** The official robot, with the custom one's colors on its parts and the custom one's decorations. */
function dressAs(custom: RobotDefinition, base: RobotDefinition): RobotDefinition {
  const customParts = custom.subsystems.filter((part) => !isDecoration(part));
  const baseParts = base.subsystems.filter((part) => !isDecoration(part));
  const recolored = baseParts.map((part, i) => {
    const colors = Object.entries(customParts[i] ?? {}).filter(([key, value]) => colorKey(key) && hex(value));
    return colors.length > 0 ? ({ ...part, ...Object.fromEntries(colors) } as SubsystemDef) : part;
  });
  const decorations = custom.subsystems
    .filter(isDecoration)
    .map((part) => (part.type === 'structure' ? { ...part, solid: false } : { ...part }));
  return {
    ...base,
    color: hex(custom.color) ? custom.color : base.color,
    customSkin: true,
    subsystems: [...recolored, ...decorations],
  };
}
