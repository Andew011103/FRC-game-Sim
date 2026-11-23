import { configuredGame } from '../games';
import { PASS } from '../pass/pass';
import type { RobotDefinition } from '../robots/types';
import { useGame } from '../ui/store';
import { supabaseClient } from './account';

// Leaderboards: a board for each official robot and an overall board, for
// each Drive Pass season. A run counts when it is a timed singleplayer match,
// by a signed-in player, with an official robot and the standard rules. The
// database keeps every run and ranks players by their best one; it also
// decides top-3 places and their Ranking Points, so a player cannot give
// themselves either.

/** One place on a board. */
export interface BoardRow {
  place: number;
  userId: string;
  name: string;
  /** Drive Pass name colour and badge reward ids, for showing the name as the player styled it. */
  nameColor: string;
  badge: string;
  robotId: string;
  score: number;
  playedAt: string;
}

/** Where a player stands on one board: a robot's, or the overall one (robotId null). */
export interface Standing {
  robotId: string | null;
  place: number;
  score: number;
}

/** Ranking Points for a first top-3 place on a season's overall board. */
export const TOP3_RP = [15, 12, 10];
/** How many players a board shows. */
export const BOARD_SIZE = 20;

/** Whether the rules are the standard ones: anything else (more fuel, a stronger human player) does not rank. */
export function standardRules(gameId: string, options: Record<string, unknown> | undefined): boolean {
  const specs = configuredGame(gameId).options ?? [];
  return specs.every((spec) => options?.[spec.key] === undefined || options[spec.key] === spec.default);
}

/** Whether a finished singleplayer run can go on the leaderboards, and if not, why. */
export function rankable(robot: RobotDefinition, timed: boolean): string | null {
  const { gameId, gameOptions, account } = useGame.getState();
  if (!timed) return 'Only timed matches go on the leaderboards.';
  if (!robot.official) return 'Custom robots do not go on the leaderboards.';
  if (!standardRules(gameId, gameOptions[gameId])) return 'Only matches with the standard rules go on the leaderboards.';
  if (!account) return 'Sign in to put your runs on the leaderboards.';
  return null;
}

/**
 * Adds a finished run to the leaderboards, then checks what it earned: a
 * first top-3 place this season, and first place on its robot's board.
 * Returns a note for the player, or null.
 */
export async function submitRun(robotId: string, score: number): Promise<string | null> {
  const supabase = supabaseClient();
  if (!supabase || !useGame.getState().account) return null;
  const { error } = await supabase
    .from('leaderboard_runs')
    .insert({ season_id: PASS.id, robot_id: robotId, score: Math.max(0, Math.min(5000, Math.round(score))) });
  if (error) {
    console.warn('Adding the run to the leaderboards failed:', error.message);
    return null;
  }
  const { data: points } = await supabase.rpc('claim_top3', { p_season: PASS.id });
  const before = useGame.getState().champions;
  await refreshStanding();
  const notes: string[] = [];
  const rp = Number(points) || 0;
  if (rp > 0) notes.push(`Top ${TOP3_RP.indexOf(rp) + 1} this season! +${rp} Ranking Points.`);
  if (!before.includes(robotId) && useGame.getState().champions.includes(robotId)) notes.push('You are first on this robot’s leaderboard.');
  return notes.length > 0 ? notes.join(' ') : null;
}

/** Brings this player's champion robots and top-3 Ranking Points up to date. */
export async function refreshStanding(): Promise<void> {
  const supabase = supabaseClient();
  const { account, setStanding } = useGame.getState();
  if (!supabase || !account) {
    setStanding([], 0);
    return;
  }
  const [standings, award] = await Promise.all([
    fetchStandings(account.id),
    supabase.from('season_awards').select('rp').eq('user_id', account.id).eq('season_id', PASS.id).maybeSingle(),
  ]);
  const champions = (standings ?? []).filter((standing) => standing.robotId && standing.place === 1).map((standing) => standing.robotId!);
  setStanding(champions, Number(award.data?.rp) || 0);
}

/** One board this season: a robot's, or the overall one when robotId is null. */
export async function fetchBoard(robotId: string | null): Promise<BoardRow[] | null> {
  const supabase = supabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('leaderboard', { p_season: PASS.id, p_robot: robotId });
  if (error || !Array.isArray(data)) {
    if (error) console.warn('Reading the leaderboard failed:', error.code, error.message);
    return null;
  }
  return (data as Record<string, unknown>[]).map((row) => ({
    place: Number(row.place),
    userId: String(row.user_id),
    name: String(row.display_name ?? 'Driver'),
    nameColor: typeof row.name_color === 'string' ? row.name_color : '',
    badge: typeof row.badge === 'string' ? row.badge : '',
    robotId: String(row.robot_id),
    score: Number(row.score) || 0,
    playedAt: String(row.played_at),
  }));
}

/** Where a player stands on every board this season (only places in the top 20). */
export async function fetchStandings(userId: string): Promise<Standing[] | null> {
  const supabase = supabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('player_rankings', { p_user: userId, p_season: PASS.id });
  if (error || !Array.isArray(data)) return null;
  return (data as Record<string, unknown>[]).map((row) => ({
    robotId: typeof row.robot_id === 'string' ? row.robot_id : null,
    place: Number(row.place),
    score: Number(row.score) || 0,
  }));
}

/** Time left in the season, as "7d 17:02:39". */
export function countdown(until: string, now = Date.now()): string {
  const left = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  const days = Math.floor(left / 86400);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${days}d ${two(Math.floor((left % 86400) / 3600))}:${two(Math.floor((left % 3600) / 60))}:${two(left % 60)}`;
}
