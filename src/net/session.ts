import type { Alliance, Bonus, StatusInfo } from '../games/types';
import { NEUTRAL_INPUT, type DriverInput } from '../input/types';
import type { RobotDefinition } from '../robots/types';
import type { MatchMode } from '../sim/match';
import type { SimWorld } from '../sim/world';
import {
  CHAT_KEEP,
  CHAT_LENGTH,
  DEFAULT_PREFS,
  DEFAULT_ROOM_SETTINGS,
  MATCH_STATE_EVERY,
  MAX_IN_ROOM,
  MAX_PER_ALLIANCE,
  PROTOCOL,
  SNAPSHOT_EVERY,
  buildNetWorld,
  cleanAccount,
  cleanName,
  cleanPose,
  cleanSeat,
  decodeInput,
  encodeInput,
  mayChangeRobot,
  playerFromWire,
  playersToWire,
  robotFromWire,
  robotToWire,
  setupFromWire,
  type ChatLine,
  type ClientMessage,
  type DriverPrefs,
  type HostMessage,
  type MatchSetup,
  type PlayerInfo,
  type Pose,
  type RoomSettings,
  type RoomState,
  type Seat,
  type Transport,
} from './protocol';
import { SnapshotReader, SnapshotWriter, applyMatchState, matchState, type RobotExtras } from './snapshot';

interface Peer {
  transport: Transport;
  /** Null until the player has asked to join and been let in. */
  player: PlayerInfo | null;
  input: DriverInput;
  prefs: DriverPrefs;
  /** When this player's recent chat lines were sent, to keep anyone from flooding the room. */
  chatTimes: number[];
}

/** At most this many chat lines from one player in CHAT_WINDOW seconds. */
const CHAT_BURST = 5;
const CHAT_WINDOW = 5;
/** Seconds a player who was in the room before the host changed has to reconnect before their place is given up. */
export const REJOIN_SECONDS = 30;

const sameSeat = (a: Seat | null, b: Seat | null): boolean =>
  a === b || (a !== null && b !== null && a.alliance === b.alliance && a.station === b.station);

/** Everything a new host carries on from: the room, its chat and the match being played. */
export interface RoomCarryOver {
  room: RoomState;
  chat: ChatLine[];
  sim: SimWorld | null;
  setup: MatchSetup | null;
}

/**
 * The host's side: keeps the room, runs the match and sends it to everyone.
 * Whoever shows the field (the game) frees it when it is replaced; sessions never do.
 */
export class HostSession {
  readonly myId: number;
  players: PlayerInfo[];
  settings: RoomSettings;
  chat: ChatLine[] = [];
  sim: SimWorld | null = null;
  /** The match being played: who drives which robot. */
  setup: MatchSetup | null = null;
  /** Called whenever the room changes. */
  onRoom: ((room: RoomState) => void) | null = null;
  onChat: ((lines: ChatLine[]) => void) | null = null;
  onPose: ((id: number, pose: Pose | null) => void) | null = null;
  /** Players from before the host changed who have not reconnected yet, by id, with the time they have left. */
  private readonly expected = new Map<number, number>();
  private readonly peers: Peer[] = [];
  private readonly writer = new SnapshotWriter();
  private nextId: number;
  private readonly listing: string;
  private tick = 0;
  private finishedSent = false;
  private clock = 0;

  constructor(name: string, robot: RobotDefinition, accountId?: string, carry?: RoomCarryOver & { myId: number }) {
    if (carry) {
      // Taking over a room: everyone else in it is given a little while to reconnect.
      this.myId = carry.myId;
      this.players = carry.room.players.filter((player) => player.id !== carry.room.hostId);
      this.settings = carry.room.settings;
      this.chat = carry.chat;
      this.nextId = carry.room.nextId;
      this.listing = carry.room.listing;
      this.sim = carry.sim;
      this.setup = carry.setup;
      carry.sim?.takeOver();
      for (const player of this.players) if (player.id !== this.myId) this.expected.set(player.id, REJOIN_SECONDS);
      this.finishedSent = carry.sim?.match?.finished ?? false;
      this.writer.requestFull();
    } else {
      this.myId = 0;
      this.players = [
        { id: 0, name: cleanName(name), robot, seat: { alliance: 'blue', station: 1 }, pose: null, accountId: cleanAccount(accountId) },
      ];
      this.settings = { ...DEFAULT_ROOM_SETTINGS };
      this.nextId = 1;
      this.listing = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    }
  }

