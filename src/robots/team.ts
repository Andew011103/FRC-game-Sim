// A robot's team number and icon, read from untrusted data.

/** The longest icon data URL kept. Icons are shrunk to 64 pixels square before saving, well under this. */
const MAX_ICON_LENGTH = 120_000;

/** A team number from robot data: one to five digits, or undefined. Older files kept it as the description. */
export function teamOf(data: { team?: unknown; description?: unknown }): string | undefined {
  for (const value of [data.team, data.description]) {
    if (typeof value === 'string' && /^\d{1,5}$/.test(value.trim())) return value.trim();
  }
  return undefined;
}

/** An icon from robot data: an embedded picture of a sensible size, or undefined. */
export function iconOf(data: { icon?: unknown }): string | undefined {
  const { icon } = data;
  const ok =
    typeof icon === 'string' && icon.length <= MAX_ICON_LENGTH && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(icon);
  return ok ? icon : undefined;
}
