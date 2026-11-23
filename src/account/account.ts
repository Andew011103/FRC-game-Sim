import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { readSettings } from '../settings';
import { findRobot } from '../robots';
import { PASS, inSeason } from '../pass/pass';
import {
  EMPTY_STATS,
  loadSeasonStats,
  loadStats,
  recordMatch,
  recordSeasonMatch,
  withMatch,
  type FinishedMatch,
  type PlayerStats,
} from '../stats';
import { useGame } from '../ui/store';

// Accounts live in a Supabase project (set up with supabase/schema.sql).
// Signed in, a player's finished matches are saved there and follow them to
// any device. Signed out, or with no project set up, they stay in the browser.

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

/** The Supabase project, for the leaderboards; null when there is none. */
export const supabaseClient = (): SupabaseClient | null => supabase;

/** False when the game was built without a Supabase project: there is nothing to sign in to. */
export const accountsAvailable = supabase !== null;

/** What is saved about a finished match beyond who won. */
export interface SavedMatch extends FinishedMatch {
  game: string;
  official: boolean;
  players: number;
}

const cleanName = (name: unknown): string => (typeof name === 'string' ? name.trim().slice(0, 20) : '') || 'Driver';

/** Starts following who is signed in. Call once when the page loads. */
export function initAccount(): void {
  useGame.getState().setRecord(loadStats());
  useGame.getState().setSeasonRecord(loadSeasonStats(PASS.id));
  if (!supabase) return;
  watchPreferences();
  // Supabase must not be called from inside this callback, so the work is put off a moment.
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => void showUser(session?.user ?? null), 0);
  });
}

async function showUser(user: User | null): Promise<void> {
  const state = useGame.getState();
  if (!supabase || !user) {
    state.setAccount(null);
    state.setRecord(loadStats());
    state.setSeasonRecord(loadSeasonStats(PASS.id));
    state.setStanding([], 0);
    return;
  }
  if (state.account?.id === user.id) return;

  // A player signing in for the first time has no profile yet: give them the name they signed up with.
  let { data: profile, error } = await supabase
    .from('profiles')
    .select('display_name, preferences')
    .eq('id', user.id)
    .maybeSingle();
  // A database set up before preferences were saved has no such column.
  if (error) ({ data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle());
  let name = profile?.display_name as string | undefined;
  if (!name) {
    name = cleanName(user.user_metadata?.display_name ?? state.settings.displayName);
    await supabase.from('profiles').upsert({ id: user.id, display_name: name });
  }
  state.setAccount({ id: user.id, email: user.email ?? '', name });
  const preferences = (profile as { preferences?: unknown } | null)?.preferences;
  if (preferences && typeof preferences === 'object') {
    applyPreferences(preferences as Record<string, unknown>, name);
  } else {
    state.updateSettings({ displayName: name });
    // The first time on an account, it takes this browser's choices.
    void savePreferences();
  }
  const records = await fetchRecords(user.id);
  state.setRecord(records?.all ?? EMPTY_STATS);
  state.setSeasonRecord(records?.season ?? EMPTY_STATS);
  // Leaderboard places, champion robots and top-3 Ranking Points.
  void import('./leaderboard').then(({ refreshStanding }) => refreshStanding());
}

/** True while choices from the account are being put in place, so they are not sent straight back. */
let applying = false;

/** Puts the robot and settings saved in the account in place of this browser's. */
function applyPreferences(preferences: Record<string, unknown>, name: string): void {
  const state = useGame.getState();
  applying = true;
  try {
    const saved = readSettings(preferences.settings);
    state.updateSettings({ ...saved, displayName: name, owned: { ...state.settings.owned, ...saved.owned } });
    // A custom robot made on another device is not in this browser; then the robot here stays.
    const robotId = preferences.robotId;
    if (typeof robotId === 'string' && findRobot(robotId, state.customRobots).id === robotId) state.setRobotId(robotId);
    // Free practice only when the player last chose it; otherwise a timed match.
    state.setMode(preferences.mode === 'practice' ? 'practice' : 'match');
  } finally {
    applying = false;
  }
}

/** Saves the chosen robot and the settings to the account. */
async function savePreferences(): Promise<void> {
  const { account, settings, robotId, mode } = useGame.getState();
  if (!supabase || !account) return;
  const preferences = { robotId, settings, mode };
  const { error } = await supabase.from('profiles').update({ preferences }).eq('id', account.id);
  if (error) console.warn('Saving settings to the account failed:', error.message);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Saves the robot and settings to the account a moment after they change, so a run of changes is one save. */
function watchPreferences(): void {
  useGame.subscribe((state, previous) => {
    if (applying || !state.account || state.account.id !== previous.account?.id) return;
    if (state.settings === previous.settings && state.robotId === previous.robotId && state.mode === previous.mode) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void savePreferences(), 1500);
  });
}

async function fetchRecord(userId: string): Promise<PlayerStats | null> {
  return (await fetchRecords(userId))?.all ?? null;
}

/** A player's whole record, and their record for the current Drive Pass season. */
async function fetchRecords(userId: string): Promise<{ all: PlayerStats; season: PlayerStats } | null> {
  if (!supabase) return null;
  const rows = (columns: string) =>
    supabase
      .from('match_results')
      .select(columns)
      .eq('user_id', userId)
      .order('played_at', { ascending: false })
      .limit(1000);
  let { data, error } = await rows('robot, own_score, other_score, kind, solo_score, bonus_rp, played_at');
  // A database set up before bonus ranking points were recorded lacks that column.
  if (error) ({ data, error } = await rows('robot, own_score, other_score, kind, solo_score, played_at'));
  // A database set up before singleplayer and solo scores were recorded has only the older columns.
  if (error) ({ data, error } = await rows('robot, own_score, other_score, played_at'));
  if (error || !data) return null;
  const all = data as unknown as Record<string, unknown>[];
  const add = (stats: PlayerStats, row: Record<string, unknown>) =>
      withMatch(stats, {
        alliance: 'blue',
        blue: Number(row.own_score) || 0,
        red: Number(row.other_score) || 0,
        robot: String(row.robot),
        single: row.kind === 'single',
        solo: typeof row.solo_score === 'number' ? row.solo_score : null,
        bonusRp: typeof row.bonus_rp === 'number' ? row.bonus_rp : 0,
      });
  return {
    all: all.reduce(add, EMPTY_STATS),
    season: all.filter((row) => typeof row.played_at === 'string' && inSeason(row.played_at)).reduce(add, EMPTY_STATS),
  };
}

/** Another player's name and record, or null if they cannot be read. */
export async function fetchPlayer(accountId: string): Promise<{ name: string; stats: PlayerStats } | null> {
  if (!supabase) return null;
  const [profile, stats] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', accountId).maybeSingle(),
    fetchRecord(accountId),
  ]);
  const name = profile.data?.display_name as string | undefined;
  return name && stats ? { name, stats } : null;
}

