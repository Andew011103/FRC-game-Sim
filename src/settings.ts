import { passThemes } from './pass/pass';
// The player's own preferences: look, controls and driving aids. They are
// kept in this browser and have nothing to do with a match's rules.

export type Quality = 'low' | 'medium' | 'high';
export type QualitySetting = 'auto' | Quality;
/** How steeply the angled camera may look down, in degrees. */
export const ANGLED_PITCH = { least: 15, most: 75 } as const;

export type PlayCamera = 'driver' | 'follow' | 'angled';
const PLAY_CAMERA_IDS: PlayCamera[] = ['angled', 'driver', 'follow'];

/** Everything that can be given a key or a gamepad button. */
export type Control =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'turnLeft'
  | 'turnRight'
  | 'intake'
  | 'outtake'
  | 'shoot'
  | 'deploy'
  | 'block'
  | 'climb'
  | 'powerUp'
  | 'humanDrop'
  | 'fieldCentric'
  | 'camera'
  | 'reset'
  | 'pause'
  | 'speed1'
  | 'speed2'
  | 'speed3';

/** In the order shown on the settings screen. Driving and turning use the sticks on a gamepad. */
export const CONTROLS: { id: Control; label: string; stick?: string }[] = [
  { id: 'forward', label: 'Drive forward', stick: 'Left stick' },
  { id: 'back', label: 'Drive back', stick: 'Left stick' },
  { id: 'left', label: 'Drive left', stick: 'Left stick' },
  { id: 'right', label: 'Drive right', stick: 'Left stick' },
  { id: 'turnLeft', label: 'Turn left', stick: 'Right stick' },
  { id: 'turnRight', label: 'Turn right', stick: 'Right stick' },
  { id: 'intake', label: 'Intake' },
  { id: 'outtake', label: 'Outtake' },
  { id: 'shoot', label: 'Shoot' },
  { id: 'deploy', label: 'Expand hopper' },
  { id: 'block', label: 'Blocker' },
  { id: 'climb', label: 'Climb: hold to go up, hold again to come down' },
  { id: 'powerUp', label: 'Use your power-up' },
  { id: 'humanDrop', label: 'Human player: drop the chute onto the field (singleplayer)' },
  { id: 'fieldCentric', label: 'Switch control mode' },
  { id: 'camera', label: 'Switch camera' },
  { id: 'reset', label: 'Reset the field' },
  { id: 'pause', label: 'Pause' },
  { id: 'speed1', label: 'Speed preset 1 (press again for full speed)' },
  { id: 'speed2', label: 'Speed preset 2 (press again for full speed)' },
  { id: 'speed3', label: 'Speed preset 3 (press again for full speed)' },
];

/** How many speed presets there are, and their starting values in percent of top speed. */
export const SPEED_PRESETS = [25, 50, 75];

