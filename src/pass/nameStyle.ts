/**
 * How a name color cosmetic draws the player's name: a plain color, or a
 * gradient, with an optional outline or glow, and an optional animation like
 * the LED patterns (blink, breathe, chase) or a glare sweeping across it.
 */

/** The animations a styled name can have. */
export const NAME_EFFECTS = [
  { id: 'none', label: 'None' },
  { id: 'glare', label: 'Glare (a shine sweeps across)' },
  { id: 'blink', label: 'Blink (on and off)' },
  { id: 'breathe', label: 'Breathe (fades in and out)' },
  { id: 'chase', label: 'Chase (a light runs along the letters)' },
] as const;
export type NameEffect = (typeof NAME_EFFECTS)[number]['id'];

/** The edges a styled name can have. */
export const NAME_EDGES = [
  { id: 'line', label: 'Outline' },
  { id: 'glow', label: 'Glow' },
] as const;
export type NameEdge = (typeof NAME_EDGES)[number]['id'];

/** Most extra colors a gradient takes, after the main color. */
export const MAX_GRADIENT = 3;
/** Seconds one cycle of an animation takes, at most and at least. */
export const NAME_SPEED = { least: 0.5, most: 6, start: 2 } as const;

/** The style fields a name color reward may carry. All are optional, so older rewards stay plain colors. */
export interface NameStyleFields {
  color: string;
  /** More colors after `color`, left to right, making a gradient. */
  gradient?: string[];
  /** The color of the edge around the letters; none when empty. */
  outline?: string;
  edge?: NameEdge;
  effect?: NameEffect;
  /** Seconds one cycle of the animation takes. */
  speed?: number;
}

/** A name style made safe to draw: every color checked, every number in range. */
export interface NameStyle {
  colors: string[];
  outline: string;
  edge: NameEdge;
  effect: NameEffect;
  speed: number;
}

const hex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

/** Any name style, even from a file edited by hand, as one that is safe to draw. */
export function cleanNameStyle(fields: Partial<NameStyleFields> | null | undefined): NameStyle {
  const main = hex(fields?.color) ? fields.color : '#ffffff';
  const extra = Array.isArray(fields?.gradient) ? fields.gradient.filter(hex).slice(0, MAX_GRADIENT) : [];
  const effect = NAME_EFFECTS.some(({ id }) => id === fields?.effect) ? (fields!.effect as NameEffect) : 'none';
  const edge = NAME_EDGES.some(({ id }) => id === fields?.edge) ? (fields!.edge as NameEdge) : 'line';
  const speed = Number(fields?.speed);
  return {
    colors: [main, ...extra],
    outline: hex(fields?.outline) ? fields.outline : '',
    edge,
    effect,
    speed: Number.isFinite(speed) && speed > 0 ? Math.min(NAME_SPEED.most, Math.max(NAME_SPEED.least, speed)) : NAME_SPEED.start,
  };
}

/** The color a gradient of these colors has at `t`, from 0 at the left to 1 at the right. */
export function gradientAt(colors: string[], t: number): string {
  if (colors.length === 1) return colors[0];
  const place = Math.min(1, Math.max(0, t)) * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(place));
  const along = place - i;
  const from = parseInt(colors[i].slice(1), 16);
  const to = parseInt(colors[i + 1].slice(1), 16);
  const channel = (shift: number) => Math.round(((from >> shift) & 255) * (1 - along) + ((to >> shift) & 255) * along);
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`;
}

/** A short description of a name style, for the card and the editor. */
export function describeNameStyle(style: NameStyle): string {
  const parts: string[] = [];
  if (style.colors.length > 1) parts.push(`${style.colors.length}-color gradient`);
  if (style.outline) parts.push(style.edge === 'glow' ? 'glow' : 'outline');
  if (style.effect !== 'none') parts.push(style.effect);
  return parts.join(', ');
}
