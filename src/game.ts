import { configuredGame } from './games';
import { robotStart } from './games/start';
import type { Alliance, Bonus, GameDefinition, StatusInfo } from './games/types';
import { InputManager } from './input/manager';
import { NEUTRAL_INPUT, type DriverInput, type InputAction } from './input/types';
import { garage } from './games/garage';
import { multiplayer } from './net/room';
import type { ClientSession } from './net/session';
import { saveMatch } from './account/account';
import type { RobotDefinition } from './robots/types';
import { SceneView, type Quality } from './render/scene';
import type { QualitySetting } from './settings';
import { findRobot } from './robots';
import type { SimRobot } from './sim/robot';
import { SIM_DT, SimWorld, initPhysics } from './sim/world';
import { useGame, type AllianceView, type MatchResults, type MatchView } from './ui/store';

// A physics step costs well under a millisecond, so a slow frame can afford to
// run many of them. This keeps the game in real time down to about 4 frames a second.
const MAX_STEPS_PER_FRAME = 15;
const MAX_FRAME_TIME = MAX_STEPS_PER_FRAME * SIM_DT;
const LIVE_UPDATE_INTERVAL = 0.1;
/** Drawing this long behind means the browser has slowed the page, and the worker's clock takes over. */
const STALLED_MS = 100;
/** In auto quality, drop a level after this long below the target frame rate. */
const AUTO_QUALITY_WINDOW = 2.5;
const AUTO_QUALITY_MIN_FPS = 45;
const LOWER_QUALITY: Record<Quality, Quality | null> = { high: 'medium', medium: 'low', low: null };
/** In the builder, every mechanism is shown extended so the player can see it. */
const PREVIEW_INPUT: DriverInput = { ...NEUTRAL_INPUT, intake: true, deploy: true, block: true };
/** Long enough for a displayed robot's mechanisms to finish coming out. */
const DISPLAY_STEPS = 150;

/** A robot to draw by itself inside a box on the page. */
export interface RobotWindow {
  /** The id of the page element to draw over. */
  elementId: string;
  robot: RobotDefinition;
  alliance: Alliance;
  /** Whether the view circles the robot. */
  spin: boolean;
}

/** The empty floor a displayed robot stands on, for one alliance's bumper colour. */
const garageFor = (alliance: Alliance): GameDefinition => ({
  ...garage,
  spawns: [{ ...garage.spawns[0], alliance }],
});
const ALLIANCES: Alliance[] = ['blue', 'red'];

/** Ties input, simulation and rendering together and runs the frame loop. */
export class Game {
  private sim: SimWorld;
  private player: SimRobot | null = null;
  /** Identifies the field shown behind the menu, so it is only rebuilt when it changes. */
  private previewKey = '';
  /** Separate little worlds, one for each robot drawn in a box on the page. */
  private displays: SimWorld[] = [];
  private readonly view: SceneView;
  private readonly input: InputManager;
  private frameHandle = 0;
  private lastTime = 0;
  private accumulator = 0;
  private liveTimer = 0;
  private fps = 60;
  private simMs = 0;
  private drawMs = 0;
  /** The level auto quality has settled on so far. */
  private autoQuality: Quality = 'high';
  private slowTime = 0;
  private slowFrames = 0;
  /** In a multiplayer match, the driver station this player drives from. */
  private netStation: number | null = null;
  private hiddenClock: Worker | null = null;
  /** When the last frame was drawn, in milliseconds. */
  private lastDrawn = 0;
  /** The match whose results have been shown and saved, so that happens once. */
  private finishedSim: SimWorld | null = null;

  static async create(canvas: HTMLCanvasElement): Promise<Game> {
    await initPhysics();
    return new Game(canvas);
  }

  private constructor(canvas: HTMLCanvasElement) {
    this.view = new SceneView(canvas);
    this.input = new InputManager(
      this.onAction,
      () => useGame.getState().settings,
      () => {
        const { screen } = useGame.getState();
        return screen === 'playing' || screen === 'paused';
      },
    );
    this.sim = new SimWorld(configuredGame(useGame.getState().gameId));
    this.view.setWorld(this.sim);
    multiplayer.onMatch = this.showNetMatch;
    window.addEventListener('resize', this.onResize);
    this.frameHandle = requestAnimationFrame(this.frame);
    this.startHiddenClock();
  }

  /** Shows a field behind the home screen without starting play. */
  previewGame(gameId: string, options: Record<string, unknown> = {}): void {
    const key = `${gameId} ${JSON.stringify(options)}`;
    if (this.previewKey === key && !this.player) return;
    this.replaceWorld(new SimWorld(configuredGame(gameId, options)), null);
    this.previewKey = key;
  }

