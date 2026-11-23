import { frameTop, outlineOf } from '../../robots/chassis';
import type { SubsystemDef } from '../../robots/types';
import { v3 } from '../math';
import {
  resolveSettings,
  shapeCenter,
  shapeFields,
  turnFields,
  turnPoint,
  type FieldSpec,
  type Turn,
  type PartView,
  type Shape,
  type Subsystem,
  type SubsystemContext,
  type SubsystemEnv,
  type SubsystemSpec,
} from './types';

/** What the robot is doing, as the lights show it. Earlier states win when several apply. */
export const LED_STATES = [
  { key: 'climbing', label: 'Climbing' },
  { key: 'blocking', label: 'Shot blocker up' },
  { key: 'passing', label: 'Passing' },
  { key: 'moving', label: 'Shooting on the move' },
  { key: 'shooting', label: 'Shooting' },
  { key: 'idle', label: 'Idle' },
] as const;
export type LedState = (typeof LED_STATES)[number]['key'];

/**
 * How the lights show a colour. The free ones come with every robot; the rest
 * are LED effects unlocked in the Drive Pass. Patterns that move use the
 * state's accent colour for what moves.
 */
export const LED_PATTERNS: { value: string; label: string; free: boolean }[] = [
  { value: 'solid', label: 'Solid', free: true },
  { value: 'flash', label: 'Flash on and off', free: true },
  { value: 'pulse', label: 'Pulse', free: true },
  { value: 'off', label: 'Off', free: true },
  { value: 'blink', label: 'Blink: two quick flashes when it starts', free: false },
  { value: 'chase', label: 'Chase: the accent colour runs along, with a fading tail', free: false },
  { value: 'bounce', label: 'Bounce: a blip of the accent colour bounces end to end', free: false },
  { value: 'strobe', label: 'Strobe', free: false },
  { value: 'breathe', label: 'Breathe', free: false },
  { value: 'rainbow', label: 'Rainbow', free: false },
  { value: 'police', label: 'Two-tone flash', free: false },
];

/** The colour the lights show when they are dark. */
const DARK = '#111111';
/** A strip is lit in segments about this long, so light can move along it. */
const SEGMENT_LENGTH = 0.04;
const MAX_SEGMENTS = 16;

type LedSettings = Shape & Turn & Record<`${LedState}Color` | `${LedState}Accent` | `${LedState}Pattern`, string>;

