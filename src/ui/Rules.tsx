import { configuredGame } from '../games';
import { Fields } from './Builder';
import { multiplayer } from '../net/room';
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
  const room = useGame((state) => state.room);
  const singlePowerUps = useGame((state) => state.settings.singlePowerUps);
  const updateSettings = useGame((state) => state.updateSettings);
  const game = configuredGame(gameId, options);
  // From a room, the switch is the room's (only its host may change it); otherwise it is for singleplayer.
  const inRoom = menu === 'multiplayer' && room !== null;
  const powerUps = inRoom ? room.settings.powerUps : singlePowerUps;
  const setPowerUps = (on: boolean) => (inRoom ? multiplayer.setSettings({ powerUps: on }) : updateSettings({ singlePowerUps: on }));

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

        {inRoom && (
          <section className="card">
            <h2>Robots</h2>
            <label className="check">
              <input
                type="checkbox"
                checked={room.settings.customRobots}
                disabled={room.role !== 'host'}
                onChange={(event) => multiplayer.setSettings({ customRobots: event.target.checked })}
              />
              Allow custom robots
            </label>
            <p className="hint">
              {room.settings.customRobots
                ? 'Players may drive robots they made in the builder.'
                : 'Only official robots drive. A copy of an official robot with only new colors, LED strips or see-through parts counts as the official robot.'}
            </p>
          </section>
        )}

        <section className="card">
          <h2>Power-ups</h2>
          <label className="check">
            <input type="checkbox" checked={powerUps} disabled={inRoom && room.role !== 'host'} onChange={(event) => setPowerUps(event.target.checked)} />
            Allow power-ups from the Shop
          </label>
          <p className="hint">
            {inRoom
              ? 'Players bring the power-up they equipped and switch it on with its key.'
              : 'Your equipped power-up comes along. A match with power-ups allowed does not go on the leaderboards, even if none is used.'}
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
