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
        {room?.role === 'guest' ? (
          <p className="hint">The host can start another match.</p>
        ) : (
          <button className="primary" onClick={room ? () => multiplayer.start() : onRestart}>
            Play again
          </button>
        )}
        <button className="secondary" onClick={room ? () => multiplayer.leave() : () => setScreen('singleplayer')}>
          {room ? (room.role === 'host' ? 'Close the room' : 'Leave the room') : 'Back to singleplayer'}
        </button>
      </div>
    </div>
  );
}