  /**
   * Sets the robots drawn by themselves in boxes on the page (the robot
   * selector's tiles, the chosen robot). Each stands with its mechanisms out.
   */
  setWindows(windows: RobotWindow[]): void {
    const old = this.displays;
    this.displays = windows.map((item) => {
      const world = new SimWorld(garageFor(item.alliance));
      world.addRobot(item.robot);
      for (let i = 0; i < DISPLAY_STEPS; i++) world.step([PREVIEW_INPUT]);
      return world;
    });
    this.view.setWindows(
      windows.map((item, i) => ({ elementId: item.elementId, robot: this.displays[i].robots[0], spin: item.spin })),
    );
    for (const world of old) world.dispose();
  }

  /** The colour of screens that show no field, so the 3D view matches the page around its boxes. */
  setBackground(color: string): void {
    this.view.setPlainColor(color);
  }

  /** Shows one robot by itself for the builder, with its mechanisms deployed, or the empty floor when there is none. */
  previewRobot(def: RobotDefinition | null): void {
    const sim = new SimWorld(garage);
    this.replaceWorld(sim, def ? sim.addRobot(def) : null);
  }

  /** Swaps in a newly built world. The old one is only destroyed once the new one exists. */
  private replaceWorld(sim: SimWorld, player: SimRobot | null): void {
    const old = this.sim;
    this.netStation = null;
    this.sim = sim;
    this.player = player;
    this.view.setWorld(sim);
    this.view.setPlayer(player?.index ?? 0);
    this.accumulator = 0;
    this.previewKey = '';
    old.dispose();
  }

  /** Builds a fresh field with the chosen robot and starts play. */
  startMatch(): void {
    const state = useGame.getState();
    this.buildMatch();
    state.setCamera(state.settings.defaultCamera);
    state.setFieldCentric(state.settings.fieldCentric);
    state.setScreen('playing');
  }

  /**
   * A fresh field as the menus have it set up: every piece back in its place,
   * the clock at the start, and the robot on its starting spot with its preload.
   */
  private buildMatch(): void {
    const { gameId, gameOptions, startPose, mode, robotId, customRobots, alliance } = useGame.getState();
    const game = configuredGame(gameId, gameOptions[gameId]);
    const sim = new SimWorld(game, { mode, pauses: true });
    const spawnIndex = Math.max(0, game.spawns.findIndex((spawn) => spawn.alliance === alliance));
    const robot = findRobot(robotId, customRobots);
    const player = sim.addRobot(robot, spawnIndex, robotStart(game, robot, alliance, startPose));
    this.replaceWorld(sim, player);
    this.input.release();
  }

  /**
   * Puts a multiplayer match on screen: the host's own field, or a guest's
   * copy of it. A player with no robot in it watches from above. When the
   * room changes hosts, the field already on screen carries on as it is.
   */
  private readonly showNetMatch = (sim: SimWorld, robotIndex: number, station: number): void => {
    const state = useGame.getState();
    const player = sim.robots[robotIndex] ?? null;
    if (sim === this.sim) {
      this.player = player;
      this.view.setPlayer(player?.index ?? 0);
      this.netStation = station;
      return;
    }
    this.replaceWorld(sim, player);
    this.netStation = station;
    this.input.release();
    state.setCamera(player ? state.settings.defaultCamera : 'top');
    state.setFieldCentric(state.settings.fieldCentric);
    state.setScreen('playing');
  };

  /** The session this field belongs to, when it is a multiplayer match. */
  private hosting() {
    return multiplayer.host?.sim === this.sim ? multiplayer.host : null;
  }

  private joined(): ClientSession | null {
    return multiplayer.client?.sim === this.sim ? multiplayer.client : null;
  }

  /** What to show about an alliance's goal. A guest is told by the host; everyone else works it out. */
  private statusOf(alliance: Alliance): StatusInfo | null {
    const client = this.joined();
    if (client) return client.status?.[alliance] ?? null;
    return this.sim.rules?.status(this.sim, alliance) ?? null;
  }

