import { useEffect, useState } from 'react';
import { accountsAvailable } from '../account/account';
import { BOARD_SIZE, TOP3_RP, countdown, fetchBoard, type BoardRow } from '../account/leaderboard';
import { PASS, championSkinFor } from '../pass/pass';
import { OFFICIAL_ROBOTS, findRobot } from '../robots';
import { epaOf } from '../robots/epa';
import { PlayerName } from './Record';
import { useGame } from './store';

/** The leaderboards: this season's overall board, then one for each official robot. */
export function Leaderboard() {
  const setScreen = useGame((state) => state.setScreen);
  const account = useGame((state) => state.account);
  const [category, setCategory] = useState<string | null>(null);
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Strongest robots first, as in the robot selector.
  const robots = [...OFFICIAL_ROBOTS].sort((a, b) => (epaOf(b) ?? -1) - (epaOf(a) ?? -1) || a.name.localeCompare(b.name));

  useEffect(() => {
    let current = true;
    setRows(null);
    setFailed(false);
    void fetchBoard(category).then((board) => {
      if (!current) return;
      if (board) setRows(board);
      else setFailed(true);
    });
    return () => {
      current = false;
    };
  }, [category]);

  const robot = category ? findRobot(category) : null;
  const champion = category ? championSkinFor(category) : null;

  return (
    <div className="screen">
      <header className="screen-head">
        <button className="small" onClick={() => setScreen('home')}>
          Back
        </button>
        <h1>Leaderboard</h1>
        <span className="muted">{PASS.name}</span>
      </header>
      <div className="screen-body board-layout">
        <nav className="card board-categories" aria-label="Leaderboards">
          <button className={category === null ? 'selected' : ''} onClick={() => setCategory(null)}>
            Season Overall
          </button>
          {robots.map((option) => (
            <button key={option.id} className={category === option.id ? 'selected' : ''} onClick={() => setCategory(option.id)}>
              {option.name}
            </button>
          ))}
        </nav>
        <section className="card board">
          <div className="board-head">
            <h2>{robot ? robot.name : 'Season Overall'}</h2>
            <span className="season-countdown" title="Until the season ends">
              Season ends in <SeasonCountdown />
            </span>
          </div>
          <p className="hint">
            {robot
              ? `The best timed singleplayer score with ${robot.name} this season, one per player.`
              : `The best timed singleplayer score with any official robot this season, one per player. A first top-3 place this season earns ${TOP3_RP.join(', ')} Ranking Points for 1st, 2nd and 3rd.`}
            {champion && ` First place wears the ${champion.name} skin while they hold it.`}
          </p>
          {!accountsAvailable && <p className="hint">Leaderboards need accounts, which are not set up for this copy of the game.</p>}
          {failed && accountsAvailable && <p className="hint">The leaderboard cannot be read right now.</p>}
          {!rows && !failed && accountsAvailable && <p className="hint">Reading the leaderboard…</p>}
          {rows?.length === 0 && <p className="hint">No runs yet this season. Finish a timed singleplayer match to be the first.</p>}
          {rows && rows.length > 0 && (
            <ol className="board-rows">
              {rows.slice(0, BOARD_SIZE).map((row) => (
                <li key={row.userId} className={`${row.userId === account?.id ? 'mine ' : ''}place-${row.place}`}>
                  <span className="board-place">{row.place}</span>
                  <span className="board-name">
                    <PlayerName player={{ name: row.name, accountId: row.userId, look: { nameColor: row.nameColor, badge: row.badge } }} />
                  </span>
                  {!robot && <span className="muted board-robot">{findRobot(row.robotId).name}</span>}
                  <span className="board-score">{row.score}</span>
                </li>
              ))}
            </ol>
          )}
          {!account && accountsAvailable && <p className="hint">Sign in to put your own runs on the leaderboards.</p>}
        </section>
      </div>
    </div>
  );
}

/** Time left in the season, ticking every second: "7d 17:02:39". */
export function SeasonCountdown() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="countdown-time">{countdown(PASS.endsAt, now)}</span>;
}
