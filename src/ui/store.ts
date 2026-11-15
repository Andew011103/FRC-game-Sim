import { create } from 'zustand';
import type { Alliance, Bonus } from '../games/types';
import type { CameraMode } from '../render/scene';
import { DEFAULT_ROBOT_ID } from '../robots';
import { loadCustomRobots, saveCustomRobots } from '../robots/custom';
import type { RobotDefinition } from '../robots/types';
import { loadSettings, saveSettings, type Quality, type Settings } from '../settings';
import type { MatchMode } from '../sim/match';
import { EMPTY_STATS, type PlayerStats } from '../stats';

/** Where the player's robot starts a match: a spot on the field and a heading in radians. */
export interface StartPose {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Each screen stands alone; none is drawn over another.
 * home: the first screen. singleplayer: set up a match. robots: pick a robot.
 * rules: the match's rules. settings, updates, builder: as named.
 * playing, paused, results: a match.
 */
export type Screen =
  | 'home'
  | 'singleplayer'
  | 'multiplayer'
  | 'robots'
  | 'rules'
  | 'settings'
  | 'updates'
  | 'builder'
  | 'playing'
  | 'paused'
  | 'results';

export const PLAY_CAMERAS: CameraMode[] = ['driver', 'follow', 'top'];

export interface Telemetry {
  speed: number;
  headingDeg: number;
  fps: number;
  gamepad: boolean;
  /** Game pieces inside the robot, and how many it can hold. */
  held: number;
  capacity: number;
  climbLevel: number;
  /** Milliseconds per frame spent on physics and on issuing draw commands. */
  simMs: number;
  drawMs: number;
  /** The graphics quality in use right now (differs from the setting when it is 'auto'). */
  quality: Quality;
}

/** What the scoreboard shows. Null on fields without scoring. */
export interface MatchView {
  mode: MatchMode;
  phaseId: string;
  phaseLabel: string;
  /** Seconds left in the current period and in the whole match. */
  phaseRemaining: number;
  remaining: number;
  /** Which part of teleop this is, counted from 1, or null in auto and in practice. */
  stage: { index: number; total: number } | null;
  blue: AllianceView;
  red: AllianceView;
}

/** One alliance's side of the scoreboard. */
export interface AllianceView {
  score: number;
  /** Whether its goal is counting right now. */
  active: boolean;
  /** Game pieces scored toward the next bonus, or null if the game has none. */
  progress: { value: number; goal: number } | null;
  teams: TeamView[];
}

export interface TeamView {
  name: string;
  number: string | null;
  icon: string | null;
}

/** The multiplayer room this player is in, as the interface shows it. */
export interface RoomView {
  role: 'host' | 'guest';
  code: string;
  /** This player's id among the players. */
  myId: number;
  /** Whether a match has been started. */
  playing: boolean;
  players: { id: number; name: string; robot: string; alliance: Alliance }[];
}

/** The player's account, when they are signed in. */
export interface AccountView {
  id: string;
  email: string;
  name: string;
}

export interface MatchResults {
  blue: number;
  red: number;
  /** One row per scoring category. */
  rows: { label: string; blue: number; red: number }[];
  bonuses: Bonus[];
}

interface GameState {
  ready: boolean;
  screen: Screen;
  gameId: string;
  mode: MatchMode;
  robotId: string;
  /** Which alliance the player drives for. */
  alliance: Alliance;
  /** The player's rule choices for each game that has any, by game id. */
  gameOptions: Record<string, Record<string, unknown>>;
  /** Where the robot starts, or null for the game's usual spot. */
  startPose: StartPose | null;
  /** The player's preferences, saved in this browser. */
  settings: Settings;
  fieldCentric: boolean;
  camera: CameraMode;
  telemetry: Telemetry;
  match: MatchView | null;
  results: MatchResults | null;
  /** Which set-up screen the player came through, and goes back to. */
  menu: 'singleplayer' | 'multiplayer';
  room: RoomView | null;
  /** True while a room is being opened or joined. */
  roomBusy: boolean;
  roomError: string | null;
  setRoom: (room: RoomView | null) => void;
  setRoomBusy: (busy: boolean) => void;
  setRoomError: (error: string | null) => void;
  account: AccountView | null;
  /** The player's multiplayer record: their account's when signed in, otherwise this browser's. */
  record: PlayerStats;
  /** Something the player should know about their account, such as a match that could not be saved. */
  accountNote: string | null;
  setAccount: (account: AccountView | null) => void;
  setRecord: (record: PlayerStats) => void;
  setAccountNote: (note: string | null) => void;
  /** Robots the player made in the builder, saved in this browser. */
  customRobots: RobotDefinition[];
  /** Adds a custom robot, or replaces the one with the same id. */
  saveRobot: (robot: RobotDefinition) => void;
  deleteRobot: (id: string) => void;
  updateSettings: (change: Partial<Settings>) => void;
  setReady: (ready: boolean) => void;
  setScreen: (screen: Screen) => void;
  setMode: (mode: MatchMode) => void;
  setRobotId: (robotId: string) => void;
  setAlliance: (alliance: Alliance) => void;
  setGameOption: (gameId: string, key: string, value: unknown) => void;
  setStartPose: (pose: StartPose | null) => void;
  setFieldCentric: (fieldCentric: boolean) => void;
  setCamera: (camera: CameraMode) => void;
  cycleCamera: () => void;
  setLive: (telemetry: Telemetry, match: MatchView | null) => void;
  showResults: (results: MatchResults) => void;
}

const initialSettings = loadSettings();

/** State shared between the React interface and the game loop. */
export const useGame = create<GameState>((set) => ({
  ready: false,
  screen: 'home',
  gameId: 'rebuilt-2026',
  mode: 'practice',
  robotId: DEFAULT_ROBOT_ID,
  alliance: 'blue',
  gameOptions: {},
  startPose: null,
  settings: initialSettings,
  fieldCentric: initialSettings.fieldCentric,
  camera: initialSettings.defaultCamera,
  telemetry: {
    speed: 0,
    headingDeg: 0,
    fps: 0,
    gamepad: false,
    held: 0,
    capacity: 0,
    climbLevel: 0,
    simMs: 0,
    drawMs: 0,
    quality: 'high',
  },
  match: null,
  results: null,
  menu: 'singleplayer',
  room: null,
  roomBusy: false,
  roomError: null,
  setRoom: (room) => set({ room, roomBusy: false, roomError: null }),
  setRoomBusy: (roomBusy) => set({ roomBusy, roomError: null }),
  setRoomError: (roomError) => set({ roomError, roomBusy: false }),
  account: null,
  record: EMPTY_STATS,
  accountNote: null,
  setAccount: (account) => set({ account, accountNote: null }),
  setRecord: (record) => set({ record }),
  setAccountNote: (accountNote) => set({ accountNote }),
  customRobots: loadCustomRobots(),
  saveRobot: (robot) =>
    set((state) => {
      const exists = state.customRobots.some((other) => other.id === robot.id);
      const customRobots = exists
        ? state.customRobots.map((other) => (other.id === robot.id ? robot : other))
        : [...state.customRobots, robot];
      saveCustomRobots(customRobots);
      return { customRobots };
    }),
  deleteRobot: (id) =>
    set((state) => {
      const customRobots = state.customRobots.filter((robot) => robot.id !== id);
      saveCustomRobots(customRobots);
      // Fall back to a built-in robot if the deleted one was selected.
      return { customRobots, robotId: state.robotId === id ? DEFAULT_ROBOT_ID : state.robotId };
    }),
  updateSettings: (change) =>
    set((state) => {
      const settings = { ...state.settings, ...change };
      saveSettings(settings);
      return { settings };
    }),
  setReady: (ready) => set({ ready }),
  setScreen: (screen) => set(screen === 'singleplayer' || screen === 'multiplayer' ? { screen, menu: screen } : { screen }),
  setMode: (mode) => set({ mode }),
  // Another robot may not fit where the last one was placed, and the other alliance starts at the other end.
  setRobotId: (robotId) => set({ robotId, startPose: null }),
  setAlliance: (alliance) => set({ alliance, startPose: null }),
  setGameOption: (gameId, key, value) =>
    set((state) => ({
      gameOptions: { ...state.gameOptions, [gameId]: { ...state.gameOptions[gameId], [key]: value } },
    })),
  setStartPose: (startPose) => set({ startPose }),
  setFieldCentric: (fieldCentric) => set({ fieldCentric }),
  setCamera: (camera) => set({ camera }),
  cycleCamera: () =>
    set((state) => ({
      camera: PLAY_CAMERAS[(PLAY_CAMERAS.indexOf(state.camera) + 1) % PLAY_CAMERAS.length],
    })),
  setLive: (telemetry, match) => set({ telemetry, match }),
  showResults: (results) => set({ results, screen: 'results' }),
}));
