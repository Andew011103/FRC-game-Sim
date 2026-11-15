import type { Alliance, Bonus, StatusInfo } from '../games/types';
import { NEUTRAL_INPUT, type DriverInput } from '../input/types';
import { sanitizeRobot } from '../robots/custom';
import type { RobotDefinition } from '../robots/types';
import type { MatchMode } from '../sim/match';
import type { SimWorld } from '../sim/world';
import {
  MATCH_STATE_EVERY,
  MAX_PER_ALLIANCE,
  MAX_PLAYERS,
  DEFAULT_PREFS,
  PROTOCOL,
  SNAPSHOT_EVERY,
  buildNetWorld,
  decodeInput,
  encodeInput,
  type ClientMessage,
  type DriverPrefs,
  type HostMessage,
  type MatchSetup,
  type PlayerInfo,
  type Transport,
} from './protocol';
import { SnapshotReader, SnapshotWriter, applyMatchState, matchState, type RobotExtras } from './snapshot';

const cleanName = (name: unknown): string =>
  (typeof name === 'string' ? name.trim().slice(0, 20) : '') || 'Player';

interface Peer {
  transport: Transport;
  /** Null until the player has asked to join and been let in. */
  player: PlayerInfo | null;
  input: DriverInput;
  prefs: DriverPrefs;
}

/**
 * The host's side: gathers players, then runs the match and sends it to them.
 * Whoever shows the field (the game) frees it when it is replaced; sessions never do.
 */
export class HostSession {
  readonly players: PlayerInfo[];
  sim: SimWorld | null = null;
  /** Called whenever someone joins or leaves. */
  onLobby: ((players: PlayerInfo[]) => void) | null = null;
  private readonly peers: Peer[] = [];
  private readonly writer = new SnapshotWriter();
  private nextId = 1;
  private tick = 0;

  constructor(name: string, robot: RobotDefinition) {
    this.players = [{ id: 0, name: cleanName(name), robot, alliance: 'blue' }];
  }

  /** Takes a new connection. The player is in once their request to join arrives. */
  accept(transport: Transport): void {
    const peer: Peer = { transport, player: null, input: NEUTRAL_INPUT, prefs: DEFAULT_PREFS };
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
      if (message?.type === 'join' && !peer.player) this.join(peer, message);
      else if (message?.type === 'alliance' && peer.player) this.setAlliance(peer.player.id, message.alliance);
    };
    transport.onClose = () => {
      this.peers.splice(this.peers.indexOf(peer), 1);
      // Once a match is running the robot stays where it is, undriven.
      peer.input = NEUTRAL_INPUT;
      if (!peer.player || this.sim) return;
      this.players.splice(this.players.indexOf(peer.player), 1);
      this.lobbyChanged();
    };
  }

  private join(peer: Peer, message: Extract<ClientMessage, { type: 'join' }>): void {
    const refuse = (reason: string) => {
      this.send(peer, { type: 'refused', reason });
      peer.transport.close();
    };
    if (message.protocol !== PROTOCOL) return refuse('This player is on a different version of the game.');
    if (this.sim) return refuse('The match has already started.');
    if (this.players.length >= MAX_PLAYERS) return refuse('The match is full.');
    // A robot from another player is checked like an imported file.
    const robot = sanitizeRobot(message.robot);
    if (!robot) return refuse('That robot cannot be read.');

    const count = (alliance: Alliance) => this.players.filter((player) => player.alliance === alliance).length;
    const alliance: Alliance = count('red') < count('blue') && count('red') < MAX_PER_ALLIANCE ? 'red' : 'blue';
    peer.player = { id: this.nextId++, name: cleanName(message.name), robot, alliance };
    this.players.push(peer.player);
    this.send(peer, { type: 'welcome', id: peer.player.id });
    this.lobbyChanged();
  }

  /** Moves a player to the other alliance, if the match has not started and there is room. */
  setAlliance(id: number, alliance: Alliance): void {
    const player = this.players.find((other) => other.id === id);
    if (!player || this.sim || (alliance !== 'blue' && alliance !== 'red') || player.alliance === alliance) return;
    if (this.players.filter((other) => other.alliance === alliance).length >= MAX_PER_ALLIANCE) return;
    player.alliance = alliance;
    this.lobbyChanged();
  }

  private lobbyChanged(): void {
    this.broadcast({ type: 'lobby', players: this.players });
    this.onLobby?.(this.players);
  }

  /** Builds the field and tells every player to do the same. */
  start(gameId: string, options: Record<string, unknown>, mode: MatchMode, seed = Date.now() % 1e9): SimWorld {
    // Anyone who dropped out of the last match is not in this one.
    for (let i = this.players.length - 1; i > 0; i--) {
      if (!this.peers.some((peer) => peer.player === this.players[i])) this.players.splice(i, 1);
    }
    const setup: MatchSetup = { gameId, options, mode, seed, players: [...this.players] };
    this.sim = buildNetWorld(setup);
    this.tick = 0;
    this.writer.requestFull();
    this.broadcast({ type: 'start', setup });
    return this.sim;
  }

  /** Moves the match on one step with everyone's latest input, and sends out the result when it is due. */
  step(hostInput: DriverInput): void {
    const { sim } = this;
    if (!sim) return;
    const inputs = this.players.map((player, index) => {
      if (player.id === 0) return hostInput;
      const peer = this.peers.find((other) => other.player === player);
      if (!peer) return NEUTRAL_INPUT;
      sim.robots[index].fieldCentric = peer.prefs.fieldCentric;
      sim.robots[index].autoAim = peer.prefs.autoAim;
      return peer.input;
    });
    sim.step(inputs);
    this.tick++;
    if (this.tick % SNAPSHOT_EVERY === 0) {
      const snapshot = this.writer.write(sim, this.tick);
      for (const peer of this.peers) if (peer.player) peer.transport.send(snapshot);
    }
    if (this.tick % MATCH_STATE_EVERY === 0 || sim.match?.finished) {
      const state = matchState(sim);
      if (state) this.broadcast({ type: 'match', state });
    }
  }

  close(): void {
    for (const peer of [...this.peers]) peer.transport.close();
    this.sim = null;
  }

  private send(peer: Peer, message: HostMessage): void {
    peer.transport.send(JSON.stringify(message));
  }

  private broadcast(message: HostMessage): void {
    const text = JSON.stringify(message);
    for (const peer of this.peers) if (peer.player) peer.transport.send(text);
  }
}

