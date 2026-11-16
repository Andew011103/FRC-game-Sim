import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { EMPTY_STATS, loadStats, recordMatch, withMatch, type FinishedMatch, type PlayerStats } from '../stats';
import { useGame } from '../ui/store';

// Accounts live in a Supabase project (set up with supabase/schema.sql).
// Signed in, a player's finished matches are saved there and follow them to
// any device. Signed out, or with no project set up, they stay in the browser.

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

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
  if (!supabase) return;
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
    return;
  }
  if (state.account?.id === user.id) return;

  // A player signing in for the first time has no profile yet: give them the name they signed up with.
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
  let name = profile?.display_name as string | undefined;
  if (!name) {
    name = cleanName(user.user_metadata?.display_name ?? state.settings.displayName);
    await supabase.from('profiles').upsert({ id: user.id, display_name: name });
  }
  state.setAccount({ id: user.id, email: user.email ?? '', name });
  state.updateSettings({ displayName: name });
  state.setRecord((await fetchRecord(user.id)) ?? EMPTY_STATS);
}

async function fetchRecord(userId: string): Promise<PlayerStats | null> {
  if (!supabase) return null;
  const rows = (columns: string) =>
    supabase
      .from('match_results')
      .select(columns)
      .eq('user_id', userId)
      .order('played_at', { ascending: false })
      .limit(1000);
  let { data, error } = await rows('robot, own_score, other_score, kind, solo_score');
  // A database set up before singleplayer and solo scores were recorded has only the older columns.
  if (error) ({ data, error } = await rows('robot, own_score, other_score'));
  if (error || !data) return null;
  return (data as unknown as Record<string, unknown>[]).reduce<PlayerStats>(
    (stats, row) =>
      withMatch(stats, {
        alliance: 'blue',
        blue: Number(row.own_score) || 0,
        red: Number(row.other_score) || 0,
        robot: String(row.robot),
        single: row.kind === 'single',
        solo: typeof row.solo_score === 'number' ? row.solo_score : null,
      }),
    EMPTY_STATS,
  );
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
    state.setRecord(loadStats());
    return;
  }
  const own = match[match.alliance];
  const other = match[match.alliance === 'blue' ? 'red' : 'blue'];
  const { error } = await supabase.from('match_results').insert({
    game: match.game,
    alliance: match.alliance,
    robot: match.robot.slice(0, 40),
    official: match.official,
    own_score: own,
    other_score: other,
    players: match.players,
    kind: match.single ? 'single' : 'multi',
    solo_score: match.solo,
  });
  if (error) {
    // Better kept in the browser than lost.
    recordMatch(match);
    console.warn('Saving the match failed:', error.message);
    state.setAccountNote('That match could not be saved to your account, so it was kept in this browser.');
    return;
  }
  state.setRecord(withMatch(useGame.getState().record, match));
}
