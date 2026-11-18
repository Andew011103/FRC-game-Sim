import { useEffect, useState } from 'react';
import { accountsAvailable, signIn, signUp } from '../account/account';
import { useGame } from './store';

/** Signing in to an account, or making one. Goes back where the player came from once they are in. */
export function SignIn() {
  const account = useGame((state) => state.account);
  const back = useGame((state) => state.signinReturn);
  const setScreen = useGame((state) => state.setScreen);
  const name = useGame((state) => state.settings.displayName);
  const updateSettings = useGame((state) => state.updateSettings);
  const [making, setMaking] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Signed in: back to where the player was.
  useEffect(() => {
    if (account) setScreen(back === 'signin' ? 'home' : back);
  }, [account, back, setScreen]);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    setMessage(making ? await signUp(email, password, name) : await signIn(email, password));
    setBusy(false);
    setPassword('');
  };
  const filled = email.includes('@') && password.length >= 6 && (!making || name.trim().length > 0);

  return (
    <div className="screen">
      <header className="screen-head">
        <button className="small" onClick={() => setScreen(back === 'signin' ? 'home' : back)}>
          Back
        </button>
        <h1>{making ? 'Create account' : 'Sign in'}</h1>
        <span className="muted">Your record and settings follow you to any device</span>
      </header>
      <div className="screen-body centered-body">
        <form
          className="card signin"
          onSubmit={(event) => {
            event.preventDefault();
            if (filled && !busy) void submit();
          }}
        >
          {!accountsAvailable ? (
            <p className="hint">Accounts are not set up for this copy of the game, so your record is kept in this browser.</p>
          ) : (
            <>
              <div className="toggle-pair" role="group" aria-label="Sign in or create an account">
                <button type="button" className={making ? '' : 'selected'} onClick={() => setMaking(false)}>
                  Sign in
                </button>
                <button type="button" className={making ? 'selected' : ''} onClick={() => setMaking(true)}>
                  Create account
                </button>
              </div>
              {making && (
                <label className="field">
                  <span>Username</span>
                  <input type="text" maxLength={20} value={name} onChange={(event) => updateSettings({ displayName: event.target.value })} />
                </label>
              )}
              <label className="field">
                <span>Email</span>
                <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label className="field">
                <span>Password, 6 or more characters</span>
                <input
                  type="password"
                  autoComplete={making ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button className="primary" type="submit" disabled={busy || !filled}>
                {making ? 'Create account' : 'Sign in'}
              </button>
              {busy && <p className="hint">One moment…</p>}
              {message && <p className="hint">{message}</p>}
            </>
          )}
        </form>
      </div>
    </div>
  );
}