/** A room in the list of open matches. */
export interface OpenRoom {
  code: string;
  host: string;
  players: number;
  spectators: number;
  playing: boolean;
}

/** Puts a room in the list of open matches, or brings its entry up to date. Only whoever has its secret can. */
export async function listRoom(entry: OpenRoom & { secret: string }): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('put_room', {
    p_code: entry.code,
    p_secret: entry.secret,
    p_host: entry.host.slice(0, 20),
    p_players: entry.players,
    p_spectators: entry.spectators,
    p_playing: entry.playing,
  });
  if (error) console.warn('Listing the room failed:', error.message);
}

export async function unlistRoom(code: string, secret: string): Promise<void> {
  if (!supabase) return;
  await supabase.rpc('drop_room', { p_code: code, p_secret: secret });
}

/** The rooms open right now, or null if the list cannot be read. */
export async function fetchRooms(): Promise<OpenRoom[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('open_rooms');
  if (error) console.warn('Reading the open matches failed:', error.code, error.message);
  if (error || !Array.isArray(data)) return null;
  return (data as Record<string, unknown>[]).map((row) => ({
    code: String(row.code),
    host: String(row.host_name ?? 'Host'),
    players: Number(row.players) || 0,
    spectators: Number(row.spectators) || 0,
    playing: row.playing === true,
  }));
}

/** Signs in. Returns what went wrong, or null. */
export async function signIn(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Accounts are not set up.';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

/** Makes an account. Returns a message for the player (a problem, or what to do next), or null when they are in. */
export async function signUp(email: string, password: string, name: string): Promise<string | null> {
  if (!supabase) return 'Accounts are not set up.';
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: cleanName(name) } },
  });
  if (error) return error.message;
  return data.session ? null : 'Check your email for a link to confirm the account, then sign in.';
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

/** Changes the signed-in player's name. */
export async function rename(name: string): Promise<void> {
  const { account, setAccount } = useGame.getState();
  if (!supabase || !account || cleanName(name) === account.name) return;
  const { error } = await supabase.from('profiles').update({ display_name: cleanName(name) }).eq('id', account.id);
  if (!error) setAccount({ ...account, name: cleanName(name) });
}

/** Adds a finished match to the player's record: in their account when signed in, otherwise in this browser. */
export async function saveMatch(match: SavedMatch): Promise<void> {
  const state = useGame.getState();
  if (!supabase || !state.account) {
    recordMatch(match);
    recordSeasonMatch(match, PASS.id);
    state.setRecord(loadStats());
    state.setSeasonRecord(loadSeasonStats(PASS.id));
    return;
  }
  const own = match[match.alliance];
  const other = match[match.alliance === 'blue' ? 'red' : 'blue'];
  const row = {
    game: match.game,
    alliance: match.alliance,
    robot: match.robot.slice(0, 40),
    official: match.official,
    own_score: own,
    other_score: other,
    players: match.players,
    kind: match.single ? 'single' : 'multi',
    solo_score: match.solo,
  };
  let { error } = await supabase.from('match_results').insert({ ...row, bonus_rp: match.single ? 0 : (match.bonusRp ?? 0) });
  // A database set up before bonus ranking points were recorded has no column for them; the match is still saved.
  if (error) ({ error } = await supabase.from('match_results').insert(row));
  if (error) {
    // Better kept in the browser than lost.
    recordMatch(match);
    recordSeasonMatch(match, PASS.id);
    console.warn('Saving the match failed:', error.message);
    state.setAccountNote('That match could not be saved to your account, so it was kept in this browser.');
    return;
  }
  state.setRecord(withMatch(useGame.getState().record, match));
  state.setSeasonRecord(withMatch(useGame.getState().seasonRecord, match));
}
