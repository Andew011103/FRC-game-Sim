// A robot's team number and icon, read from untrusted data.

/** The longest icon data URL kept. Icons are shrunk to 64 pixels square before saving, well under this. */
const MAX_ICON_LENGTH = 120_000;

/** The longest team label kept, to fit on a bumper. */
export const MAX_TEAM_LENGTH = 12;

/**
 * What goes on a robot's bumpers: a team number, or a short label such as
 * "Kitbot" or "2910 v2" for teams with more than one robot. Letters, digits,
 * spaces and a little punctuation, up to 12 characters, or undefined.
 * Older files kept a plain number as the description.
 */
export function teamOf(data: { team?: unknown; description?: unknown }): string | undefined {
  const team = cleanTeam(data.team);
  if (team) return team;
  return typeof data.description === 'string' && /^\d{1,5}$/.test(data.description.trim()) ? data.description.trim() : undefined;
}

/** A team label typed in or received, tidied: allowed characters only, single spaces, at most 12 characters. */
export function cleanTeam(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value
    .replace(/[^A-Za-z0-9 .#'&+-]/g, '')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, MAX_TEAM_LENGTH)
    .trimEnd();
  return text || undefined;
}

/** An icon from robot data: an embedded picture of a sensible size, or undefined. */
export function iconOf(data: { icon?: unknown }): string | undefined {
  const { icon } = data;
  const ok =
    typeof icon === 'string' && icon.length <= MAX_ICON_LENGTH && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(icon);
  return ok ? icon : undefined;
}