export interface Settings {
  theme: string;
  quality: QualitySetting;
  /** Shown to other players once there is multiplayer. */
  displayName: string;
  /** 0 to 1. The game has no sounds yet. */
  volume: number;
  defaultCamera: PlayCamera;
  /** Whether a match starts in field-centric control. */
  fieldCentric: boolean;
  /** Intakes run all the time, without holding the button. */
  constantIntake: boolean;
  /** A fixed shooter turns the robot toward its target while shooting. */
  autoAim: boolean;
  /** Pressing shoot once starts shooting and pressing again stops, instead of holding. */
  toggleShoot: boolean;
  /** The same for the intake. */
  toggleIntake: boolean;
  /** Which of the three driver stations the driver-station camera stands at, 1 to 3 from the driver's left. */
  driverStation: number;
  /** How steeply the angled camera looks down at the robot, in degrees. */
  angledPitch: number;
  /** The panel with the robot's name, control mode, frame rate and timings. */
  showInfo: boolean;
  /** The list of controls in the corner during a match. */
  showControls: boolean;
  /** The robot's speed and heading. */
  showSpeed: boolean;
  /** Raised when the default controls change, so saved ones are replaced once. */
  controlsVersion: number;
  /** Bumped when the default camera changes, so every player gets the new one once. */
  cameraVersion: number;
  /** Keyboard: a key code (as in KeyboardEvent.code) for each control. */
  keys: Record<Control, string>;
  /** Gamepad: a button number for each control, or -1 for none. */
  pad: Record<Control, number>;
  /** Driving speed presets, in percent of the robot's top speed, for the speed preset keys. */
  speedPresets: number[];
  /** Drive Pass: the skin worn by each robot, by robot id. */
  skins: Record<string, string>;
  /** Drive Pass: the name color and the badge shown beside the name, by reward id, or '' for none. */
  nameColor: string;
  badge: string;
  /** Drive Pass: the game piece effect equipped, by reward id, or '' for none. A skin's own effect comes first. */
  pieceEffect: string;
  /** Whether fuel effects are drawn at all, on anyone's shots. */
  showPieceEffects: boolean;
  /** Shop: the power-up equipped, by reward id, or '' for none. */
  powerUp: string;
  /** Whether singleplayer matches allow power-ups. Off by default; a match with them on never goes on the leaderboards. */
  singlePowerUps: boolean;
  /** Drive Pass: every reward this player has unlocked, by reward id, with the season they unlocked it in. */
  owned: Record<string, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'srpp',
  quality: 'auto',
  displayName: 'Driver',
  volume: 0.8,
  defaultCamera: 'angled',
  fieldCentric: true,
  constantIntake: false,
  autoAim: true,
  toggleShoot: false,
  toggleIntake: false,
  driverStation: 1,
  angledPitch: 35,
  showInfo: false,
  showControls: true,
  showSpeed: false,
  controlsVersion: 2,
  cameraVersion: 2,
  speedPresets: [...SPEED_PRESETS],
  skins: {},
  nameColor: '',
  badge: '',
  pieceEffect: '',
  showPieceEffects: true,
  powerUp: '',
  singlePowerUps: false,
  owned: {},
  keys: {
    forward: 'KeyW',
    back: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    turnLeft: 'KeyJ',
    turnRight: 'KeyL',
    intake: 'ShiftLeft',
    outtake: 'KeyQ',
    shoot: 'Space',
    deploy: 'KeyE',
    // The blocker and the climber share a key: few robots have either, and hardly any have both.
    block: 'KeyK',
    climb: 'KeyK',
    powerUp: 'KeyG',
    humanDrop: 'KeyH',
    fieldCentric: 'KeyF',
    camera: 'KeyC',
    reset: 'KeyR',
    pause: 'Escape',
    speed1: 'Digit1',
    speed2: 'Digit2',
    speed3: 'Digit3',
  },
  // Standard layout: 0 A, 1 B, 2 X, 3 Y, 4/5 bumpers, 6/7 triggers, 9 Start, 12 D-pad up.
  pad: {
    forward: -1,
    back: -1,
    left: -1,
    right: -1,
    turnLeft: -1,
    turnRight: -1,
    intake: 6,
    outtake: 2,
    shoot: 7,
    deploy: 0,
    block: 1,
    climb: 12,
    powerUp: 13,
    humanDrop: 14,
    fieldCentric: 4,
    camera: 5,
    reset: 3,
    pause: 9,
    speed1: -1,
    speed2: -1,
    speed3: -1,
  },
};

const STORAGE_KEY = 'drive-practice.settings';

/** Reads saved settings, filling anything missing or of the wrong kind from the defaults. */
export function loadSettings(): Settings {
  let saved: unknown = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    // Storage can be blocked or hold something unreadable; use the defaults.
  }
  return readSettings(saved);
}

