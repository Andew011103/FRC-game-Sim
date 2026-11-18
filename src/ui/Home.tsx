import { accountsAvailable } from '../account/account';
import { useGame, type Screen } from './store';

/** What each button on the first screen leads to. Null means it is not built yet. */
const ENTRIES: { label: string; screen: Screen | null; note?: string }[] = [
  { label: 'Singleplayer', screen: 'singleplayer' },
  { label: 'Multiplayer', screen: 'multiplayer' },
  { label: 'Player record', screen: 'record' },
  { label: 'Leaderboard', screen: null, note: 'Coming later' },
  { label: 'Update logs', screen: 'updates' },
  { label: 'Change game', screen: null, note: 'Coming later' },
  { label: 'Settings', screen: 'settings' },
];

/** The first screen: a list of places to go, over the turning field. */
export function Home() {
  const setScreen = useGame((state) => state.setScreen);
  const showRecord = useGame((state) => state.showRecord);
  const ready = useGame((state) => state.ready);
  const account = useGame((state) => state.account);
  const showSignIn = useGame((state) => state.showSignIn);
  // Without an account linked, the record entry leads to signing in instead.
  const signedOut = accountsAvailable && !account;

  return (
    <div className="home">
      <div className="home-menu">
        <p className="eyebrow">Robot driving simulator</p>
        <h1>Drive Practice</h1>
        {ENTRIES.map((entry) => (
          <button
            key={entry.label}
            className="home-button"
            disabled={entry.screen === null || !ready}
            onClick={() =>
              entry.screen === 'record' ? (signedOut ? showSignIn() : showRecord(null)) : entry.screen && setScreen(entry.screen)
            }
          >
            <span>{entry.screen === 'record' && signedOut ? 'Sign in' : entry.label}</span>
            {entry.note && <span className="note">{entry.note}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