/** A joining player's side: sends its driver's input and keeps a copy of the host's field to draw. */
export class ClientSession {
  /** This player's id, once the host has let them in. */
  id: number | null = null;
  players: PlayerInfo[] = [];
  /** A copy of the host's field. It is never simulated here, only set from snapshots. */
  sim: SimWorld | null = null;
  /** Which robot on the field is this player's. */
  robotIndex = -1;
  /** What the host last said about each alliance's goal. */
  status: Record<Alliance, StatusInfo> | null = null;
  /** And about each alliance's bonuses, for the results. */
  bonuses: Record<Alliance, Bonus[]> | null = null;
  /** Why the host turned this player away, if it did. */
  refused: string | null = null;
  closed = false;
  onLobby: ((players: PlayerInfo[]) => void) | null = null;
  onStart: ((sim: SimWorld) => void) | null = null;
  onClose: (() => void) | null = null;
  private reader = new SnapshotReader();
  private snapshotAt = 0;

  constructor(
    private readonly transport: Transport,
    name: string,
    robot: RobotDefinition,
    /** The time in seconds, for blending between snapshots. */
    private readonly now: () => number = () => performance.now() / 1000,
  ) {
    transport.onMessage = (data) => this.receive(data);
    transport.onClose = () => {
      this.closed = true;
      this.onClose?.();
    };
    const join: ClientMessage = { type: 'join', protocol: PROTOCOL, name, robot };
    transport.send(JSON.stringify(join));
  }

  private receive(data: string | ArrayBuffer): void {
    if (typeof data !== 'string') {
      if (!this.sim) return;
      this.reader.apply(this.sim, data);
      this.snapshotAt = this.now();
      return;
    }
    const message = JSON.parse(data) as HostMessage;
    if (message.type === 'welcome') this.id = message.id;
    else if (message.type === 'refused') this.refused = message.reason;
    else if (message.type === 'lobby') {
      this.players = message.players;
      this.onLobby?.(this.players);
    } else if (message.type === 'start') {
      this.players = message.setup.players;
      this.sim = buildNetWorld(message.setup);
      this.robotIndex = this.players.findIndex((player) => player.id === this.id);
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

  /** Sends what this player's driver is asking for. Call once a frame while playing. */
  sendInput(input: DriverInput, prefs: DriverPrefs = DEFAULT_PREFS): void {
    if (!this.closed && this.sim) this.transport.send(encodeInput(input, prefs));
  }

  /** Asks the host to move this player to the other alliance. */
  chooseAlliance(alliance: Alliance): void {
    const message: ClientMessage = { type: 'alliance', alliance };
    if (!this.closed) this.transport.send(JSON.stringify(message));
  }

  /** How far the drawing should be between the last two snapshots, from 0 to 1. */
  blend(): number {
    return Math.min(1, Math.max(0, (this.now() - this.snapshotAt) / (SNAPSHOT_EVERY / 60)));
  }

  /** What the host last said about this player's robot beyond its position. */
  extras(): RobotExtras | null {
    return this.reader.extras[this.robotIndex] ?? null;
  }

  close(): void {
    this.transport.close();
    this.sim = null;
  }
}
