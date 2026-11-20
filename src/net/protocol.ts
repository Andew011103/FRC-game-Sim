import { configuredGame } from '../games';
import { robotStart } from '../games/start';
import type { Alliance } from '../games/types';
import { NEUTRAL_INPUT, type DriverInput } from '../input/types';
import { OFFICIAL_ROBOTS } from '../robots';
import { sanitizeRobot } from '../robots/custom';
import type { RobotDefinition } from '../robots/types';
import type { MatchMode } from '../sim/match';
import { SimWorld } from '../sim/world';
import type { MatchState } from './snapshot';

// One player hosts: their browser runs the only real simulation. Everyone
// else sends what their driver is asking for and is sent back the field.
// Text messages set things up; the two messages sent many times a second
// (a driver's input and a snapshot of the field) are binary.
//
// Every player keeps a copy of the room and of the field, so when the host
// leaves, the next player to have joined takes the room over under the same
// code and everyone else reconnects to them.

/** Raised whenever the messages change, so mismatched versions refuse each other. */
export const PROTOCOL = 3;
export const MAX_PER_ALLIANCE = 3;
/** Robots on the field at once: three a side. */
export const MAX_PLAYERS = MAX_PER_ALLIANCE * 2;
/** Everyone in a room, spectators included. */
export const MAX_IN_ROOM = 16;
/** The host sends the field after every this many simulation steps: 30 times a second. */
export const SNAPSHOT_EVERY = 2;
/** And the clock and score after every this many: 5 times a second. */
export const MATCH_STATE_EVERY = 12;
export const CHAT_LENGTH = 200;
/** Chat lines a room keeps. */
export const CHAT_KEEP = 100;

/** A link to one other player. It must deliver messages whole, in order and without loss. */
export interface Transport {
  send(data: string | ArrayBuffer): void;
  onMessage: ((data: string | ArrayBuffer) => void) | null;
  onClose: (() => void) | null;
  close(): void;
}

/** A place to drive from: an alliance and its driver station, 1 to 3. */
export interface Seat {
  alliance: Alliance;
  station: number;
}

/** Where a robot starts: a spot on the field and a heading in radians. */
export interface Pose {
  x: number;
  z: number;
  yaw: number;
}

/** Who may change which players' robots: only the host, each alliance's player 1 for their alliance, or each player their own. */
export type RobotRights = 'host' | 'captain' | 'everyone';