/** A colour as red, green and blue from 0 to 1, and back. */
const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const toHex = (rgb: number[]): string =>
  `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
const dim = (hex: string, level: number): string => toHex(channels(hex).map((c) => c * level));
const mix = (from: string, to: string, t: number): string => {
  const a = channels(from);
  const b = channels(to);
  return toHex(a.map((c, i) => c + (b[i] - c) * t));
};

function hue(turns: number): string {
  const h = ((turns % 1) + 1) % 1;
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return 1 - Math.max(0, Math.min(k, 4 - k, 1));
  };
  return toHex([f(5), f(3), f(1)]);
}

/** How long a chase's light takes to run the length of the strip, and how many segments its tail fades over. */
const CHASE_SECONDS = 1.2;
const CHASE_TAIL = 4;
/** How long a bounce's blip takes to cross the strip one way. */
const BOUNCE_SECONDS = 0.8;

/**
 * The colour one segment shows at a moment, `time` seconds into the state.
 * `index` counts the segments from one end of the strip, of `count`.
 */
export function patternColor(pattern: string, color: string, time: number, accent = '#ffffff', index = 0, count = 1): string {
  switch (pattern) {
    case 'off':
      return DARK;
    case 'flash':
      return time % 0.5 < 0.25 ? color : DARK;
    case 'blink':
      // Dark, but for two quick flashes as the state begins.
      return (time >= 0 && time < 0.08) || (time >= 0.16 && time < 0.24) ? color : DARK;
    case 'pulse':
      return dim(color, 0.25 + 0.75 * (0.5 + 0.5 * Math.cos(time * Math.PI * 2)));
    case 'chase': {
      // The head runs along and wraps round; behind it the accent fades back into the background.
      const head = Math.floor(((time % CHASE_SECONDS) / CHASE_SECONDS) * count);
      const behind = (head - index + count) % count;
      if (behind === 0) return accent;
      if (behind <= CHASE_TAIL) return mix(accent, color, behind / (CHASE_TAIL + 1));
      return color;
    }
    case 'bounce': {
      // One blip going back and forth between the ends; the rest of the strip stays dark.
      const phase = (time % (2 * BOUNCE_SECONDS)) / BOUNCE_SECONDS;
      const along = phase <= 1 ? phase : 2 - phase;
      const at = Math.round(along * (count - 1));
      return Math.abs(index - at) === 0 ? accent : Math.abs(index - at) === 1 ? dim(accent, 0.3) : color === accent ? DARK : dim(color, 0.25);
    }
    case 'strobe':
      return time % 0.1 < 0.04 ? '#ffffff' : color;
    case 'breathe':
      return dim(color, 0.1 + 0.9 * Math.sin(((time % 2.5) / 2.5) * Math.PI) ** 2);
    case 'rainbow':
      return hue(time * 0.6 + index / Math.max(1, count) / 2);
    case 'police':
      return time % 0.4 < 0.2 ? color : accent;
    default:
      return color;
  }
}

/**
 * A strip of lights, lit in segments. It shows a colour and a pattern for
 * each thing the robot can be doing: idling, shooting, shooting on the move,
 * passing, climbing or blocking shots.
 */
class Led implements Subsystem {
  readonly type = 'led';
  readonly parts: PartView[];
  private state: LedState = 'idle';
  private time = 0;

  constructor(
    private readonly settings: LedSettings,
    env: SubsystemEnv,
  ) {
    // The strip is cut into segments along its longer side, and the whole strip turned as set.
    const center = shapeCenter(settings, env.robot);
    const RAD = Math.PI / 180;
    const alongX = settings.sizeX >= settings.sizeZ;
    const length = alongX ? settings.sizeX : settings.sizeZ;
    const count = Math.max(1, Math.min(MAX_SEGMENTS, Math.round(length / SEGMENT_LENGTH)));
    const piece = length / count;
    this.parts = Array.from({ length: count }, (_, i) => {
      const offset = -length / 2 + piece * (i + 0.5);
      const along = turnPoint(v3(alongX ? offset : 0, 0, alongX ? 0 : offset), settings);
      return {
        size: alongX ? [piece, settings.sizeY, settings.sizeZ] : [settings.sizeX, settings.sizeY, piece],
        color: settings.idleColor,
        position: v3(center.x + along.x, center.y + along.y, center.z + along.z),
        yaw: settings.yaw * RAD,
        pitch: settings.pitch * RAD,
        roll: settings.roll * RAD,
        visible: true,
        glow: true,
      } satisfies PartView;
    });
  }

  step({ robot, dt }: SubsystemContext): void {
    const others = robot.subsystems;
    const shooting = others.some((subsystem) => subsystem.shooting);
    const state: LedState = robot.climbing
      ? 'climbing'
      : others.some((subsystem) => subsystem.type === 'blocker' && subsystem.deployed)
        ? 'blocking'
        : shooting && others.some((subsystem) => subsystem.passing)
          ? 'passing'
          : shooting && robot.speed() > 0.5
            ? 'moving'
            : shooting
              ? 'shooting'
              : 'idle';
    // Each state's pattern starts from its beginning.
    if (state !== this.state) {
      this.state = state;
      this.time = 0;
    }
    this.time += dt;
    this.show();
  }

  private show(): void {
    const s = this.settings;
    const pattern = s[`${this.state}Pattern`];
    const color = s[`${this.state}Color`];
    const accent = s[`${this.state}Accent`];
    this.parts.forEach((part, i) => (part.color = patternColor(pattern, color, this.time, accent, i, this.parts.length)));
  }

  reset(): void {
    this.state = 'idle';
    this.time = 0;
    this.show();
  }
}

const DEFAULTS: Record<LedState, [string, string, string]> = {
  idle: ['#2563eb', '#ffffff', 'pulse'],
  shooting: ['#22c55e', '#ffffff', 'solid'],
  moving: ['#a3e635', '#ffffff', 'flash'],
  passing: ['#f59e0b', '#ffffff', 'flash'],
  climbing: ['#a855f7', '#ffffff', 'pulse'],
  blocking: ['#ef4444', '#ffffff', 'flash'],
};

const stateFields: FieldSpec[] = [...LED_STATES]
  .reverse()
  .flatMap(({ key, label }) => [
    { key: `${key}Color`, label: `${label}: colour`, kind: 'color' as const, default: DEFAULTS[key][0] },
    {
      key: `${key}Pattern`,
      label: `${label}: pattern`,
      kind: 'choice' as const,
      default: DEFAULTS[key][2],
      options: LED_PATTERNS.map(({ value, label: name }) => ({ value, label: name })),
    },
    { key: `${key}Accent`, label: `${label}: accent colour (chase, bounce, two-tone)`, kind: 'color' as const, default: DEFAULTS[key][1] },
  ]);

export const ledSpec: SubsystemSpec = {
  type: 'led',
  label: 'LED strip',
  description:
    'A strip of lights that shows what the robot is doing: a colour and a pattern for idling, shooting, shooting on the move, passing, climbing and blocking. Purely for show.',
  fields: [...shapeFields('#2563eb'), ...turnFields(), ...stateFields],
  upgrade: (def, chassis) => ({
    // A thin strip along the top of the frame's front.
    x: outlineOf(chassis).front - 0.03,
    z: 0,
    bottom: frameTop(chassis),
    sizeX: 0.03,
    sizeZ: Math.max(0.1, chassis.width - 0.1),
    sizeY: 0.03,
    ...def,
  }),
  create: (def: SubsystemDef, env) => new Led(resolveSettings<LedSettings>(ledSpec, def, env.robot.def.chassis), env),
};
