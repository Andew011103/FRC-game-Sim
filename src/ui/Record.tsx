import { useEffect, useState } from 'react';
import { accountsAvailable, fetchPlayer, rename } from '../account/account';
import { topRobots, type PlayerStats } from '../stats';
import { useGame } from './store';

/** A player's name as a button that opens their record, or as plain text when they have no account to look up. */
export function PlayerName({ player }: { player: { name: string; accountId?: string } }) {
  const showRecord = useGame((state) => state.showRecord);
  if (!player.accountId) return <span>{player.name}</span>;
  return (
    <button className="player-link" onClick={() => showRecord({ accountId: player.accountId!, name: player.name })}>
      {player.name}
    </button>
  );
}

/** One player's record card: this player's own, or another player's opened from their name. */
export function Record() {
  const other = useGame((state) => state.recordOf);
  const account = useGame((state) => state.account);
  const ownStats = useGame((state) => state.record);
  const ownName = useGame((state) => state.settings.displayName);
  const updateSettings = useGame((state) => state.updateSettings);
  const back = useGame((state) => state.recordReturn);
  const setScreen = useGame((state) => state.setScreen);
  const [loaded, setLoaded] = useState<{ name: string; stats: PlayerStats } | null>(null);
  const [failed, setFailed] = useState(false);

  // Someone else's record is read from their account. A player's own is already here.
  const mine = !other || other.accountId === account?.id;
  useEffect(() => {
    if (mine || !other) return;
    let current = true;
    setLoaded(null);
    setFailed(false);
    void fetchPlayer(other.accountId).then((player) => {
      if (!current) return;
      if (player) setLoaded(player);
      else setFailed(true);
    });
    return () => {
      current = false;
    };
  }, [mine, other]);

  const name = mine ? ownName : (loaded?.name ?? other!.name);
  const stats = mine ? ownStats : loaded?.stats;

  return (
    <div className="screen">
      <header className="screen-head">
        <button className="small" onClick={() => setScreen(back)}>
          Back
        </button>
        <h1>Player record</h1>
        <span className="muted">{mine ? 'Yours' : name}</span>
      </header>

      <div className="screen-body columns">
        <section className="card">
          <h2>{mine ? 'You' : 'Player'}</h2>
          {mine ? (
            <label className="field">
              <span>Username</span>
              <input
                type="text"
                maxLength={20}
                value={ownName}
                onChange={(event) => updateSettings({ displayName: event.target.value })}
                onBlur={() => void rename(ownName)}
              />
            </label>
          ) : (
            <p className="record-name">{name}</p>
          )}
          {mine && (
            <p className="hint">
              {account
                ? `Signed in as ${account.email}. Your username and record follow you to any device.`
                : accountsAvailable
                  ? 'This record is kept in this browser. Sign in from the main menu to keep it, and your username, on every device.'
                  : 'This record is kept in this browser.'}
            </p>
          )}
          {failed && <p className="hint lobby-error">This player’s record could not be read.</p>}
          {!stats && !failed && <p className="hint">Reading their record…</p>}
          {stats && <Summary stats={stats} />}
        </section>

        <section className="card">
          <h2>Most driven robots</h2>
          {stats && topRobots(stats).length === 0 && <p className="hint">No matches finished yet.</p>}
          {stats && (
            <ol className="robot-ranks">
              {topRobots(stats).map(([robot, matches]) => (
                <li key={robot}>
                  <span>{robot}</span>
                  <span className="muted">
                    {matches} {matches === 1 ? 'match' : 'matches'}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card coming-soon" aria-disabled="true">
          <h2>Leaderboard ranking</h2>
          <p className="coming-soon-text">Coming soon!</p>
        </section>
      </div>
    </div>
  );
}

const dash = '–';

function Summary({ stats }: { stats: PlayerStats }) {
  const favourite = topRobots(stats, 1)[0]?.[0];
  return (
    <dl className="record">
      <dt>Matches played</dt>
      <dd>{stats.matches}</dd>
      <dt>Record (W-L-T)</dt>
      <dd>
        {stats.wins}-{stats.losses}-{stats.ties}
      </dd>
      <dt>Win rate</dt>
      <dd>{stats.matches > 0 ? `${Math.round((100 * stats.wins) / stats.matches)}%` : dash}</dd>
      <dt>Most played robot</dt>
      <dd>{favourite ?? dash}</dd>
      <dt>Average solo score, multiplayer</dt>
      <dd>{stats.soloMatches > 0 ? Math.round(stats.soloTotal / stats.soloMatches) : dash}</dd>
      <dt>Singleplayer matches</dt>
      <dd>{stats.singleMatches}</dd>
      <dt>Best singleplayer score</dt>
      <dd>{stats.singleMatches > 0 ? stats.singleBest : dash}</dd>
    </dl>
  );
}
