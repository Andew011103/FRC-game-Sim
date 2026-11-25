// Power-ups: abilities bought in the Shop. A player equips one, and in a match
// a key switches it on for a few seconds, boosting some of their robot's stats.
// Then it needs a while to recharge, and it may only be used so many times a match.
// Every number is kept within fixed limits, so no power-up can be made too strong.

/** The stats a power-up can boost, each by a multiplier from 1 (no change) to its most. */
export const BOOST_STATS = [
  { key: 'driveSpeed', label: 'Top speed', max: 1.6 },
  { key: 'acceleration', label: 'Acceleration', max: 2.5 },
  { key: 'turnSpeed', label: 'Turn speed', max: 2 },
  { key: 'traction', label: 'Traction (pushes harder, harder to push)', max: 2 },
  { key: 'fireRate', label: 'Fire rate', max: 2 },
  { key: 'intakeSpeed', label: 'Intake speed', max: 2.5 },
] as const;

export type BoostStat = (typeof BOOST_STATS)[number]['key'];
export type Boosts = Record<BoostStat, number>;

/** No boost at all: every stat as the robot has it. */
export const NO_BOOST: Boosts = Object.freeze(Object.fromEntries(BOOST_STATS.map((stat) => [stat.key, 1]))) as Boosts;

/** The timings a power-up has, each with its range and starting value, for the editor. */
export const POWER_TIMINGS = [
  { key: 'duration', label: 'Lasts', unit: 's', min: 1, max: 15, step: 0.5, default: 5 },
  { key: 'cooldown', label: 'Recharges in', unit: 's', min: 5, max: 120, step: 1, default: 25 },
  { key: 'uses', label: 'Uses a match (0 for no limit)', unit: '', min: 0, max: 10, step: 1, default: 3 },
] as const;

export interface PowerUp {
  /** A short mark for it: an emoji or a letter or two. */
  icon: string;
  /** A small picture shown instead of the mark, as an image data URL. */
  image?: string;
  /** The color it glows around the robot while on, and in the display. */
  color: string;
  /** Seconds it stays on. */
  duration: number;
  /** Seconds after it ends before it can be used again. */
  cooldown: number;
  /** Times it can be used in one match; 0 means any number. */
  uses: number;
  /** Multipliers for the stats it boosts; any left out stay as they are. */
  boosts: Partial<Boosts>;
}

/** A power-up from saved or received data, kept within the limits, or undefined when it is not one. */
export function cleanPowerUp(value: unknown): PowerUp | undefined {
  const raw = value as Partial<PowerUp> | null;
  if (!raw || typeof raw !== 'object') return undefined;
  const number = (key: (typeof POWER_TIMINGS)[number]['key']) => {
    const timing = POWER_TIMINGS.find((entry) => entry.key === key)!;
    const given = Number(raw[key]);
    if (!Number.isFinite(given)) return timing.default;
    const kept = Math.min(timing.max, Math.max(timing.min, given));
    return key === 'uses' ? Math.round(kept) : Math.round(kept * 10) / 10;
  };
  const boosts: Partial<Boosts> = {};
  const given = raw.boosts && typeof raw.boosts === 'object' ? (raw.boosts as Record<string, unknown>) : {};
  for (const stat of BOOST_STATS) {
    const multiplier = Number(given[stat.key]);
    if (!Number.isFinite(multiplier) || multiplier <= 1) continue;
    boosts[stat.key] = Math.round(Math.min(stat.max, multiplier) * 100) / 100;
  }
  // Only a small picture kept in the game's own files: an image data URL, nothing that loads from elsewhere.
  const image =
    typeof raw.image === 'string' && raw.image.length <= MAX_IMAGE_LENGTH && /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(raw.image)
      ? raw.image
      : undefined;
  return {
    icon: typeof raw.icon === 'string' && raw.icon.trim() ? [...raw.icon.trim()].slice(0, 3).join('') : '⚡',
    ...(image ? { image } : {}),
    color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '#38bdf8',
    duration: number('duration'),
    cooldown: number('cooldown'),
    uses: number('uses'),
    boosts,
  };
}

/** The longest picture kept, as a data URL: a small square is far less. */
const MAX_IMAGE_LENGTH = 200_000;

/** Every stat's multiplier while a power-up is on. */
export function boostsOf(power: PowerUp): Boosts {
  return { ...NO_BOOST, ...power.boosts };
}

/** What a power-up does, in a few words: "Top speed ×1.3, Acceleration ×1.5 for 5 s". */
export function describePowerUp(power: PowerUp): string {
  const boosts = BOOST_STATS.filter((stat) => (power.boosts[stat.key] ?? 1) > 1).map(
    (stat) => `${stat.label.split(' (')[0]} ×${power.boosts[stat.key]}`,
  );
  const uses = power.uses > 0 ? `${power.uses} a match` : 'no limit a match';
  return `${boosts.length > 0 ? boosts.join(', ') : 'No boosts yet'} for ${power.duration} s · recharges in ${power.cooldown} s · ${uses}`;
}

/** Where a robot's power-up stands during a match. */
export interface PowerState {
  /** Seconds it stays on for; 0 when off. */
  active: number;
  /** Seconds until it can be used again. */
  cooldown: number;
  /** Uses left this match; Infinity when there is no limit. */
  usesLeft: number;
}

export const freshPowerState = (power: PowerUp | null | undefined): PowerState => ({
  active: 0,
  cooldown: 0,
  usesLeft: power && power.uses > 0 ? power.uses : Infinity,
});
