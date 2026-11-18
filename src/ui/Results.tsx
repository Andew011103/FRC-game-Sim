import { multiplayer } from '../net/room';
import { PlayerList } from './PlayerList';
import { useGame } from './store';

/** Final score, the breakdown by category, and bonus progress. */
export function Results({ onRestart }: { onRestart: () => void }) {
  const results = useGame((state) => state.results);
  const setScreen = useGame((state) => state.setScreen);
  const room = useGame((state) => state.room);
  if (!results) return null;

  const outcome = results.blue > results.red ? 'Blue wins' : results.red > results.blue ? 'Red wins' : 'Tie';

  return (
    <div className="screen centered">
      <div className="panel results-panel">
        <p className="eyebrow">Match over</p>
        <h1>{outcome}</h1>

        <div className="final-score">
          <span className="score blue">{results.blue}</span>
          <span className="dash">–</span>
          <span className="score red">{results.red}</span>
        </div>

        <table className="breakdown">
          <tbody>
            {results.rows.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  Nobody scored.
                </td>
              </tr>
            )}
            {results.rows.map((row) => (
              <tr key={row.label}>
                <td className="num">{row.blue}</td>
                <td>{row.label}</td>
                <td className="num">{row.red}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Your alliance’s bonuses</h2>
        <ul className="bonuses">
          {results.bonuses.map((bonus) => (
            <li key={bonus.label} className={bonus.achieved ? 'achieved' : ''}>
              <span>{bonus.label}</span>
              <span className="muted">{bonus.detail}</span>
            </li>
          ))}
        </ul>

        {room && <PlayerList />}
        {room ? (
          <>
            {/* Everyone goes back to the same room, with the same code, to pick robots and spots for the next match. */}
            <button className="primary" onClick={() => setScreen('multiplayer')}>
              Return to room
            </button>
            <button className="secondary" onClick={() => multiplayer.leave()}>
              Leave the room
            </button>
          </>
        ) : (
          <>
            <button className="primary" onClick={onRestart}>
              Play again
            </button>
            <button className="secondary" onClick={() => setScreen('singleplayer')}>
              Back to singleplayer
            </button>
          </>
        )}
      </div>
    </div>
  );
}