  /** Whether a match is being played right now. */
  get playing(): boolean {
    return this.sim !== null && this.sim.match?.finished !== true;
  }

  room(): RoomState {
    return {
      hostId: this.myId,
      players: this.players,
      settings: this.settings,
      playing: this.playing,
      nextId: this.nextId,
      listing: this.listing,
    };
  }

  /** Takes a new connection. The player is in once their request to join arrives. */
  accept(transport: Transport): void {
    const peer: Peer = { transport, player: null, input: NEUTRAL_INPUT, prefs: DEFAULT_PREFS, chatTimes: [] };
    this.peers.push(peer);
    transport.onMessage = (data) => {
      if (typeof data !== 'string') {
        if (peer.player) ({ input: peer.input, prefs: peer.prefs } = decodeInput(data));
        return;
      }
      let message: ClientMessage;
      try {
        message = JSON.parse(data) as ClientMessage;
      } catch {
        return;
      }
      if (message?.type === 'join') {
        if (!peer.player) this.join(peer, message);
      } else if (peer.player) {
        this.request(peer.player.id, message, peer);
      }
    };
    transport.onClose = () => {
      const index = this.peers.indexOf(peer);
      if (index === -1) return;
      this.peers.splice(index, 1);
      // A player who leaves gives up their place. Mid-match, their robot stays where it is, undriven.
      peer.input = NEUTRAL_INPUT;
      if (!peer.player) return;
      const at = this.players.indexOf(peer.player);
      if (at !== -1) this.players.splice(at, 1);
      this.roomChanged();
    };
  }

  private join(peer: Peer, message: Extract<ClientMessage, { type: 'join' }>): void {
    const refuse = (reason: string) => {
      this.send(peer, { type: 'refused', reason });
      peer.transport.close();
    };
    if (message.protocol !== PROTOCOL) return refuse('This player is on a different version of the game.');
    const robot = robotFromWire(message.robot);
    if (!robot) return refuse('That robot cannot be read.');

    // Someone who was here before the host changed keeps their place.
    const back = typeof message.rejoin === 'number' && this.expected.has(message.rejoin) ? message.rejoin : null;
    if (back !== null) {
      this.expected.delete(back);
      peer.player = this.players.find((player) => player.id === back) ?? null;
    }
    if (!peer.player) {
      if (this.players.length >= MAX_IN_ROOM) return refuse('The room is full.');
      // A player who arrives during a match watches it, and can take a seat once it is over.
      peer.player = {
        id: this.nextId++,
        name: cleanName(message.name),
        robot,
        seat: this.playing ? null : this.freeSeat(),
        pose: null,
        accountId: cleanAccount(message.account),
      };
      this.players.push(peer.player);
    }
    this.send(peer, { type: 'welcome', id: peer.player.id });
    this.send(peer, { type: 'chat', lines: this.chat });
    if (this.sim && this.setup && message.match !== this.setup.seed) this.send(peer, { type: 'start', setup: this.wireSetup(this.setup) });
    this.writer.requestFull();
    this.roomChanged();
    const state = this.sim && matchState(this.sim);
    if (state) this.send(peer, { type: 'match', state });
  }

  /** The first empty driver station, on the alliance with fewer players, or null when all six are taken. */
  private freeSeat(): Seat | null {
    const taken = (seat: Seat) => this.players.some((player) => sameSeat(player.seat, seat));
    const count = (alliance: Alliance) => this.players.filter((player) => player.seat?.alliance === alliance).length;
    const order: Alliance[] = count('red') < count('blue') ? ['red', 'blue'] : ['blue', 'red'];
    for (const alliance of order) {
      for (let station = 1; station <= MAX_PER_ALLIANCE; station++) {
        if (!taken({ alliance, station })) return { alliance, station };
      }
    }
    return null;
  }

  /** Whether one player may change another's robot under the room's rule. The host always may. */
  canChangeRobot(actorId: number, targetId: number): boolean {
    return mayChangeRobot(this.room(), actorId, targetId);
  }