  /** Shows the results, and adds the finished match to the player's record. Once a match. */
  private finish(online: boolean, bonuses?: Bonus[]): void {
    if (this.finishedSim === this.sim) return;
    this.finishedSim = this.sim;
    const results = this.results(bonuses);
    // Multiplayer matches and timed singleplayer matches go on the player's record; free practice does not.
    if (this.player && this.sim.match?.mode === 'match') {
      void saveMatch({
        alliance: this.player.alliance,
        blue: results.blue,
        red: results.red,
        robot: this.player.def.name,
        single: !online,
        solo: online ? (this.sim.match.solo[this.player.index] ?? 0) : null,
        game: this.sim.game.id,
        official: this.player.def.official === true,
        players: this.sim.robots.length,
      });
    }
    const { screen, showResults, setResults } = useGame.getState();
    // A player looking at another screen, such as the room, is not pulled away from it.
    if (screen === 'playing' || screen === 'paused') showResults(results);
    else setResults(results);
  }

  dispose(): void {
    if (multiplayer.onMatch === this.showNetMatch) multiplayer.onMatch = null;
    cancelAnimationFrame(this.frameHandle);
    this.hiddenClock?.terminate();
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.view.dispose();
    this.sim.dispose();
    for (const world of this.displays) world.dispose();
  }

  private readonly frame = (nowMs: number): void => {
    this.frameHandle = requestAnimationFrame(this.frame);
    this.lastDrawn = performance.now();
    this.tick(nowMs / 1000, true);
  };

  /**
   * A browser stops drawing a tab that is out of sight, and with it the frame
   * loop; some slow it to a frame or two a second. A multiplayer match must
   * not stop or slow with it, so whenever drawing stalls a clock in a worker
   * (which the browser does not slow down) keeps the match going without
   * drawing it.
   */
  private startHiddenClock(): void {
    try {
      const source = 'setInterval(() => postMessage(0), 1000 / 60);';
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      this.hiddenClock = new Worker(url);
      URL.revokeObjectURL(url);
      this.hiddenClock.onmessage = () => {
        const stalled = document.hidden || performance.now() - this.lastDrawn > STALLED_MS;
        if (stalled && (this.hosting() || this.joined())) this.tick(performance.now() / 1000, false);
      };
    } catch {
      // Without workers a hidden tab simply pauses, as before.
    }
  }

  /** One frame: input, simulation, and drawing when the tab is in view. */
  private tick(now: number, visible: boolean): void {
    const delta = Math.min(MAX_FRAME_TIME, this.lastTime ? Math.max(0, now - this.lastTime) : 0);
    this.lastTime = now;

    const state = useGame.getState();
    const { settings, screen } = state;
    const driverInput = this.input.read(this.player?.climbing ?? false);
    if (settings.constantIntake) driverInput.intake = true;
    // In multiplayer the driver stands at their own station; otherwise where the settings say.
    this.view.setDriverStation(this.netStation ?? settings.driverStation);
    const quality = this.chooseQuality(settings.quality, screen === 'playing' && visible, delta);
    this.view.setQuality(quality);

    const simStart = performance.now();
    const previewing = state.screen === 'builder';
    const host = this.hosting();
    const client = this.joined();
    // A multiplayer match carries on behind every other screen. Only the playing screen drives the robot.
    const driving = screen === 'playing' && visible ? driverInput : NEUTRAL_INPUT;
    if (client) {
      // The host runs the match. This player only sends what their driver is asking for.
      client.sendInput(driving, { fieldCentric: state.fieldCentric, autoAim: settings.autoAim });
      if (this.sim.match?.finished) this.finish(true, client.bonuses?.[this.player?.alliance ?? 'blue']);
    } else if (host || ((screen === 'playing' || previewing) && this.player)) {
      if (this.player) {
        this.player.fieldCentric = state.fieldCentric;
        this.player.autoAim = settings.autoAim;
      }
      this.accumulator += delta;
      let steps = 0;
      while (this.accumulator >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
        if (host) host.step(driving);
        else this.sim.step([previewing ? PREVIEW_INPUT : driverInput]);
        this.accumulator -= SIM_DT;
        steps++;
      }
      // If the device cannot keep up, slow the game down instead of spiralling.
      if (this.accumulator >= SIM_DT) this.accumulator = 0;

      if (this.sim.match?.finished) this.finish(host !== null);
    }
    if (!visible) return;

    for (const alliance of ALLIANCES) {
      this.view.setTagLight(`hub-${alliance}`, this.statusOf(alliance)?.light ?? 'on', now);
    }
    const drawStart = performance.now();
    // Only the screens that show the field or a robot are drawn in 3D at all.
    if (screen === 'home') this.view.update(this.sim, 1, 'orbit', now);
    else if (screen === 'playing') this.view.update(this.sim, client ? client.blend() : this.accumulator / SIM_DT, state.camera, now);
    else if (previewing) this.view.update(this.sim, 1, 'inspect', now);
    else if (screen !== 'paused' && screen !== 'results') this.view.drawWindows(now);
    const drawEnd = performance.now();

    this.simMs += (drawStart - simStart - this.simMs) * 0.1;
    this.drawMs += (drawEnd - drawStart - this.drawMs) * 0.1;
    if (delta > 0) this.fps += (1 / delta - this.fps) * 0.05;
    this.liveTimer += delta;
    if (this.liveTimer >= LIVE_UPDATE_INTERVAL) {
      this.liveTimer = 0;
      state.setLive(
        {
          speed: this.player?.speed() ?? 0,
          headingDeg: ((this.player?.heading() ?? 0) * 180) / Math.PI,
          fps: Math.round(this.fps),
          gamepad: this.input.gamepadConnected,
          held: this.player?.held.length ?? 0,
          // A guest's copy of its robot is not simulated, so the host says what it can hold and how high it has climbed.
          capacity: client?.extras()?.capacity ?? this.player?.capacity() ?? 0,
          climbLevel: client?.extras()?.climbLevel ?? this.player?.climbLevel() ?? 0,
          simMs: this.simMs,
          drawMs: this.drawMs,
          quality,
        },
        this.matchView(),
      );
    }
  }

