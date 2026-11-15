import { useEffect } from 'react';
import type { RobotWindow } from '../game';
import { configuredGame } from '../games';
import type { Alliance } from '../games/types';
import { findRobot } from '../robots';
import { FieldMap } from './FieldMap';
import { useGame } from './store';

interface Props {
  onStart: () => void;
  /** Tells the 3D view which robots to draw in which boxes on this screen. */
  onWindows: (windows: RobotWindow[]) => void;
}

const ALLIANCE_NAMES: Record<Alliance, string> = { blue: 'Blue', red: 'Red' };

/** Sets up a match: the robot, the alliance and where the robot starts. The match begins from here. */
export function Singleplayer({ onStart, onWindows }: Props) {
  const ready = useGame((state) => state.ready);
  const gameId = useGame((state) => state.gameId);
  const options = useGame((state) => state.gameOptions[gameId]);
  const mode = useGame((state) => state.mode);
  const robotId = useGame((state) => state.robotId);
  const customRobots = useGame((state) => state.customRobots);
  const alliance = useGame((state) => state.alliance);
  const setAlliance = useGame((state) => state.setAlliance);
  const startPose = useGame((state) => state.startPose);
  const setStartPose = useGame((state) => state.setStartPose);
  const setScreen = useGame((state) => state.setScreen);
  const game = configuredGame(gameId, options);
  const robot = findRobot(robotId, customRobots);
  const other: Alliance = alliance === 'blue' ? 'red' : 'blue';

  useEffect(() => {
    if (!ready) return;
    onWindows([{ elementId: 'robot-window-picked', robot, alliance, spin: true }]);
    return () => onWindows([]);
  }, [ready, robot, alliance, onWindows]);

  return (
    <div className="screen">
      <header className="screen-head">
        <button className="small" onClick={() => setScreen('home')}>
          Back
        </button>
        <h1>Singleplayer</h1>
        <span className="muted">{game.name}</span>
      </header>

      <div className="screen-body single">
        <section className="single-robot">
          <button className="secondary" onClick={() => setScreen('robots')}>
            Change robot
          </button>
          <div className="robot-window">
            <div id="robot-window-picked" />
            <span className="robot-window-name">{robot.name}</span>
            {!robot.official && <span className="custom-tag">Custom</span>}
          </div>
          <div className="stepper" role="group" aria-label="Alliance">
            <span className="stepper-label">Alliance</span>
            <button aria-label="Previous alliance" onClick={() => setAlliance(other)}>
              ‹
            </button>
            <span className={`stepper-value ${alliance}`}>{ALLIANCE_NAMES[alliance]}</span>
            <button aria-label="Next alliance" onClick={() => setAlliance(other)}>
              ›
            </button>
          </div>
        </section>

        <section className="single-field">
          <h2>Starting position</h2>
          <FieldMap game={game} robot={robot} alliance={alliance} value={startPose} onChange={setStartPose} />
        </section>
      </div>

      <footer className="screen-foot">
        <span className="muted">{mode === 'match' ? 'Timed match, 2:40' : 'Free practice, no clock'}</span>
        <button className="secondary" onClick={() => setScreen('robots')}>
          Change robot
        </button>
        <button className="secondary" onClick={() => setScreen('rules')}>
          Rules
        </button>
        <button className="primary" disabled={!ready} onClick={onStart}>
          {mode === 'match' ? 'Start match' : 'Start driving'}
        </button>
      </footer>
    </div>
  );
}
