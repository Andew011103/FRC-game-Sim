import type { Phase } from '../sim/match';
import type { FieldSpec } from '../sim/subsystems/types';
import type { SimWorld } from '../sim/world';

// A game (one season's challenge) is described as data that the simulation
// and the renderer both read, plus an optional rules object that scores it.
// Lengths are metres, angles are radians.

export interface BoxElement {
  size: [number, number, number];
  position: [number, number, number];
  /** Euler angles, X then Y then Z. */
  rotation?: [number, number, number];
  color: string;
  opacity?: number;
  /** Elements sharing a tag can be lit up together, for example an active goal. */
  tag?: string;
  /** A bar to drive under. Robots labelled as fitting under such bars pass through it. */
  lowBar?: boolean;
}

/** A loose object that robots can push around but not pick up. */
export interface PropElement extends BoxElement {
  mass: number;
}

/** A set of identical game pieces that robots can collect and score. */
export interface PieceGroup {
  shape: 'ball';
  radius: number;
  mass: number;
  color: string;
  /** Starting spots on the floor as [x, z]. */
  positions: [number, number][];
}

export type Alliance = 'blue' | 'red';

export const otherAlliance = (alliance: Alliance): Alliance => (alliance === 'blue' ? 'red' : 'blue');

/** A point an alliance shoots at; turrets aim here. */
export interface Target {
  alliance: Alliance;
  position: [number, number, number];
}

/** A volume that swallows game pieces and sends them back out through its exits. */
export interface Goal {
  alliance: Alliance;
  min: [number, number, number];
  max: [number, number, number];
  exits: { position: [number, number, number]; velocity: [number, number, number] }[];
}

/** A structure robots climb. Rung heights are from the floor, lowest first. */
export interface Tower {
  alliance: Alliance;
  x: number;
  z: number;
  rungs: [number, number, number];
}

/** A rectangle on the floor, in field coordinates. */
export interface Area {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Spawn {
  x: number;
  z: number;
  yaw: number;
  alliance: Alliance;
}

/** How a goal's lights look: steady, pulsing, alliance colour with a white light running round, all white, or dark. */
export type GoalLight = 'on' | 'pulse' | 'chase' | 'white' | 'off';

export interface StatusInfo {
  goalActive: boolean;
  label: string;
  light: GoalLight;
  /** How far the alliance is toward its next bonus that is counted in game pieces. */
  progress?: { value: number; goal: number };
  /** Which part of the driver-controlled period this is, counted from 1. Absent in auto and in practice. */
  stage?: { index: number; total: number };
}

export interface Bonus {
  label: string;
  achieved: boolean;
  detail: string;
}

/** The scoring logic for one game. A fresh one is made for every match. */
export interface GameRules {
  /** The periods of a full match, in order. */
  phases: Phase[];
  /** Called once the field is built, before anything moves. */
  init?(sim: SimWorld): void;
  /** Called after every simulation step. */
  step(sim: SimWorld): void;
  /** Called once when a period finishes. */
  phaseEnded(sim: SimWorld, phase: Phase): void;
  /** What the HUD should say about an alliance's goal right now. */
  status(sim: SimWorld, alliance: Alliance): StatusInfo;
  /** False once robots must stop, for example while the last shots are still being counted. */
  driving?(sim: SimWorld): boolean;
  /** Ranking-point style bonuses for the results screen. */
  bonuses(sim: SimWorld, alliance: Alliance): Bonus[];
}

export interface GameDefinition {
  id: string;
  name: string;
  description?: string;
  field: {
    length: number;
    width: number;
    wallHeight: number;
    /** Depth of each alliance's coloured zone. */
    zoneDepth?: number;
    /** Where the blue driver stands along the alliance wall, for the driver camera. */
    driverStationZ?: number;
    /** How high the field's low bars are above the carpet, if it has any. */
    lowBarClearance?: number;
  };
  statics: BoxElement[];
  props: PropElement[];
  spawns: Spawn[];
  pieces?: PieceGroup[];
  targets?: Target[];
  goals?: Goal[];
  towers?: Tower[];
  /**
   * Where a robot at a spot should pass its pieces instead of shooting at its
   * goal, or null when it should shoot. Only x and z of the spot are used;
   * reach is how far the robot's outline extends along the field from there.
   */
  passTarget?: (alliance: Alliance, from: { x: number; z: number }, reach?: number) => [number, number, number] | null;
  /**
   * Where a robot may be placed before the match: its whole outline must be
   * inside one of these. underBars is true for robots that fit under low bars.
   */
  startAreas?: (alliance: Alliance, underBars: boolean) => Area[];
  /** If given, a starting robot's outline must also reach into this area. */
  startZone?: (alliance: Alliance) => Area;
  /** Choices offered on the menu before a match, such as how much fuel there is. */
  options?: FieldSpec[];
  /** This game set up with the given choices (keyed like `options`). */
  configure?: (values: Record<string, unknown>) => GameDefinition;
  /** Game pieces each robot starts the match holding. */
  preload?: number;
  createRules?: () => GameRules;
}
