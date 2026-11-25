import { accountsAvailable } from '../account/account';
import { useGame, type Screen } from './store';

/** What each button on the first screen leads to. Null means it is not built yet. */
const ENTRIES: { label: string; screen: Screen | null; note?: string }[] = [
  { label: 'Singleplayer', screen: 'singleplayer' },
  { label: 'Multiplayer', screen: 'multiplayer' },
  { label: 'Leaderboard', screen: 'leaderboard' },
  { label: 'Changelog', screen: 'changelog' },
  { label: 'Change game', screen: null, note: 'Coming soon' },
  { label: 'Settings', screen: 'settings' },
];

/** The first screen: a list of places to go, over the turning field. */
export function Home() {
  const setScreen = useGame((state) => state.setScreen);
  const showRecord = useGame((state) => state.showRecord);
  const ready = useGame((state) => state.ready);
  const account = useGame((state) => state.account);
  const showSignIn = useGame((state) => state.showSignIn);
  const name = useGame((state) => state.settings.displayName);
  // Without an account linked, the player button leads to signing in instead.
  const signedOut = accountsAvailable && !account;

  return (
    <div className="home">
      <nav className="home-top">
        <button className="home-shop" disabled={!ready} onClick={() => setScreen('shop')}>
          Shop
        </button>
        <button className="home-pass" disabled={!ready} onClick={() => setScreen('pass')}>
          Drive Pass
        </button>
        <button
          className="home-player"
          disabled={!ready}
          title={signedOut ? 'Sign in to keep your record on every device' : 'Your record and cosmetics'}
          onClick={() => (signedOut ? showSignIn() : showRecord(null))}
        >
          {signedOut ? 'Sign in' : name.trim() || 'Player'}
        </button>
      </nav>
      <div className="home-menu">
        <p className="eyebrow">Robot driving simulator</p>
        <h1>Drive Practice</h1>
        {ENTRIES.map((entry) => (
          <button
            key={entry.label}
            className="home-button"
            disabled={entry.screen === null || !ready}
            onClick={() => entry.screen && setScreen(entry.screen)}
          >
            <span>{entry.label}</span>
            {entry.note && <span className="note">{entry.note}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
