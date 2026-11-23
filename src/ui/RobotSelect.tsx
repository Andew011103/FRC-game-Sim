import { useEffect, useMemo, useState } from 'react';
import type { EffectWindow, RobotWindow } from '../game';
import { PIECE_EFFECTS } from '../pass/effects';
import { OFFICIAL_ROBOTS, findRobot } from '../robots';
import { configuredGame } from '../games';
import { epaOf } from '../robots/epa';
import { allRewards, applySkin, skinsFor, wornSkin, type Reward } from '../pass/pass';
import { useUnlocked } from './passHooks';
import { robotStats, robotTags } from '../robots/stats';
import { EpaTag } from './Epa';
import type { RobotDefinition } from '../robots/types';
import { useGame } from './store';

interface Props {
  /** Tells the 3D view which robots to draw in which boxes on this screen. */
  onWindows: (windows: RobotWindow[]) => void;
  /** Tells the 3D view where to show a fuel ball with a skin's game piece effect. */
  onEffectWindows: (windows: EffectWindow[]) => void;
}

const teamNumber = (robot: RobotDefinition): string | null => robot.team ?? null;

/** A bar is red when low, amber in the middle and green when high. */
const barColor = (fraction: number): string => (fraction < 0.34 ? 'bad' : fraction < 0.67 ? 'warn' : 'good');

/** A grid of every robot, with the chosen one shown large beside its figures. */
export function RobotSelect({ onWindows, onEffectWindows }: Props) {
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
  const skins = useGame((state) => state.settings.skins);
  const updateSettings = useGame((state) => state.updateSettings);
  const unlocked = useUnlocked();
  const pickedBase = findRobot(robotId, customRobots);
  // Each robot is shown in the skin the player has on it.
  const champions = useGame((state) => state.champions);
  const picked = applySkin(pickedBase, wornSkin(pickedBase.id, skins, champions));
  const skinChoices = skinsFor(pickedBase.id).filter((skin) => unlocked.has(skin.id) || skins[pickedBase.id] === skin.id);
  // Game piece effects the player has, equipped for every robot.
  const pieceEffect = useGame((state) => state.settings.pieceEffect);
  const effectChoices = allRewards().filter(
    (reward): reward is Extract<Reward, { type: 'pieceEffect' }> =>
      reward.type === 'pieceEffect' && (unlocked.has(reward.id) || reward.id === pieceEffect),
  );
  const stats = robotStats(picked);

  useEffect(() => {
    if (!ready) return;
    onWindows([
      ...robots.map((robot) => ({ elementId: `robot-window-${robot.id}`, robot: applySkin(robot, wornSkin(robot.id, skins, champions)), alliance, spin: false })),
      { elementId: 'robot-window-picked', robot: picked, alliance, spin: true },
    ]);
    return () => onWindows([]);
  }, [ready, robots, picked, alliance, onWindows, skins, champions]);

  // A skin that comes with its own game piece effect shows it on a flying fuel ball, above the robot.
  const skinEffect = picked.pieceEffect;
  useEffect(() => {
    if (!ready) return;
    onEffectWindows(skinEffect ? [{ elementId: 'effect-window-picked', effect: skinEffect, alliance }] : []);
    return () => onEffectWindows([]);
  }, [ready, skinEffect, alliance, onEffectWindows]);

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

        <section className="picked" data-clip>
          <p className="muted">You have picked:</p>
          <div className="picked-title">
            <h2>{picked.name}</h2>
            <EpaTag robot={picked} />
            {teamNumber(picked) && <span className="team-badge">{teamNumber(picked)}</span>}
          </div>
          {skinEffect && (
            <div className="effect-window">
              <div id="effect-window-picked" />
              <span className="effect-window-label">
                {PIECE_EFFECTS.find((effect) => effect.value === skinEffect.kind)?.label.split(':')[0] ?? 'Game piece'} effect, with this skin
              </span>
            </div>
          )}
          <div className="robot-window">
            <div id="robot-window-picked" />
          </div>
          {skinChoices.length > 0 && (
            <label className="field">
              <span>Skin</span>
              <select
                value={skins[pickedBase.id] ?? ''}
                onChange={(event) => {
                  const next = { ...skins };
                  if (event.target.value) next[pickedBase.id] = event.target.value;
                  else delete next[pickedBase.id];
                  updateSettings({ skins: next });
                }}
              >
                <option value="">Standard</option>
                {skinChoices.map((skin) => (
                  <option key={skin.id} value={skin.id}>
                    {skin.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {/* A skin with its own effect always uses it, so there is nothing to pick. */}
          {effectChoices.length > 0 && !skinEffect && (
            <label className="field">
              <span>Game piece effect</span>
              <select value={pieceEffect} onChange={(event) => updateSettings({ pieceEffect: event.target.value })}>
                <option value="">None</option>
                {effectChoices.map((reward) => (
                  <option key={reward.id} value={reward.id}>
                    {reward.name}
                  </option>
                ))}
              </select>
            </label>
          )}
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