  /** Something a player asks for: a seat, a starting spot, a robot or a chat line. The host's own requests come here too. */
  request(actorId: number, message: ClientMessage, peer?: Peer): void {
    const isHost = actorId === this.myId;
    if (message.type === 'join') return;
    if (message.type === 'chat') {
      const text = typeof message.text === 'string' ? message.text.trim().slice(0, CHAT_LENGTH) : '';
      const actor = this.players.find((player) => player.id === actorId);
      if (!text || !actor) return;
      if (peer) {
        peer.chatTimes = peer.chatTimes.filter((at) => this.clock - at < CHAT_WINDOW);
        if (peer.chatTimes.length >= CHAT_BURST) return;
        peer.chatTimes.push(this.clock);
      }
      this.addChat({ from: actorId, name: actor.name, text });
      return;
    }
    const target = this.players.find((player) => player.id === message.id);
    if (!target || (!isHost && message.id !== actorId && message.type !== 'robot')) return;

    if (message.type === 'seat') {
      const seat = cleanSeat(message.seat);
      if (message.seat !== null && !seat) return;
      const holder = seat ? this.players.find((player) => player !== target && sameSeat(player.seat, seat)) : undefined;
      // Players may move themselves to an empty station; the host may move anyone, swapping with whoever is there.
      if (holder && !isHost) return;
      if (holder) {
        holder.seat = target.seat;
        holder.pose = null;
      }
      if (!sameSeat(target.seat, seat)) target.pose = null;
      target.seat = seat;
      this.roomChanged();
    } else if (message.type === 'pose') {
      target.pose = cleanPose(message.pose);
      this.broadcast({ type: 'pose', id: target.id, pose: target.pose });
      this.onPose?.(target.id, target.pose);
    } else if (message.type === 'robot') {
      if (!this.canChangeRobot(actorId, target.id)) return;
      const robot = robotFromWire(message.robot);
      if (!robot) return;
      target.robot = robot;
      // Another robot may not fit where the last one was placed.
      target.pose = null;
      this.roomChanged();
    }
  }

  private addChat(line: ChatLine): void {
    this.chat.push(line);
    if (this.chat.length > CHAT_KEEP) this.chat.splice(0, this.chat.length - CHAT_KEEP);
    this.broadcast({ type: 'chat', lines: [line] });
    this.onChat?.([line]);
  }

  /** Host only: changes the room's settings. */
  setSettings(change: Partial<RoomSettings>): void {
    this.settings = { ...this.settings, ...change };
    this.roomChanged();
  }

  /** Host only: sends a player out of the room. */
  kick(id: number): void {
    const peer = this.peers.find((other) => other.player?.id === id);
    if (!peer || id === this.myId) return;
    this.send(peer, { type: 'kicked' });
    peer.transport.close();
  }

  /** Host only: tells everyone another player is taking the room over, and whether this host stays in it. The caller then lets go of the room. */
  handOver(id: number, stays: boolean): boolean {
    if (id === this.myId || !this.peers.some((peer) => peer.player?.id === id)) return false;
    this.broadcast({ type: 'handover', hostId: id, stays });
    return true;
  }

  /** Who should take the room over if this host leaves: the player who joined earliest and is still here. */
  successor(): number | null {
    return this.players.find((player) => player.id !== this.myId && this.peers.some((peer) => peer.player === player))?.id ?? null;
  }

  private roomChanged(): void {
    const room = this.room();
    this.broadcast({ type: 'room', room: { ...room, players: playersToWire(room.players) } });
    this.onRoom?.(room);
  }

  private wireSetup(setup: MatchSetup): Extract<HostMessage, { type: 'start' }>['setup'] {
    return { ...setup, players: playersToWire(setup.players) };
  }

  /** Builds the field with everyone who has a seat and tells every player to do the same. */
  start(gameId: string, options: Record<string, unknown>, mode: MatchMode = this.settings.mode, seed = Date.now() % 1e9): SimWorld {
    const seated = this.players.filter((player): player is PlayerInfo & { seat: Seat } => player.seat !== null);
    // Robots are added blue then red, by station, so everyone's field is built the same way.
    seated.sort((a, b) => (a.seat.alliance === b.seat.alliance ? a.seat.station - b.seat.station : a.seat.alliance === 'blue' ? -1 : 1));
    const setup: MatchSetup = { gameId, options, mode, seed, players: seated.map((player) => ({ ...player })) };
    this.setup = setup;
    this.sim = buildNetWorld(setup);
    this.tick = 0;
    this.finishedSent = false;
    this.writer.requestFull();
    this.broadcast({ type: 'start', setup: this.wireSetup(setup) });
    this.roomChanged();
    return this.sim;
  }

