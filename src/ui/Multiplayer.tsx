import { useState } from 'react';
import { accountsAvailable, rename, signIn, signOut, signUp } from '../account/account';
import type { Alliance } from '../games/types';
import { CODE_LENGTH, cleanCode } from '../net/peer';
import { MAX_PER_ALLIANCE } from '../net/protocol';
import { multiplayer } from '../net/room';
import { findRobot } from '../robots';
import { PlayerName } from './Record';
import { useGame } from './store';

const ALLIANCES: { id: Alliance; name: string }[] = [
  { id: 'blue', name: 'Blue alliance' },
  { id: 'red', name: 'Red alliance' },
];

/** Hosting or joining a match with other players, and the room everyone waits in before it starts. */
export function Multiplayer() {
  const room = useGame((state) => state.room);
  const busy = useGame((state) => state.roomBusy);
  const error = useGame((state) => state.roomError);
  const setScreen = useGame((state) => state.setScreen);

  const back = () => {
    multiplayer.leave();
    useGame.getState().setRoomError(null);
    setScreen('home');
  };

  return (
    <div className="screen">
      <header className="screen-head">
        <button className="small" onClick={back}>
          {room ? 'Leave' : 'Back'}
        </button>
        <h1>Multiplayer</h1>
        <span className="muted">{room ? `Room ${room.code}` : 'Up to three robots a side'}</span>
      </header>
      {room ? <Room /> : <Entrance busy={busy} error={error} />}
    </div>
  );
}

/** Before being in a room: who you are, then host or join. */
function Entrance({ busy, error }: { busy: boolean; error: string | null }) {
  const [code, setCode] = useState('');
  const name = useGame((state) => state.settings.displayName);
  const updateSettings = useGame((state) => state.updateSettings);
  const setScreen = useGame((state) => state.setScreen);
  const robot = findRobot(
    useGame((state) => state.robotId),
    useGame((state) => state.customRobots),
  );

  return (
    <div className="screen-body columns">
      <section className="card">
        <h2>You</h2>
        <label className="field">
          <span>Name other players see</span>
          <input
            type="text"
            maxLength={20}
            value={name}
            onChange={(event) => updateSettings({ displayName: event.target.value })}
            onBlur={() => void rename(name)}
          />
        </label>
        <div className="field">
          <span>Robot</span>
          <span className="field-value">{robot.name}</span>
        </div>
        <button className="secondary" onClick={() => setScreen('robots')}>
          Change robot
        </button>
      </section>

      <section className="card">
        <h2>Host a match</h2>
        <p className="hint">You get a room code to share. The match runs on your computer, so keep this tab open and in view.</p>
        <button className="primary" disabled={busy} onClick={() => void multiplayer.hostRoom()}>
          Host a match
        </button>
        <h2>Join a match</h2>
        <label className="field">
          <span>Room code</span>
          <input
            className="code-input"
            type="text"
            value={code}
            placeholder={'A'.repeat(CODE_LENGTH)}
            onChange={(event) => setCode(cleanCode(event.target.value))}
          />
        </label>
        <button className="primary" disabled={busy || code.length !== CODE_LENGTH} onClick={() => void multiplayer.join(code)}>
          Join
        </button>
        {busy && <p className="hint">Connecting…</p>}
        {error && <p className="hint lobby-error">{error}</p>}
      </section>

      <Account />
    </div>
  );
}

/** Signing in, and the player's record of multiplayer matches. */
function Account() {
  const account = useGame((state) => state.account);
  const stats = useGame((state) => state.record);
  const note = useGame((state) => state.accountNote);
  const name = useGame((state) => state.settings.displayName);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const showRecord = useGame((state) => state.showRecord);

  const submit = async (action: 'in' | 'up') => {
    setBusy(true);
    setMessage(null);
    setMessage(action === 'in' ? await signIn(email, password) : await signUp(email, password, name));
    setBusy(false);
    setPassword('');
  };
  const filled = email.includes('@') && password.length >= 6;

  return (
      <section className="card">
        <h2>{account ? 'Your account' : 'Your record'}</h2>
        {account && (
          <div className="field">
            <span>Signed in as</span>
            <span className="field-value">{account.email}</span>
          </div>
        )}
        <dl className="record">
          <dt>Matches played</dt>
          <dd>{stats.matches}</dd>
          <dt>Record (W-L-T)</dt>
          <dd>
            {stats.wins}-{stats.losses}-{stats.ties}
          </dd>
        </dl>
        <button className="secondary" onClick={() => showRecord(null)}>
          View your record
        </button>
        {note && <p className="hint lobby-error">{note}</p>}
        {account ? (
          <button className="secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        ) : accountsAvailable ? (
          <>
            <p className="hint">This record is kept in this browser. Sign in to keep it in an account instead.</p>
            <label className="field">
              <span>Email</span>
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="field">
              <span>Password, 6 or more characters</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <div className="button-row">
              <button className="primary" disabled={busy || !filled} onClick={() => void submit('in')}>
                Sign in
              </button>
              <button className="secondary" disabled={busy || !filled} onClick={() => void submit('up')}>
                Create account
              </button>
            </div>
            {message && <p className="hint">{message}</p>}
          </>
        ) : (
          <p className="hint">Kept in this browser. Accounts are not set up for this copy of the game.</p>
        )}
      </section>
  );
}

/** The room: who is on which alliance, and the host's button to start. */
function Room() {
  const room = useGame((state) => state.room)!;
  const setScreen = useGame((state) => state.setScreen);
  const me = room.players.find((player) => player.id === room.myId);
  const isHost = room.role === 'host';

  return (
    <>
      <div className="screen-body columns">
        <section className="card lobby-share">
          <h2>Room code</h2>
          <p className="lobby-code">{room.code}</p>
          <p className="hint">
            {isHost ? 'Give this code to the players you want in the match.' : 'You are in. The host starts the match.'}
          </p>
        </section>
        {ALLIANCES.map(({ id, name }) => {
          const players = room.players.filter((player) => player.alliance === id);
          return (
            <section className={`card lobby-side ${id}`} key={id}>
              <h2>{name}</h2>
              {players.length === 0 && <p className="hint">Nobody yet.</p>}
              {players.map((player) => (
                <div className="lobby-player" key={player.id}>
                  <span>
                    <PlayerName player={player} />
                    {player.id === room.myId && <span className="muted"> (you)</span>}
                    {player.id === 0 && <span className="muted"> (host)</span>}
                  </span>
                  <span className="muted">{player.robot}</span>
                </div>
              ))}
              {me && me.alliance !== id && !room.playing && players.length < MAX_PER_ALLIANCE && (
                <button className="small" onClick={() => multiplayer.chooseAlliance(id)}>
                  Switch to this alliance
                </button>
              )}
            </section>
          );
        })}
      </div>
      <footer className="screen-foot">
        <span className="muted">
          {room.players.length} of 6 players. Timed match, 2:40.
        </span>
        {isHost && (
          <button className="secondary" onClick={() => setScreen('rules')}>
            Rules
          </button>
        )}
        {isHost ? (
          <button className="primary" onClick={() => multiplayer.start()}>
            Start match
          </button>
        ) : (
          <span className="muted">Waiting for the host to start…</span>
        )}
      </footer>
    </>
  );
}
