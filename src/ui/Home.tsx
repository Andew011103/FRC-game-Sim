import { useGame, type Screen } from './store';

/** What each button on the first screen leads to. Null means it is not built yet. */
const ENTRIES: { label: string; screen: Screen | null; note?: string }[] = [
  { label: 'Singleplayer', screen: 'singleplayer' },
  { label: 'Multiplayer', screen: 'multiplayer' },
  { label: 'Leaderboard', screen: null, note: 'Coming later' },
  { label: 'Update logs', screen: 'updates' },
  { label: 'Change game', screen: null, note: 'Coming later' },
  { label: 'Settings', screen: 'settings' },
];

/** The first screen: a list of places to go, over the turning field. */
export function Home() {
  const setScreen = useGame((state) => state.setScreen);
  const ready = useGame((state) => state.ready);

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
