import { configuredGame } from '../games';
import { Fields } from './Builder';
import { useGame } from './store';

/** The rules of the next match: timed or not, and whatever the game lets you change. */
export function Rules() {
  const gameId = useGame((state) => state.gameId);
  const options = useGame((state) => state.gameOptions[gameId]);
  const setGameOption = useGame((state) => state.setGameOption);
  const mode = useGame((state) => state.mode);
  const setMode = useGame((state) => state.setMode);
  const setScreen = useGame((state) => state.setScreen);
  const menu = useGame((state) => state.menu);
  const game = configuredGame(gameId, options);

  return (
    <div className="screen">
      <header className="screen-head">
        <button className="small" onClick={() => setScreen(menu)}>
          Back
        </button>
        <h1>Rules</h1>
        <span className="muted">{game.name}</span>
      </header>

      <div className="screen-body narrow">
        <section className="card">
          <h2>Match</h2>
          <div className="segmented">
            <button className={mode === 'practice' ? 'selected' : ''} onClick={() => setMode('practice')}>
              Free practice
            </button>
            <button className={mode === 'match' ? 'selected' : ''} onClick={() => setMode('match')}>
              Timed match
            </button>
          </div>
          <p className="hint">
            {mode === 'practice'
              ? 'No clock. Points still count so you can practise scoring.'
              : 'A timed 2:40 match. You drive during the autonomous period too.'}
          </p>
        </section>

        {game.options && (
          <section className="card">
            <h2>{game.name}</h2>
            <Fields
              fields={game.options}
              values={options ?? {}}
              onChange={(key, value) => setGameOption(gameId, key, value)}
            />
          </section>
        )}
      </div>

      <footer className="screen-foot">
        <button className="primary" onClick={() => setScreen(menu)}>
          Done
        </button>
      </footer>
    </div>
  );
}