  /** Which robot on the field a player drives in this match, or -1. */
  robotOf(id: number): number {
    return this.setup?.players.findIndex((player) => player.id === id) ?? -1;
  }

  /** Moves the match on one step with everyone's latest input, and sends out the result when it is due. */
  step(hostInput: DriverInput): void {
    this.clock += 1 / 60;
    // Players from before the host changed who never came back give up their places.
    for (const [id, left] of this.expected) {
      if (left - 1 / 60 > 0) {
        this.expected.set(id, left - 1 / 60);
        continue;
      }
      this.expected.delete(id);
      const at = this.players.findIndex((player) => player.id === id);
      if (at !== -1) this.players.splice(at, 1);
      this.roomChanged();
    }
    const { sim, setup } = this;
    if (!sim || !setup) return;
    const inputs = setup.players.map((player, index) => {
      if (player.id === this.myId) return hostInput;
      const peer = this.peers.find((other) => other.player?.id === player.id);
      if (!peer) return NEUTRAL_INPUT;
      sim.robots[index].fieldCentric = peer.prefs.fieldCentric;
      sim.robots[index].autoAim = peer.prefs.autoAim;
      return peer.input;
    });
    const wasPlaying = this.playing;
    sim.step(inputs);
    this.tick++;
    if (this.tick % SNAPSHOT_EVERY === 0) {
      const snapshot = this.writer.write(sim, this.tick);
      for (const peer of this.peers) if (peer.player) peer.transport.send(snapshot);
    }
    // The final state is sent once, as soon as the match is over.
    const justFinished = sim.match?.finished === true && !this.finishedSent;
    if (this.tick % MATCH_STATE_EVERY === 0 || justFinished) {
      const state = matchState(sim);
      if (state) this.broadcast({ type: 'match', state });
      if (justFinished) this.finishedSent = true;
    }
    // Once it is over, the room is open to take seats again.
    if (wasPlaying && !this.playing) this.roomChanged();
  }

  close(): void {
    for (const peer of [...this.peers]) peer.transport.close();
  }

  private send(peer: Peer, message: HostMessage): void {
    peer.transport.send(JSON.stringify(message));
  }

  private broadcast(message: HostMessage): void {
    const text = JSON.stringify(message);
    for (const peer of this.peers) if (peer.player) peer.transport.send(text);
  }
}

/** Why a guest's link to the host ended. */
export type ClosedBecause = 'refused' | 'kicked' | 'left' | 'handover' | 'lost';

/** A joining player's side: sends its driver's input and keeps a copy of the room and the host's field. */
export class ClientSession {
  /** This player's id, once the host has let them in. */
  id: number | null = null;
  room: RoomState | null = null;
  chat: ChatLine[] = [];
  /** A copy of the host's field. It is never simulated here, only set from snapshots. */
  sim: SimWorld | null = null;
  setup: MatchSetup | null = null;
  /** Which robot on the field is this player's, or -1 when watching. */
  robotIndex = -1;
  /** What the host last said about each alliance's goal. */
  status: Record<Alliance, StatusInfo> | null = null;
  /** And about each alliance's bonuses, for the results. */
  bonuses: Record<Alliance, Bonus[]> | null = null;
  /** Why the host turned this player away, if it did. */
  refused: string | null = null;
  /** Who the host said is taking the room over, if it did. */
  handoverTo: number | null = null;
  /** Whether the old host is staying in the room as a guest. */
  handoverStays = false;
  closedBecause: ClosedBecause | null = null;
  onRoom: ((room: RoomState) => void) | null = null;
  onChat: ((lines: ChatLine[]) => void) | null = null;
  onPose: ((id: number, pose: Pose | null) => void) | null = null;
  onStart: ((sim: SimWorld) => void) | null = null;
  onClose: ((because: ClosedBecause) => void) | null = null;
  private reader = new SnapshotReader();
  private snapshotAt = 0;
  private kicked = false;