export interface RoomSettings {
  robotRights: RobotRights;
  /** Whether the room shows in the list of open matches. */
  listed: boolean;
  mode: MatchMode;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = { robotRights: 'everyone', listed: true, mode: 'match' };

/** Whether one player may change another's robot under the room's rule. The host always may. */
export function mayChangeRobot(
  room: { hostId: number; settings: RoomSettings; players: { id: number; seat: Seat | null }[] },
  actorId: number,
  targetId: number,
): boolean {
  if (actorId === room.hostId) return true;
  const actor = room.players.find((player) => player.id === actorId);
  const target = room.players.find((player) => player.id === targetId);
  if (!actor || !target) return false;
  const rule = room.settings.robotRights;
  if (rule === 'everyone') return actorId === targetId;
  if (rule === 'captain') return actor.seat?.station === 1 && target.seat !== null && target.seat.alliance === actor.seat.alliance;
  return false;
}

export interface PlayerInfo {
  id: number;
  name: string;
  robot: RobotDefinition;
  /** Null for a spectator. */
  seat: Seat | null;
  /** Where their robot starts, or null for their station's usual spot. */
  pose: Pose | null;
  /** The player's account, if they are signed in, so others can look up their record. */
  accountId?: string;
}

export interface ChatLine {
  from: number;
  name: string;
  text: string;
}

/** The room as everyone sees it. Players are in the order they joined, which is also who takes over from the host. */
export interface RoomState {
  hostId: number;
  players: PlayerInfo[];
  settings: RoomSettings;
  /** Whether a match is being played right now. */
  playing: boolean;
  /** The next id to give a player, so a new host carries on counting. */
  nextId: number;
  /** Lets whoever hosts keep the room's entry in the list of open matches. */
  listing: string;
}

/** Everything needed to build the same field on every player's computer. Robots are in `players` order. */
export interface MatchSetup {
  gameId: string;
  options: Record<string, unknown>;
  mode: MatchMode;
  seed: number;
  players: (PlayerInfo & { seat: Seat })[];
}

/** An official robot is sent by its id, so it stays official and cannot be changed on the way; any other robot whole. */
export type RobotWire = string | RobotDefinition;

export const robotToWire = (robot: RobotDefinition): RobotWire => (robot.official ? robot.id : robot);

/** A robot another player sent, checked like an imported file, or null when it cannot be read. */
export function robotFromWire(wire: unknown): RobotDefinition | null {
  if (typeof wire === 'string') return OFFICIAL_ROBOTS.find((robot) => robot.id === wire) ?? null;
  return sanitizeRobot(wire);
}

type WirePlayer = Omit<PlayerInfo, 'robot'> & { robot: RobotWire };

export const playersToWire = <T extends PlayerInfo>(players: T[]): (Omit<T, 'robot'> & { robot: RobotWire })[] =>
  players.map((player) => ({ ...player, robot: robotToWire(player.robot) }));

const cleanAccount = (id: unknown): string | undefined =>
  typeof id === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ? id : undefined;

export const cleanName = (name: unknown): string => (typeof name === 'string' ? name.trim().slice(0, 20) : '') || 'Player';

export function cleanSeat(value: unknown): Seat | null {
  const seat = value as Partial<Seat> | null;
  if (!seat || (seat.alliance !== 'blue' && seat.alliance !== 'red')) return null;
  const station = Math.round(Number(seat.station));
  return station >= 1 && station <= MAX_PER_ALLIANCE ? { alliance: seat.alliance, station } : null;
}

export function cleanPose(value: unknown): Pose | null {
  const pose = value as Partial<Pose> | null;
  if (!pose) return null;
  const numbers = [pose.x, pose.z, pose.yaw].map(Number);
  if (!numbers.every((n) => Number.isFinite(n) && Math.abs(n) < 50)) return null;
  return { x: numbers[0], z: numbers[1], yaw: numbers[2] };
}

/** A player from the host, or null when it cannot be read. */
export function playerFromWire(value: unknown): PlayerInfo | null {
  const player = value as Partial<WirePlayer> | null;
  if (!player || typeof player.id !== 'number') return null;
  const robot = robotFromWire(player.robot);
  if (!robot) return null;
  return {
    id: player.id,
    name: cleanName(player.name),
    robot,
    seat: cleanSeat(player.seat),
    pose: cleanPose(player.pose),
    accountId: cleanAccount(player.accountId),
  };
}

export { cleanAccount };

export type ClientMessage =
  | {
      type: 'join';
      protocol: number;
      name: string;
      robot: RobotWire;
      account?: unknown;
      /** A player coming back after the host changed: the id they had. */
      rejoin?: number;
      /** The seed of the match this player already has on screen, if any. */
      match?: number;
    }
  | { type: 'seat'; id: number; seat: Seat | null }
  | { type: 'pose'; id: number; pose: Pose | null }
  | { type: 'robot'; id: number; robot: RobotWire }
  | { type: 'chat'; text: string };

/** A driver's choices that change how the host drives their robot. */
export interface DriverPrefs {
  fieldCentric: boolean;
  autoAim: boolean;
}

export const DEFAULT_PREFS: DriverPrefs = { fieldCentric: true, autoAim: true };

export type HostMessage =
  | { type: 'welcome'; id: number }
  | { type: 'refused'; reason: string }
  | { type: 'room'; room: Omit<RoomState, 'players'> & { players: WirePlayer[] } }
  | { type: 'pose'; id: number; pose: Pose | null }
  | { type: 'chat'; lines: ChatLine[] }
  | { type: 'start'; setup: Omit<MatchSetup, 'players'> & { players: WirePlayer[] } }
  | { type: 'match'; state: MatchState }
  | { type: 'kicked' }
  /** The host ended the match early: everyone goes back to the room. */
  | { type: 'ended' }
  /** The host is handing the room to another player: everyone reconnects to them under the same code. */
  | { type: 'handover'; hostId: number; stays: boolean };

/** A match setup from the host, or null when it cannot be read. */
export function setupFromWire(value: unknown): MatchSetup | null {
  const setup = value as Partial<Omit<MatchSetup, 'players'> & { players: unknown[] }> | null;
  if (!setup || typeof setup.gameId !== 'string' || !Array.isArray(setup.players)) return null;
  const players = setup.players.map(playerFromWire);
  if (players.some((player) => !player?.seat)) return null;
  return {
    gameId: setup.gameId,
    options: setup.options && typeof setup.options === 'object' ? setup.options : {},
    mode: setup.mode === 'practice' ? 'practice' : 'match',
    seed: Number(setup.seed) || 1,
    players: players as MatchSetup['players'],
  };
}

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
  const sim = new SimWorld(game, { mode: setup.mode, seed: setup.seed, robots: setup.players.length, pauses: true });
  for (const player of setup.players) {
    const { alliance, station } = player.seat;
    const spawnIndex = Math.max(0, game.spawns.findIndex((spawn) => spawn.alliance === alliance));
    sim.addRobot(player.robot, spawnIndex, robotStart(game, player.robot, alliance, player.pose, station));
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
      this.onClose?.();
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
