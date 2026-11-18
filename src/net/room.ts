import { listRoom, unlistRoom } from '../account/account';
import { findRobot } from '../robots';
import type { RobotDefinition } from '../robots/types';
import type { SimWorld } from '../sim/world';
import { useGame, type RoomView } from '../ui/store';
import { CODE_TAKEN, joinRoom, openRoom, type Link } from './peer';
import { robotToWire, type ChatLine, type MatchSetup, type Pose, type RoomSettings, type RoomState, type Seat } from './protocol';
import { ClientSession, HostSession, type ClosedBecause } from './session';

/** How long players keep trying to reach the room after its host leaves. */
const RECONNECT_SECONDS = 60;
/** Each player in line to take the room over waits this much longer than the one before. */
const TAKEOVER_STAGGER = 10;
/** How often the host tells the list of open matches the room is still there. */
const LISTING_SECONDS = 15;
/** A robot being dragged to its starting spot is sent on at most this often. */
const POSE_SECONDS = 0.1;

const wait = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** What a player carries into the room under its next host. */
interface Carry {
  myId: number;
  room: RoomState;
  chat: ChatLine[];
  sim: SimWorld | null;
  setup: MatchSetup | null;
}

/** The one multiplayer room this page can be in: either hosting it or a guest in it. */
class Multiplayer {
  host: HostSession | null = null;
  client: ClientSession | null = null;
  /** Set by the game: puts a match that is starting on screen, with this player's robot (or -1 to watch) and driver station. */
  onMatch: ((sim: SimWorld, robotIndex: number, station: number) => void) | null = null;
  private link: Link | null = null;
  private code = '';
  /** True from leaving until the next room, so a link that closes on its way out is not taken for the host leaving. */
  private left = true;
  private notice: string | null = null;
  private listingTimer: ReturnType<typeof setInterval> | null = null;
  private listedAs: { code: string; secret: string } | null = null;