  constructor(
    private readonly transport: Transport,
    name: string,
    robot: RobotDefinition,
    /** The time in seconds, for blending between snapshots. */
    private readonly now: () => number = () => performance.now() / 1000,
    accountId?: string,
    /** When reconnecting after the host changed: the id this player had and the match already on screen. */
    carry?: { id: number; sim: SimWorld | null; setup: MatchSetup | null; chat: ChatLine[] },
  ) {
    if (carry) {
      this.sim = carry.sim;
      this.setup = carry.setup;
      this.chat = carry.chat;
      this.robotIndex = carry.setup?.players.findIndex((player) => player.id === carry.id) ?? -1;
    }
    transport.onMessage = (data) => this.receive(data);
    transport.onClose = () => {
      this.closedBecause ??= this.kicked ? 'kicked' : this.refused ? 'refused' : this.handoverTo !== null ? 'handover' : 'lost';
      this.onClose?.(this.closedBecause);
    };
    const join: ClientMessage = {
      type: 'join',
      protocol: PROTOCOL,
      name,
      robot: robotToWire(robot),
      account: accountId,
      rejoin: carry?.id,
      match: carry?.setup?.seed,
    };
    transport.send(JSON.stringify(join));
  }

  private receive(data: string | ArrayBuffer): void {
    if (typeof data !== 'string') {
      if (!this.sim) return;
      this.reader.apply(this.sim, data);
      this.snapshotAt = this.now();
      return;
    }
    let message: HostMessage;
    try {
      message = JSON.parse(data) as HostMessage;
    } catch {
      return;
    }
    if (message.type === 'welcome') this.id = message.id;
    else if (message.type === 'refused') this.refused = message.reason;
    else if (message.type === 'kicked') this.kicked = true;
    else if (message.type === 'handover') {
      this.handoverTo = Number(message.hostId);
      this.handoverStays = message.stays === true;
    }
    else if (message.type === 'room') {
      const players = (Array.isArray(message.room.players) ? message.room.players : [])
        .map(playerFromWire)
        .filter((player): player is PlayerInfo => player !== null);
      this.room = { ...message.room, players, settings: { ...DEFAULT_ROOM_SETTINGS, ...message.room.settings } };
      this.onRoom?.(this.room);
    } else if (message.type === 'chat') {
      const lines = (Array.isArray(message.lines) ? message.lines : []).map((line) => ({
        from: Number(line.from),
        name: cleanName(line.name),
        text: String(line.text ?? '').slice(0, CHAT_LENGTH),
      }));
      this.chat = [...this.chat, ...lines].slice(-CHAT_KEEP);
      this.onChat?.(lines);
    } else if (message.type === 'pose') {
      const player = this.room?.players.find((other) => other.id === message.id);
      if (player) player.pose = cleanPose(message.pose);
      this.onPose?.(message.id, cleanPose(message.pose));
    } else if (message.type === 'start') {
      const setup = setupFromWire(message.setup);
      if (!setup) return;
      this.setup = setup;
      this.sim = buildNetWorld(setup);
      this.robotIndex = setup.players.findIndex((player) => player.id === this.id);
      this.reader = new SnapshotReader();
      this.status = null;
      this.bonuses = null;
      this.onStart?.(this.sim);
    } else if (message.type === 'match' && this.sim) {
      applyMatchState(this.sim, message.state);
      this.status = message.state.status;
      this.bonuses = message.state.bonuses;
    }
  }

  private send(message: ClientMessage): void {
    if (!this.closedBecause) this.transport.send(JSON.stringify(message));
  }

  /** Sends what this player's driver is asking for. Call once a frame while playing. */
  sendInput(input: DriverInput, prefs: DriverPrefs = DEFAULT_PREFS): void {
    if (!this.closedBecause && this.sim && this.robotIndex !== -1) this.transport.send(encodeInput(input, prefs));
  }

  /** Asks the host for a seat, a starting spot, a robot or a chat line. */
  request(message: ClientMessage): void {
    this.send(message);
  }

  /** How far the drawing should be between the last two snapshots, from 0 to 1. */
  blend(): number {
    return Math.min(1, Math.max(0, (this.now() - this.snapshotAt) / (SNAPSHOT_EVERY / 60)));
  }

  /** What the host last said about this player's robot beyond its position. */
  extras(): RobotExtras | null {
    return this.reader.extras[this.robotIndex] ?? null;
  }

  /** Leaves. The field copy is kept for whoever shows it. */
  close(): void {
    this.closedBecause ??= 'left';
    this.transport.close();
  }
}