/** Settings from untrusted data, such as storage or a player's account: anything missing or of the wrong kind is the default. */
export function readSettings(raw: unknown): Settings {
  const saved = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  const settings: Record<string, unknown> = {};
  for (const key of Object.keys(defaults)) {
    settings[key] = typeof saved[key] === typeof defaults[key] ? saved[key] : defaults[key];
  }
  const result = settings as unknown as Settings;
  // Controls saved before the defaults last changed are replaced by the new defaults, once.
  // Everyone starts on the default camera once after it changes; a camera that no longer exists is replaced too.
  if (saved.cameraVersion !== DEFAULT_SETTINGS.cameraVersion || !PLAY_CAMERA_IDS.includes(result.defaultCamera)) {
    result.defaultCamera = DEFAULT_SETTINGS.defaultCamera;
  }
  result.cameraVersion = DEFAULT_SETTINGS.cameraVersion;
  const current = saved.controlsVersion === DEFAULT_SETTINGS.controlsVersion;
  result.controlsVersion = DEFAULT_SETTINGS.controlsVersion;
  result.keys = pick(DEFAULT_SETTINGS.keys, current ? result.keys : {});
  result.pad = pick(DEFAULT_SETTINGS.pad, current ? result.pad : {});
  // Three whole percentages, each from 5 to 100.
  const presets = Array.isArray(result.speedPresets) ? result.speedPresets : [];
  result.speedPresets = SPEED_PRESETS.map((fallback, i) => {
    const value = Number(presets[i]);
    return Number.isFinite(value) ? Math.round(Math.min(100, Math.max(5, value))) : fallback;
  });
  // Skins are kept only as robot id to skin id, both short text.
  const skins: Record<string, string> = {};
  for (const [robot, skin] of Object.entries(result.skins ?? {})) {
    if (typeof skin === 'string' && robot.length <= 80 && skin.length <= 80) skins[robot] = skin;
  }
  result.skins = skins;
  const owned: Record<string, string> = {};
  for (const [reward, season] of Object.entries(result.owned ?? {}).slice(0, 2000)) {
    if (typeof season === 'string' && reward.length <= 80 && season.length <= 80) owned[reward] = season;
  }
  result.owned = owned;
  result.theme = RENAMED_THEMES[result.theme] ?? result.theme;
  if (!THEMES[result.theme]) result.theme = DEFAULT_SETTINGS.theme;
  result.driverStation = Math.min(3, Math.max(1, Math.round(result.driverStation)));
  result.angledPitch = Number.isFinite(result.angledPitch)
    ? Math.min(ANGLED_PITCH.most, Math.max(ANGLED_PITCH.least, Math.round(result.angledPitch)))
    : DEFAULT_SETTINGS.angledPitch;
  return result;
}

/** The defaults, with any saved value of the right kind in their place. Controls that no longer exist are dropped. */
function pick<T extends string | number>(defaults: Record<Control, T>, saved: Partial<Record<string, unknown>>): Record<Control, T> {
  const result = { ...defaults };
  for (const control of Object.keys(defaults) as Control[]) {
    const value = saved[control];
    if (typeof value === typeof defaults[control]) result[control] = value as T;
  }
  return result;
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not being able to save a preference is harmless.
  }
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Space',
  ShiftLeft: 'Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Right Alt',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
};

