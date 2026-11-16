import { configuredGame } from '../games';
import type { Alliance } from '../games/types';
import { NEUTRAL_INPUT, type DriverInput } from '../input/types';
import type { RobotDefinition } from '../robots/types';
import type { MatchMode } from '../sim/match';
import { SimWorld } from '../sim/world';
import type { MatchState } from './snapshot';

// One player hosts: their browser runs the only real simulation. Everyone
// else sends what their driver is asking for and is sent back the field.
// Text messages set things up; the two messages sent many times a second
// (a driver's input and a snapshot of the field) are binary.

/** Raised whenever the messages change, so mismatched versions refuse each other. */
export const PROTOCOL = 2;
export const MAX_PLAYERS = 6;
export const MAX_PER_ALLIANCE = 3;
/** The host sends the field after every this many simulation steps: 30 times a second. */
export const SNAPSHOT_EVERY = 2;
/** And the clock and score after every this many: 5 times a second. */
export const MATCH_STATE_EVERY = 12;

/** A link to one other player. It must deliver messages whole, in order and without loss. */
export interface Transport {
  send(data: string | ArrayBuffer): void;
  onMessage: ((data: string | ArrayBuffer) => void) | null;
  onClose: (() => void) | null;
  close(): void;
}

export interface PlayerInfo {
  id: number;
  name: string;
  robot: RobotDefinition;
  alliance: Alliance;
  /** The player's account, if they are signed in, so others can look up their record. */
  accountId?: string;
}

/** Everything needed to build the same field on every player's computer. Robots are in `players` order. */
export interface MatchSetup {
  gameId: string;
  options: Record<string, unknown>;
  mode: MatchMode;
  seed: number;
  players: PlayerInfo[];
}

export type ClientMessage =
  | { type: 'join'; protocol: number; name: string; robot: unknown; account?: unknown }
  | { type: 'alliance'; alliance: Alliance };

/** A driver's choices that change how the host drives their robot. */
export interface DriverPrefs {
  fieldCentric: boolean;
  autoAim: boolean;
}

export const DEFAULT_PREFS: DriverPrefs = { fieldCentric: true, autoAim: true };

export type HostMessage =
  | { type: 'welcome'; id: number }
  | { type: 'refused'; reason: string }
  | { type: 'lobby'; players: PlayerInfo[] }
  | { type: 'start'; setup: MatchSetup }
  | { type: 'match'; state: MatchState };

const BUTTONS: (keyof DriverInput)[] = ['intake', 'outtake', 'shoot', 'deploy', 'block', 'climbUp', 'climbDown'];
const STICKS = ['driveX', 'driveY', 'turn'] as const;

export function encodeInput(input: DriverInput, prefs: DriverPrefs = DEFAULT_PREFS): ArrayBuffer {
  const bytes = new Int8Array(5);
  bytes[4] = (prefs.fieldCentric ? 1 : 0) | (prefs.autoAim ? 2 : 0);
  STICKS.forEach((stick, i) => (bytes[i] = Math.round(Math.min(1, Math.max(-1, input[stick])) * 127)));
  BUTTONS.forEach((button, i) => {
    if (input[button]) bytes[3] |= 1 << i;
  });
  return bytes.buffer;
}

export function decodeInput(buffer: ArrayBuffer): { input: DriverInput; prefs: DriverPrefs } {
  if (buffer.byteLength !== 5) return { input: NEUTRAL_INPUT, prefs: DEFAULT_PREFS };
  const bytes = new Int8Array(buffer);
  const input: DriverInput = { ...NEUTRAL_INPUT };
  // -128 is not a stick position this game sends; clamp it like any other out-of-range value.
  STICKS.forEach((stick, i) => (input[stick] = Math.max(-127, bytes[i]) / 127));
  BUTTONS.forEach((button, i) => ((input[button] as boolean) = (bytes[3] & (1 << i)) !== 0));
  return { input, prefs: { fieldCentric: (bytes[4] & 1) !== 0, autoAim: (bytes[4] & 2) !== 0 } };
}

/** Builds the field for a multiplayer match. The host simulates it; everyone else only draws theirs. */
export function buildNetWorld(setup: MatchSetup): SimWorld {
  const game = configuredGame(setup.gameId, setup.options);
  const sim = new SimWorld(game, { mode: setup.mode, seed: setup.seed, robots: setup.players.length });
  const placed: Record<Alliance, number> = { blue: 0, red: 0 };
  for (const player of setup.players) {
    const spawnIndex = Math.max(0, game.spawns.findIndex((spawn) => spawn.alliance === player.alliance));
    const spawn = game.spawns[spawnIndex];
    const slot = placed[player.alliance]++;
    // Three robots a side: the usual spot, its mirror across the field, and the middle, set back to clear what is there.
    const toWall = Math.sign(spawn.x) * 0.7;
    const at = [
      { x: spawn.x, z: spawn.z },
      { x: spawn.x, z: -spawn.z },
      { x: spawn.x + toWall, z: 0 },
    ][slot % MAX_PER_ALLIANCE];
    sim.addRobot(player.robot, spawnIndex, { ...at, yaw: spawn.yaw });
  }
  return sim;
}

/** Two ends of a link inside one page, for tests and for trying things without a network. */
export function loopback(): [Transport, Transport] {
  const end = (): Transport & { other: Transport | null; open: boolean } => ({
    other: null,
    open: true,
    onMessage: null,
    onClose: null,
    send(data) {
      if (this.open) this.other?.onMessage?.(data);
    },
    close() {
      if (!this.open) return;
      this.open = false;
      const other = this.other as (Transport & { open: boolean }) | null;
      if (other?.open) {
        other.open = false;
        other.onClose?.();
      }
    },
  });
  const a = end();
  const b = end();
  a.other = b;
  b.other = a;
  return [a, b];
}
