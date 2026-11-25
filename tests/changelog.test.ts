import { describe, expect, it } from 'vitest';
import data from '../src/changelog.json';
import { DEFAULT_SETTINGS, readSettings } from '../src/settings';
import { readChangelog } from '../src/ui/Changelog';
import { PLAY_CAMERAS } from '../src/ui/store';

describe('changelog', () => {
  it('reads the project changelog, newest first, with every entry titled', () => {
    const entries = readChangelog(data);
    expect(entries.length).toBeGreaterThan(5);
    expect(entries.every((entry) => entry.title && entry.changes.length > 0)).toBe(true);
  });

  it('leaves out anything that is not an entry, blank changes and bad dates', () => {
    const entries = readChangelog({
      entries: [{ title: ' First ', date: 'soon', changes: ['One', '  ', 3] }, { changes: ['no title'] }, null, { title: 'Dated', date: '2026-11-24', changes: [] }],
    });
    expect(entries).toEqual([
      { title: 'First', changes: ['One'] },
      { title: 'Dated', date: '2026-11-24', changes: [] },
    ]);
    expect(readChangelog(null)).toEqual([]);
  });
});

describe('cameras', () => {
  it('starts everyone on the angled camera, once, and has no overhead view for drivers', () => {
    expect(DEFAULT_SETTINGS.defaultCamera).toBe('angled');
    expect(PLAY_CAMERAS).not.toContain('top');
    // Saved before the change: moved to the new default.
    expect(readSettings({ defaultCamera: 'driver' }).defaultCamera).toBe('angled');
    expect(readSettings({ defaultCamera: 'top', cameraVersion: 2 }).defaultCamera).toBe('angled');
    // Picked since: kept.
    expect(readSettings({ defaultCamera: 'follow', cameraVersion: 2 }).defaultCamera).toBe('follow');
  });
});
