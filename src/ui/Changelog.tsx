import { useState } from 'react';
import data from '../changelog.json';
import { useGame } from './store';

/** One update: its title, when it came out if given, and what it changed. */
export interface ChangelogEntry {
  title: string;
  /** The day it came out, as YYYY-MM-DD, or empty. */
  date?: string;
  changes: string[];
}

/**
 * The changelog as kept in src/changelog.json, newest first. Anything that is
 * not an entry with a title is left out, and blank changes are dropped.
 */
export function readChangelog(raw: unknown): ChangelogEntry[] {
  const entries = (raw as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry): ChangelogEntry[] => {
    const { title, date, changes } = (entry ?? {}) as Record<string, unknown>;
    if (typeof title !== 'string' || !title.trim()) return [];
    return [
      {
        title: title.trim(),
        ...(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {}),
        changes: Array.isArray(changes) ? changes.filter((change): change is string => typeof change === 'string' && !!change.trim()) : [],
      },
    ];
  });
}

const CHANGELOG = readChangelog(data);

/** A date from the file, as the player's computer writes dates. */
const shownDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

/** What each update changed, newest first. While developing, the entries can be edited here. */
export function Changelog() {
  const setScreen = useGame((state) => state.setScreen);
  const [editing, setEditing] = useState(false);
  return (
    <div className="screen">
      <header className="screen-head">
        <button className="small" onClick={() => setScreen('home')}>
          Back
        </button>
        <h1>Changelog</h1>
        {import.meta.env.DEV && (
          <button className="small" onClick={() => setEditing(!editing)} title="Only while developing">
            {editing ? 'Close the editor' : 'Edit the changelog'}
          </button>
        )}
      </header>
      <div className="screen-body narrow">
        {editing ? (
          <ChangelogEditor onDone={() => setEditing(false)} />
        ) : (
          <>
            {CHANGELOG.length === 0 && <p className="hint">Nothing here yet.</p>}
            {CHANGELOG.map((entry, i) => (
              <section className="card" key={`${i}-${entry.title}`}>
                <h2>{entry.title}</h2>
                {entry.date && <p className="muted changelog-date">{shownDate(entry.date)}</p>}
                <ul className="plain-list">
                  {entry.changes.map((change, j) => (
                    <li key={j}>{change}</li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** An item moved one place up (-1) or down (+1) in a list; out of range leaves the list as it is. */
function moved<T>(list: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/**
 * Development only: adds, removes, reorders and rewrites changelog entries,
 * and saves them into the project (src/changelog.json), where the published game reads them.
 */
function ChangelogEditor({ onDone }: { onDone: () => void }) {
  const [entries, setEntries] = useState<ChangelogEntry[]>(() => JSON.parse(JSON.stringify(CHANGELOG)));
  const [message, setMessage] = useState<string | null>(null);
  const setEntry = (index: number, change: Partial<ChangelogEntry>) =>
    setEntries(entries.map((entry, i) => (i === index ? { ...entry, ...change } : entry)));
  const untitled = entries.some((entry) => !entry.title.trim());

  const save = async () => {
    try {
      const cleaned = entries.map((entry) => ({ ...entry, changes: entry.changes.filter((change) => change.trim()) }));
      const reply = await fetch('/__changelog', { method: 'POST', body: JSON.stringify({ entries: cleaned }) });
      if (!reply.ok) throw new Error();
      setMessage('Saved to src/changelog.json. The page reloads with the new changelog.');
    } catch {
      setMessage('Could not save. This only works while running the game locally.');
    }
  };

  return (
    <section className="card changelog-editor">
      <h2>Edit the changelog</h2>
      <p className="hint">
        Only on your computer. Saving writes src/changelog.json; commit it to publish. The newest update goes at the top. Empty
        changes are left out when saving.
      </p>
      <div className="button-row">
        <button className="secondary" onClick={() => setEntries([{ title: 'New update', date: today(), changes: [''] }, ...entries])}>
          Add an update at the top
        </button>
      </div>
      {entries.map((entry, i) => (
        <div className="changelog-entry-editor" key={i}>
          <div className="pass-tier-row">
            <label className="changelog-title-input">
              Title
              <input type="text" value={entry.title} onChange={(event) => setEntry(i, { title: event.target.value })} />
            </label>
            <label>
              Date (optional)
              <input type="date" value={entry.date ?? ''} onChange={(event) => setEntry(i, { date: event.target.value || undefined })} />
            </label>
            <button className="small secondary" disabled={i === 0} onClick={() => setEntries(moved(entries, i, -1))} title="Move up">
              ↑
            </button>
            <button
              className="small secondary"
              disabled={i === entries.length - 1}
              onClick={() => setEntries(moved(entries, i, 1))}
              title="Move down"
            >
              ↓
            </button>
            <button className="small danger" onClick={() => setEntries(entries.filter((_, j) => j !== i))}>
              Remove update
            </button>
          </div>
          {entry.changes.map((change, j) => (
            <div className="changelog-change" key={j}>
              <textarea
                rows={2}
                value={change}
                aria-label={`Change ${j + 1} of ${entry.title}`}
                onChange={(event) => setEntry(i, { changes: entry.changes.map((other, k) => (k === j ? event.target.value : other)) })}
              />
              <button className="small secondary" disabled={j === 0} onClick={() => setEntry(i, { changes: moved(entry.changes, j, -1) })} title="Move up">
                ↑
              </button>
              <button
                className="small secondary"
                disabled={j === entry.changes.length - 1}
                onClick={() => setEntry(i, { changes: moved(entry.changes, j, 1) })}
                title="Move down"
              >
                ↓
              </button>
              <button className="small danger" onClick={() => setEntry(i, { changes: entry.changes.filter((_, k) => k !== j) })} title="Remove this change">
                ✕
              </button>
            </div>
          ))}
          <button className="small secondary changelog-add-change" onClick={() => setEntry(i, { changes: [...entry.changes, ''] })}>
            Add a change
          </button>
        </div>
      ))}
      {untitled && <p className="hint lobby-error">Every update needs a title.</p>}
      <div className="button-row">
        <button className="primary" disabled={untitled} onClick={() => void save()}>
          Save the changelog
        </button>
        <button className="secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
      {message && <p className="hint">{message}</p>}
    </section>
  );
}

/** Today, as YYYY-MM-DD on the player's own calendar. */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
