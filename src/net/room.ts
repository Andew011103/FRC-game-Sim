import type { Alliance } from '../games/types';
import { findRobot } from '../robots';
import type { SimWorld } from '../sim/world';
import { useGame } from '../ui/store';
import { joinRoom, openRoom, type Link } from './peer';
import type { PlayerInfo } from './protocol';
import { ClientSession, HostSession } from './session';

/** The one multiplayer room this page can be in: either hosting it or a guest in it. */
class Multiplayer {
  host: HostSession | null = null;
  client: ClientSession | null = null;
  /** Set by the game: puts a match that is starting on screen. */
  onMatch: ((sim: SimWorld, robotIndex: number) => void) | null = null;
  private link: Link | null = null;

  private me() {
    const { settings, robotId, customRobots } = useGame.getState();
    return { name: settings.displayName, robot: findRobot(robotId, customRobots) };
  }

  private showLobby(players: PlayerInfo[], myId: number, playing: boolean): void {
    if (!this.link) return;
    useGame.getState().setRoom({
      role: this.host ? 'host' : 'guest',
      code: this.link.code,
      myId,
      playing,
      players: players.map(({ id, name, robot, alliance }) => ({ id, name, robot: robot.name, alliance })),
    });
  }

  /** Opens a room and waits in it for other players. */
  async hostRoom(): Promise<void> {
    const state = useGame.getState();
    if (state.roomBusy || this.link) return;
    state.setRoomBusy(true);
    try {
      const { name, robot } = this.me();
      const host = new HostSession(name, robot);
      this.link = await openRoom((transport) => host.accept(transport));
      this.host = host;
      host.onLobby = (players) => this.showLobby(players, 0, host.sim !== null);
      this.showLobby(host.players, 0, false);
    } catch (error) {
      useGame.getState().setRoomError(error instanceof Error ? error.message : String(error));
    }
  }

  /** Joins the room with a code. */
  async join(code: string): Promise<void> {
    const state = useGame.getState();
    if (state.roomBusy || this.link) return;
    state.setRoomBusy(true);
    try {
      const { name, robot } = this.me();
      const { transport, link } = await joinRoom(code);
      this.link = link;
      const client = new ClientSession(transport, name, robot);
      this.client = client;
      client.onLobby = (players) => this.showLobby(players, client.id ?? -1, client.sim !== null);
      client.onStart = (sim) => {
        this.showLobby(client.players, client.id ?? -1, true);
        this.onMatch?.(sim, client.robotIndex);
      };
      client.onClose = () => {
        if (this.client === client) this.leave(client.refused ?? 'The host closed the match.');
      };
    } catch (error) {
      useGame.getState().setRoomError(error instanceof Error ? error.message : String(error));
    }
  }

  /** Host only: starts a match, or starts it again, with everyone in the room. */
  start(): void {
    const { host } = this;
    if (!host) return;
    const { gameId, gameOptions } = useGame.getState();
    const sim = host.start(gameId, gameOptions[gameId] ?? {}, 'match');
    this.showLobby(host.players, 0, true);
    this.onMatch?.(sim, 0);
  }

  /** Moves this player to an alliance while the room is waiting. */
  chooseAlliance(alliance: Alliance): void {
    if (this.host) this.host.setAlliance(0, alliance);
    else this.client?.chooseAlliance(alliance);
  }

  /** Leaves the room. For the host this ends it for everyone. */
  leave(reason: string | null = null): void {
    const { host, client, link } = this;
    this.host = null;
    this.client = null;
    this.link = null;
    host?.close();
    client?.close();
    link?.close();
    const state = useGame.getState();
    state.setRoom(null);
    if (reason) state.setRoomError(reason);
    if (state.screen === 'playing' || state.screen === 'paused' || state.screen === 'results') {
      state.setScreen('multiplayer');
    }
  }
}

export const multiplayer = new Multiplayer();
