import { useEffect, useMemo, useState } from 'react';
import type { RobotWindow } from '../game';
import { OFFICIAL_ROBOTS, findRobot } from '../robots';
import { configuredGame } from '../games';
import { epaOf } from '../robots/epa';
import { robotStats, robotTags } from '../robots/stats';
import { EpaTag } from './Epa';
import type { RobotDefinition } from '../robots/types';
import { useGame } from './store';

interface Props {
  /** Tells the 3D view which robots to draw in which boxes on this screen. */
  onWindows: (windows: RobotWindow[]) => void;
}

const teamNumber = (robot: RobotDefinition): string | null => robot.team ?? null;

/** A bar is red when low, amber in the middle and green when high. */
const barColor = (fraction: number): string => (fraction < 0.34 ? 'bad' : fraction < 0.67 ? 'warn' : 'good');

/** A grid of every robot, with the chosen one shown large beside its figures. */
export function RobotSelect({ onWindows }: Props) {
  const ready = useGame((state) => state.ready);
  const robotId = useGame((state) => state.robotId);
  const setRobotId = useGame((state) => state.setRobotId);
  const customRobots = useGame((state) => state.customRobots);
  const alliance = useGame((state) => state.alliance);
  const setScreen = useGame((state) => state.setScreen);
  const menu = useGame((state) => state.menu);
  const gameId = useGame((state) => state.gameId);
  const [sort, setSort] = useState<'epa' | 'name' | 'number'>('epa');
  const lowBar = useMemo(() => configuredGame(gameId).field.lowBarClearance ?? 0, [gameId]);
  const robots = useMemo(() => {
    const byName = (a: RobotDefinition, b: RobotDefinition) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    // By number, robots without one come last, in name order.
    const number = (robot: RobotDefinition) => (robot.team ? Number(robot.team) : Infinity);
    // By EPA, strongest first; robots without one come last, in name order.
    const epa = (robot: RobotDefinition) => epaOf(robot) ?? -Infinity;
    return [...OFFICIAL_ROBOTS, ...customRobots].sort((a, b) => {
      if (sort === 'epa' && epa(a) !== epa(b)) return epa(b) - epa(a);
      if (sort === 'number' && number(a) !== number(b)) return number(a) - number(b);
      return byName(a, b);
    });
  }, [customRobots, sort]);
  const picked = findRobot(robotId, customRobots);
  const stats = robotStats(picked);

  useEffect(() => {
    if (!ready) return;
    onWindows([
      ...robots.map((robot) => ({ elementId: `robot-window-${robot.id}`, robot, alliance, spin: false })),
      { elementId: 'robot-window-picked', robot: picked, alliance, spin: true },
    ]);
    return () => onWindows([]);
  }, [ready, robots, picked, alliance, onWindows]);

  return (
    <div className="screen">
      <header className="screen-head">
        <button className="small" onClick={() => setScreen(menu)}>
          Back
        </button>
        <h1>Robot selector</h1>
        <div className="sort-by">
          <span className="muted">Sort by</span>
          <div className="toggle-pair" role="group" aria-label="Sort robots by">
            <button className={sort === 'epa' ? 'selected' : ''} onClick={() => setSort('epa')}>
              EPA
            </button>
            <button className={sort === 'name' ? 'selected' : ''} onClick={() => setSort('name')}>
              Name
            </button>
            <button className={sort === 'number' ? 'selected' : ''} onClick={() => setSort('number')}>
              Number
            </button>
          </div>
        </div>
      </header>

      <div className="screen-body selector">
        <div className="robot-grid" data-clip>
          {robots.map((robot) => (
            <button
              key={robot.id}
              className={`robot-tile${robot.id === picked.id ? ' selected' : ''}`}
              onClick={() => setRobotId(robot.id)}
            >
              <div className="robot-tile-window" id={`robot-window-${robot.id}`} />
              <EpaTag robot={robot} className="on-tile" />
              <span className="robot-tile-name">{robot.name}</span>
              {teamNumber(robot) && <span className="robot-tile-number">{teamNumber(robot)}</span>}
              <span className="robot-tags">
                {!robot.official && <span className="custom-tag">Custom</span>}
                {robotTags(robot, lowBar).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </span>
            </button>
          ))}
        </div>

        <section className="picked">
          <p className="muted">You have picked:</p>
          <div className="picked-title">
            <h2>{picked.name}</h2>
            <EpaTag robot={picked} />
            {teamNumber(picked) && <span className="team-badge">{teamNumber(picked)}</span>}
          </div>
          <div className="robot-window">
            <div id="robot-window-picked" />
          </div>
          <div className="stats">
            {stats.map((stat) => (
              <div className="stat" key={stat.label}>
                <span className="stat-label">{stat.label}</span>
                <div className="stat-bar" role="img" aria-label={`${stat.label}: ${stat.text}`}>
                  <div className={barColor(stat.fraction)} style={{ width: `${Math.max(1, stat.fraction * 100)}%` }} />
                </div>
                <span className="stat-value">{stat.text}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <footer className="screen-foot">
        <button className="secondary" onClick={() => setScreen('builder')}>
          Robot builder
        </button>
        <button className="primary" onClick={() => setScreen(menu)}>
          Use this robot
        </button>
      </footer>
    </div>
  );
}