/** A short name for a key code, as printed on the key. */
export function keyLabel(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →'];

export function padLabel(button: number): string {
  if (button < 0) return 'None';
  return PAD_NAMES[button] ?? `Button ${button}`;
}

/** A color palette for the whole interface. Each one sets the same list of CSS variables. */
export interface Theme {
  name: string;
  colors: {
    bg: string;
    panel: string;
    raised: string;
    border: string;
    text: string;
    muted: string;
    accent: string;
    accentStrong: string;
    onAccent: string;
    good: string;
    warn: string;
    bad: string;
  };
}

/** Palettes that were renamed: the old id, then the id it has now. */
const RENAMED_THEMES: Record<string, string> = { forest: 'paly', violet: 'mvrt' };

/** Built-in palettes, then the ones that are Drive Pass rewards (offered once unlocked). */
export const THEMES: Record<string, Theme> = {
  // The grey-blue of a carbon fibre plate.
  srpp: {
    name: 'SRPP (Default)',
    colors: {
      bg: '#0a0c0e',
      panel: 'rgba(23, 27, 31, 0.94)',
      raised: 'rgba(170, 190, 205, 0.08)',
      border: 'rgba(170, 190, 205, 0.2)',
      text: '#e9edf0',
      muted: '#8f9aa3',
      accent: '#7f95a6',
      accentStrong: '#647b8c',
      onAccent: '#0a0c0e',
      good: '#3fa34d',
      warn: '#d18a26',
      bad: '#c0392b',
    },
  },
  paly: {
    name: 'Paly Robotics',
    colors: {
      bg: '#090f0c',
      panel: 'rgba(15, 24, 19, 0.94)',
      raised: 'rgba(160, 220, 180, 0.08)',
      border: 'rgba(160, 220, 180, 0.2)',
      text: '#e2efe6',
      muted: '#8ea898',
      accent: '#2f9e6a',
      accentStrong: '#22794f',
      onAccent: '#ffffff',
      good: '#4caf50',
      warn: '#d9a13a',
      bad: '#c4513f',
    },
  },
  // Built on the navy #12265D.
  peninsula: {
    name: 'Peninsula Robotics',
    colors: {
      bg: '#04060e',
      panel: 'rgba(9, 15, 36, 0.95)',
      raised: 'rgba(150, 175, 255, 0.09)',
      border: 'rgba(150, 175, 255, 0.22)',
      text: '#e8ecf8',
      muted: '#96a2c4',
      accent: '#4767d1',
      accentStrong: '#1c3a8c',
      onAccent: '#ffffff',
      good: '#3fa36a',
      warn: '#d39a36',
      bad: '#cf4a4a',
    },
  },
  mvrt: {
    name: 'MVRT',
    colors: {
      bg: '#0e0b14',
      panel: 'rgba(24, 19, 34, 0.94)',
      raised: 'rgba(200, 180, 255, 0.08)',
      border: 'rgba(200, 180, 255, 0.2)',
      text: '#ece8f6',
      muted: '#a299b8',
      accent: '#8b6cf0',
      accentStrong: '#6c4bd6',
      onAccent: '#ffffff',
      good: '#46a86b',
      warn: '#d39a36',
      bad: '#cf4a5a',
    },
  },
  // Built on the teal #00B6AE.
  hightide: {
    name: 'HighTide',
    colors: {
      bg: '#050f0f',
      panel: 'rgba(9, 26, 26, 0.94)',
      raised: 'rgba(120, 230, 222, 0.08)',
      border: 'rgba(120, 230, 222, 0.22)',
      text: '#e4f3f2',
      muted: '#86a9a6',
      accent: '#00b6ae',
      accentStrong: '#008f89',
      onAccent: '#031413',
      good: '#4caf50',
      warn: '#d9a13a',
      bad: '#cf4f4a',
    },
  },
};

// Drive Pass themes join the built-in ones, so a saved choice of one is kept.
Object.assign(THEMES, passThemes());

const CSS_NAMES: Record<keyof Theme['colors'], string> = {
  bg: '--bg',
  panel: '--panel',
  raised: '--raised',
  border: '--border',
  text: '--text',
  muted: '--muted',
  accent: '--accent',
  accentStrong: '--accent-strong',
  onAccent: '--on-accent',
  good: '--good',
  warn: '--warn',
  bad: '--bad',
};

/** Switches the whole interface to a palette. Returns the palette's background color. */
export function applyTheme(id: string): string {
  const theme = THEMES[id] ?? THEMES[DEFAULT_SETTINGS.theme];
  const style = document.documentElement.style;
  for (const key of Object.keys(CSS_NAMES) as (keyof Theme['colors'])[]) {
    style.setProperty(CSS_NAMES[key], theme.colors[key]);
  }
  return theme.colors.bg;
}
