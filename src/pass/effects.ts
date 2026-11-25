// Game piece effects: how fuel looks in the air after a robot shoots it, a
// Drive Pass cosmetic. An effect comes from a skin, or is a reward a player
// equips for every robot. It is only ever drawn; nothing in the match changes.

/** An effect and its color: a hex color, or 'alliance' for the shooting robot's alliance color. */
export interface PieceEffect {
  kind: string;
  color: string;
  /** How much of the color the fuel itself takes on: 0 keeps it its own color, 1 makes it fully this color. */
  fuelColor?: number;
  /** How bright and big the glow around the fuel is: 0 is none, 1 normal, 2 twice as strong. */
  glow?: number;
  /** How strong the trail, sparks or orbiting lights are: 0.2 faint, 1 normal, 2 twice as strong. */
  intensity?: number;
}

/** The three strengths an effect has, each with its range and starting value, for the editor. */
export const EFFECT_SCALES = [
  { key: 'fuelColor', label: 'Fuel color', min: 0, max: 1, step: 0.05, default: 0.3 },
  { key: 'glow', label: 'Glow brightness', min: 0, max: 2, step: 0.1, default: 1 },
  { key: 'intensity', label: 'Effect intensity (trails and sparks)', min: 0.2, max: 2, step: 0.1, default: 1 },
] as const;

export type EffectScale = (typeof EFFECT_SCALES)[number]['key'];

/** An effect's three strengths, with the starting values filled in. */
export function effectScales(effect: PieceEffect): Record<EffectScale, number> {
  return Object.fromEntries(EFFECT_SCALES.map((scale) => [scale.key, effect[scale.key] ?? scale.default])) as Record<EffectScale, number>;
}

export const PIECE_EFFECTS: { value: string; label: string }[] = [
  { value: 'glow', label: 'Glow: the fuel shines with a halo of color' },
  { value: 'pulse', label: 'Pulse: the glow swells and fades' },
  { value: 'blink', label: 'Blink: the glow flashes on and off' },
  { value: 'rainbow', label: 'Rainbow: the glow runs through every color' },
  { value: 'flame', label: 'Flame trail: the fuel burns, leaving fire behind it' },
  { value: 'comet', label: 'Comet: a streak of color behind the fuel' },
  { value: 'sparkle', label: 'Sparkle: a trail of glittering sparks' },
  { value: 'electric', label: 'Electric: crackling light and sparks' },
  { value: 'orbit', label: 'Orbit: two lights circle the fuel' },
];

/** The color value meaning the shooting robot's alliance color. */
export const ALLIANCE_COLOR = 'alliance';

/** An effect from saved or received data, or undefined when it is not one. */
export function cleanEffect(value: unknown): PieceEffect | undefined {
  const effect = value as Partial<PieceEffect> | null;
  if (!effect || typeof effect !== 'object') return undefined;
  if (!PIECE_EFFECTS.some((known) => known.value === effect.kind)) return undefined;
  const color = effect.color === ALLIANCE_COLOR || (typeof effect.color === 'string' && /^#[0-9a-f]{6}$/i.test(effect.color)) ? effect.color : ALLIANCE_COLOR;
  const cleaned: PieceEffect = { kind: effect.kind as string, color };
  // Each strength is kept within its range, to two decimal places; one left at its starting value is left out.
  for (const scale of EFFECT_SCALES) {
    const raw = effect[scale.key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const value = Math.round(Math.min(scale.max, Math.max(scale.min, raw)) * 100) / 100;
    if (value !== scale.default) cleaned[scale.key] = value;
  }
  return cleaned;
}