  /**
   * A fixed setting is used as given. In auto, quality starts high and steps
   * down whenever the frame rate stays low while playing. It never steps back
   * up, so it cannot flicker between levels.
   */
  private chooseQuality(setting: QualitySetting, playing: boolean, delta: number): Quality {
    if (setting !== 'auto') return setting;
    if (playing && delta > 0) {
      this.slowTime += delta;
      this.slowFrames++;
      if (this.slowTime >= AUTO_QUALITY_WINDOW) {
        const lower = LOWER_QUALITY[this.autoQuality];
        if (lower && this.slowFrames / this.slowTime < AUTO_QUALITY_MIN_FPS) this.autoQuality = lower;
        this.slowTime = 0;
        this.slowFrames = 0;
      }
    }
    return this.autoQuality;
  }

  private matchView(): MatchView | null {
    const { match, rules } = this.sim;
    if (!match || !rules) return null;
    // Someone watching sees the score from the blue side.
    const mine = this.statusOf(this.player?.alliance ?? 'blue');
    if (!mine) return null;
    const side = (alliance: Alliance): AllianceView => {
      const status = this.statusOf(alliance) ?? mine;
      return {
        score: match.score(alliance),
        active: status.goalActive,
        progress: status.progress ?? null,
        teams: this.sim.robots
          .filter((robot) => robot.alliance === alliance)
          .map((robot) => ({ name: robot.def.name, number: robot.def.team ?? null, icon: robot.def.icon ?? null })),
      };
    };
    return {
      mode: match.mode,
      phaseId: match.phase.id,
      phaseLabel: match.phase.label,
      phaseRemaining: match.phaseRemaining,
      remaining: match.remaining,
      elapsed: match.elapsed,
      hold: match.hold,
      holdReason: match.holdReason,
      previousPhase: match.phaseIndex > 0 ? match.phases[match.phaseIndex - 1].label : null,
      stage: mine.stage ?? null,
      blue: side('blue'),
      red: side('red'),
    };
  }

  private results(bonuses?: Bonus[]): MatchResults {
    const match = this.sim.match!;
    const labels = new Set([...Object.keys(match.points.blue), ...Object.keys(match.points.red)]);
    return {
      blue: match.score('blue'),
      red: match.score('red'),
      rows: [...labels].map((label) => ({
        label,
        blue: match.points.blue[label] ?? 0,
        red: match.points.red[label] ?? 0,
      })),
      bonuses: bonuses ?? this.sim.rules!.bonuses(this.sim, this.player?.alliance ?? 'blue'),
    };
  }

  private readonly onAction = (action: InputAction): void => {
    const state = useGame.getState();
    if (action === 'pause') {
      if (state.screen === 'playing') state.setScreen('paused');
      else if (state.screen === 'paused') state.setScreen('playing');
      return;
    }
    if (state.screen !== 'playing') return;
    if (action === 'toggleFieldCentric') state.setFieldCentric(!state.fieldCentric);
    else if (action === 'cycleCamera') state.cycleCamera();
    // Resetting starts the whole field again, not just the robot. The camera and control mode stay as they are.
    // In multiplayer only the host can start the match again, from the menu.
    else if (action === 'reset' && !this.hosting() && !this.joined()) this.buildMatch();
  };

  private readonly onResize = (): void => {
    this.view.resize();
  };
}