  constructor() {
    // A robot picked on the robot selector while in a room becomes this player's robot there.
    useGame.subscribe((state, previous) => {
      if (state.robotId === previous.robotId || !state.room) return;
      const id = this.myId();
      if (id !== null) this.setRobot(id, findRobot(state.robotId, state.customRobots));
    });
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => this.leave());
  }

  private me() {
    const { settings, robotId, customRobots, account } = useGame.getState();
    return { name: settings.displayName, robot: findRobot(robotId, customRobots), accountId: account?.id };
  }

  private myId(): number | null {
    return this.host ? this.host.myId : (this.client?.id ?? null);
  }

  /** Shows the room as it now stands. */
  private publish(): void {
    const room: RoomState | null = this.host ? this.host.room() : (this.client?.room ?? null);
    const myId = this.myId();
    const current = useGame.getState().room;
    if (!room || myId === null) {
      // Between hosts the last known room stays on screen, with a note.
      if (current) useGame.getState().setRoom({ ...current, notice: this.notice });
      return;
    }
    const view: RoomView = {
      role: this.host ? 'host' : 'guest',
      code: this.code,
      myId,
      hostId: room.hostId,
      playing: room.playing,
      players: room.players.map(({ id, name, robot, seat, pose, accountId }) => ({ id, name, robot, seat, pose, accountId })),
      settings: room.settings,
      chat: this.host ? this.host.chat : (this.client?.chat ?? []),
      notice: this.notice,
      hasMatch: (this.host?.sim ?? this.client?.sim ?? null) !== null,
    };
    useGame.getState().setRoom(view);
    this.updateListing();
  }

  /** Opens a room and waits in it for other players. */
  async hostRoom(): Promise<void> {
    const state = useGame.getState();
    if (state.roomBusy || this.link) return;
    state.setRoomBusy(true);
    try {
      const { name, robot, accountId } = this.me();
      const host = new HostSession(name, robot, accountId);
      host.setSettings({ mode: useGame.getState().mode });
      const link = await openRoom((transport) => host.accept(transport));
      this.left = false;
      this.attachHost(host, link);
    } catch (error) {
      useGame.getState().setRoomError(error instanceof Error ? error.message : String(error));
    }
  }

  /** Joins the room with a code. During a match, the player watches until it is over. */
  async join(code: string): Promise<void> {
    const state = useGame.getState();
    if (state.roomBusy || this.link) return;
    state.setRoomBusy(true);
    try {
      const { name, robot, accountId } = this.me();
      const { transport, link } = await joinRoom(code);
      this.left = false;
      this.attachClient(new ClientSession(transport, name, robot, undefined, accountId), link);
    } catch (error) {
      useGame.getState().setRoomError(error instanceof Error ? error.message : String(error));
    }
  }

  private attachHost(host: HostSession, link: Link): void {
    this.host = host;
    this.client = null;
    this.link = link;
    this.code = link.code;
    this.notice = null;
    host.onRoom = () => this.publish();
    host.onChat = () => this.publish();
    host.onPose = () => this.publish();
    this.publish();
    this.startListing();
  }

  private attachClient(client: ClientSession, link: Link): void {
    this.client = client;
    this.host = null;
    this.link = link;
    this.code = link.code;
    client.onRoom = () => {
      this.notice = null;
      this.publish();
    };
    client.onChat = () => this.publish();
    client.onPose = () => this.publish();
    client.onStart = (sim) => {
      this.publish();
      this.showMatch(sim, client.setup, client.id ?? -1);
    };
    client.onClose = (because) => {
      if (this.client === client) this.lost(client, because);
    };
    this.publish();
  }

  private showMatch(sim: SimWorld, setup: MatchSetup | null, myId: number): void {
    const index = setup?.players.findIndex((player) => player.id === myId) ?? -1;
    this.onMatch?.(sim, index, index === -1 ? 1 : setup!.players[index].seat.station);
  }

  /** Host only: starts a match, or starts it again, with everyone who has a seat. */
  start(): void {
    const { host } = this;
    if (!host) return;
    const { gameId, gameOptions } = useGame.getState();
    const sim = host.start(gameId, gameOptions[gameId] ?? {});
    this.showMatch(sim, host.setup, host.myId);
  }

  private ask(message: Parameters<ClientSession['request']>[0]): void {
    if (this.host) this.host.request(this.host.myId, message);
    else this.client?.request(message);
  }

  /** Moves a player to a driver station, or to watching with null. */
  setSeat(id: number, seat: Seat | null): void {
    this.ask({ type: 'seat', id, seat });
  }

  setPose(id: number, pose: Pose | null): void {
    // Shown at once here; the host passes it on to everyone else, a few times a second while it is dragged.
    const room = useGame.getState().room;
    if (room) useGame.getState().setRoom({ ...room, players: room.players.map((player) => (player.id === id ? { ...player, pose } : player)) });
    this.poses.set(id, pose);
    if (this.poseTimer) return;
    this.poseTimer = setTimeout(() => {
      this.poseTimer = null;
      for (const [player, latest] of this.poses) this.ask({ type: 'pose', id: player, pose: latest });
      this.poses.clear();
    }, POSE_SECONDS * 1000);
  }

  private readonly poses = new Map<number, Pose | null>();
  private poseTimer: ReturnType<typeof setTimeout> | null = null;

  setRobot(id: number, robot: RobotDefinition): void {
    this.ask({ type: 'robot', id, robot: robotToWire(robot) });
  }

  say(text: string): void {
    this.ask({ type: 'chat', text });
  }

  /** Host only. */
  setSettings(change: Partial<RoomSettings>): void {
    this.host?.setSettings(change);
  }

  /** Host only: removes a player from the room. */
  kick(id: number): void {
    this.host?.kick(id);
  }

  /** Host only: hands the room to another player and stays in it as a guest. */
  makeHost(id: number): void {
    const { host, link } = this;
    if (!host || !link || !host.handOver(id, true)) return;
    const carry: Carry = { myId: host.myId, room: host.room(), chat: host.chat, sim: host.sim, setup: host.setup };
    this.stopListing(false);
    this.host = null;
    this.link = null;
    host.close();
    link.close();
    void this.reconnect(carry, id, true);
  }

  /**
   * Leaves the room. A host who leaves hands the room to the player who has
   * been in it longest, and the match carries on for everyone else.
   */
  leave(reason: string | null = null): void {
    const { host, client, link } = this;
    this.left = true;
    this.host = null;
    this.client = null;
    this.link = null;
    this.notice = null;
    if (host) {
      const next = host.successor();
      if (next !== null) host.handOver(next, false);
      this.stopListing(next === null);
      host.close();
    }
    client?.close();
    link?.close();
    const state = useGame.getState();
    state.setRoom(null);
    if (reason) state.setRoomError(reason);
    if (state.screen === 'playing' || state.screen === 'paused' || state.screen === 'results') {
      state.setScreen('multiplayer');
    }
  }

  /** The link to the host has gone: turned away, sent out, or the host has left and someone takes over. */
  private lost(client: ClientSession, because: ClosedBecause): void {
    if (this.left) return;
    const link = this.link;
    this.client = null;
    this.link = null;
    link?.close();
    if (because === 'refused' || because === 'kicked' || !client.room || client.id === null) {
      this.leave(because === 'kicked' ? 'The host removed you from the room.' : (client.refused ?? 'The host closed the room.'));
      return;
    }
    const carry: Carry = { myId: client.id, room: client.room, chat: client.chat, sim: client.sim, setup: client.setup };
    void this.reconnect(carry, client.handoverTo, client.handoverStays);
  }

  /**
   * Finds the room again under its next host. The player chosen (or, without
   * a choice, the one who joined first) opens the room under the same code;
   * everyone else keeps trying to join it. If the first in line never shows,
   * the next takes over a little later, and so on.
   */
  private async reconnect(carry: Carry, chosen: number | null, oldHostStays: boolean): Promise<void> {
    const others = carry.room.players.filter((player) => player.id !== carry.room.hostId).map((player) => player.id);
    const order = chosen === null ? others : [chosen, ...others.filter((id) => id !== chosen)];
    const rank = order.indexOf(carry.myId);
    this.notice = chosen === carry.myId ? 'Taking the room over…' : 'The host changed. Reconnecting to the room…';
    this.publish();
    const started = Date.now();
    while (!this.left && Date.now() - started < RECONNECT_SECONDS * 1000) {
      const waited = (Date.now() - started) / 1000;
      const { name, robot, accountId } = this.me();
      if (rank !== -1 && waited >= rank * TAKEOVER_STAGGER) {
        const room = oldHostStays ? carry.room : { ...carry.room, players: carry.room.players.filter((p) => p.id !== carry.room.hostId) };
        const host = new HostSession(name, robot, accountId, { ...carry, room: { ...room, hostId: -1 } });
        try {
          const link = await openRoom((transport) => host.accept(transport), 0, this.code);
          if (this.left) {
            link.close();
            return;
          }
          this.attachHost(host, link);
          if (carry.sim && carry.setup) this.showMatch(carry.sim, carry.setup, host.myId);
          return;
        } catch (error) {
          if (!(error instanceof Error && error.message === CODE_TAKEN)) await wait(2);
        }
      }
      try {
        const { transport, link } = await joinRoom(this.code, 5);
        if (this.left) {
          link.close();
          return;
        }
        const client = new ClientSession(transport, name, robot, undefined, accountId, {
          id: carry.myId,
          sim: carry.sim,
          setup: carry.setup,
          chat: carry.chat,
        });
        this.attachClient(client, link);
        return;
      } catch {
        await wait(2);
      }
    }
    if (!this.left) this.leave('Lost the connection to the room.');
  }

  /** Keeps the room in the list of open matches while the host wants it there. */
  private startListing(): void {
    if (this.listingTimer) return;
    this.listingTimer = setInterval(() => this.updateListing(true), LISTING_SECONDS * 1000);
  }

  private stopListing(remove: boolean): void {
    if (this.listingTimer) clearInterval(this.listingTimer);
    this.listingTimer = null;
    if (remove && this.listedAs) void unlistRoom(this.listedAs.code, this.listedAs.secret);
    this.listedAs = null;
  }

  private lastListing = '';

  /** Sends the room's entry to the list, when it has changed or is due again. */
  private updateListing(due = false): void {
    const host = this.host;
    if (!host) return;
    const room = host.room();
    if (!room.settings.listed) {
      if (this.listedAs) void unlistRoom(this.listedAs.code, this.listedAs.secret);
      this.listedAs = null;
      this.lastListing = '';
      return;
    }
    const me = room.players.find((player) => player.id === host.myId);
    const entry = {
      code: this.code,
      secret: room.listing,
      host: me?.name ?? 'Host',
      players: room.players.filter((player) => player.seat).length,
      spectators: room.players.filter((player) => !player.seat).length,
      playing: room.playing,
    };
    const key = JSON.stringify(entry);
    if (!due && key === this.lastListing) return;
    this.lastListing = key;
    this.listedAs = { code: entry.code, secret: entry.secret };
    void listRoom(entry);
  }
}

export const multiplayer = new Multiplayer();
