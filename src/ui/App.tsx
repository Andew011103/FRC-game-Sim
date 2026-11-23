import { useCallback, useEffect, useRef, useState } from 'react';
import { initAccount } from '../account/account';
import { PASS, rankingPoints, unlockedIds } from '../pass/pass';
import { Game, type EffectWindow, type RobotWindow } from '../game';
import type { RobotDefinition } from '../robots/types';
import { applyTheme } from '../settings';
import { Builder } from './Builder';
import { Home } from './Home';
import { Hud } from './Hud';
import { Multiplayer } from './Multiplayer';
import { PauseMenu } from './PauseMenu';
import { Record } from './Record';
import { Results } from './Results';
import { RobotSelect } from './RobotSelect';
import { Rules } from './Rules';
import { Scoreboard } from './Scoreboard';
import { SignIn } from './SignIn';
import { DrivePassScreen } from './DrivePass';
import { Leaderboard } from './Leaderboard';
import { SettingsScreen } from './SettingsScreen';
import { Singleplayer } from './Singleplayer';
import { Updates } from './Updates';
import { useGame } from './store';

/** Shows exactly one screen at a time over the 3D view. */
export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const screen = useGame((state) => state.screen);
  const gameId = useGame((state) => state.gameId);
  const ready = useGame((state) => state.ready);
  const theme = useGame((state) => state.settings.theme);

  useEffect(() => {
    let cancelled = false;
    Game.create(canvasRef.current!)
      .then((game) => {
        if (cancelled) {
          game.dispose();
          return;
        }
        gameRef.current = game;
        // Development builds expose the game for debugging from the browser console.
        if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
        useGame.getState().setReady(true);
      })
      .catch((reason) => setError(String(reason)));
    return () => {
      cancelled = true;
      gameRef.current?.dispose();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => initAccount(), []);

  // Each Drive Pass reward a player reaches is kept in their saved choices, so it stays theirs after the season ends.
  const seasonRecord = useGame((state) => state.seasonRecord);
  const awardRp = useGame((state) => state.awardRp);
  const owned = useGame((state) => state.settings.owned);
  useEffect(() => {
    const reached = [...unlockedIds(rankingPoints(seasonRecord) + awardRp)].filter((id) => !owned[id]);
    if (reached.length === 0) return;
    useGame.getState().updateSettings({ owned: { ...owned, ...Object.fromEntries(reached.map((id) => [id, PASS.id])) } });
  }, [seasonRecord, awardRp, owned]);

  // The chosen palette colours the page, and the 3D view's plain background to match.
  useEffect(() => {
    const background = applyTheme(theme);
    if (ready) gameRef.current?.setBackground(background);
  }, [theme, ready]);

  // The home screen shows the field turning behind it, set up the way the rules say.
  const options = useGame((state) => state.gameOptions[state.gameId]);
  useEffect(() => {
    if (ready && screen === 'home') gameRef.current?.previewGame(gameId, options);
  }, [ready, screen, gameId, options]);

  const start = () => gameRef.current?.startMatch();
  const preview = useCallback((robot: RobotDefinition | null) => gameRef.current?.previewRobot(robot), []);
  const windows = useCallback((items: RobotWindow[]) => gameRef.current?.setWindows(items), []);
  const effectWindows = useCallback((items: EffectWindow[]) => gameRef.current?.setEffectWindows(items), []);

  return (
    <>
      <canvas ref={canvasRef} className="stage" />
      {error && <div className="fatal">The game could not start: {error}</div>}
      {screen === 'home' && <Home />}
      {screen === 'singleplayer' && <Singleplayer onStart={start} onWindows={windows} />}
      {screen === 'multiplayer' && <Multiplayer />}
      {screen === 'record' && <Record />}
      {screen === 'signin' && <SignIn />}
      {screen === 'pass' && <DrivePassScreen />}
      {screen === 'leaderboard' && <Leaderboard />}
      {screen === 'robots' && <RobotSelect onWindows={windows} onEffectWindows={effectWindows} />}
      {screen === 'rules' && <Rules />}
      {screen === 'settings' && <SettingsScreen />}
      {screen === 'updates' && <Updates />}
      {screen === 'builder' && <Builder onPreview={preview} onTestDrive={start} />}
      {screen === 'playing' && <Hud />}
      {screen === 'playing' && <Scoreboard />}
      {screen === 'paused' && <PauseMenu onRestart={start} />}
      {screen === 'results' && <Results onRestart={start} />}
    </>
  );
}
