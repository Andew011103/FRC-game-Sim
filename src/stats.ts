import type { Alliance } from './games/types';

// A player's record over the multiplayer matches they have finished. For now
// it is kept in this browser.

const STORAGE_KEY = 'drive-practice.stats';

export interface PlayerStats {
  matches: number;
  wins: number;
  losses: number;
  ties: number;
  /** The best and the summed score of the player's own alliance. */
  bestScore: number;
  totalScore: number;
  /** Matches played with each robot, by the robot's name. */
  robots: Record<string, number>;
}

export const EMPTY_STATS: PlayerStats = { matches: 0, wins: 0, losses: 0, ties: 0, bestScore: 0, totalScore: 0, robots: {} };

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

export function loadStats(): PlayerStats {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    const robots: Record<string, number> = {};
    for (const [name, played] of Object.entries((saved.robots ?? {}) as Record<string, unknown>)) {
      if (count(played) > 0) robots[name] = count(played);
    }
    return {
      matches: count(saved.matches),
      wins: count(saved.wins),
      losses: count(saved.losses),
      ties: count(saved.ties),
      bestScore: count(saved.bestScore),
      totalScore: count(saved.totalScore),
      robots,
    };
  } catch {
    return { ...EMPTY_STATS, robots: {} };
  }
}

export interface FinishedMatch {
  alliance: Alliance;
  blue: number;
  red: number;
  robot: string;
}

/** A record with one more finished match added. */
export function withMatch(stats: PlayerStats, match: FinishedMatch): PlayerStats {
  const mine = match[match.alliance];
  const theirs = match[match.alliance === 'blue' ? 'red' : 'blue'];
  return {
    matches: stats.matches + 1,
    wins: stats.wins + (mine > theirs ? 1 : 0),
    losses: stats.losses + (mine < theirs ? 1 : 0),
    ties: stats.ties + (mine === theirs ? 1 : 0),
    bestScore: Math.max(stats.bestScore, mine),
    totalScore: stats.totalScore + mine,
    robots: { ...stats.robots, [match.robot]: (stats.robots[match.robot] ?? 0) + 1 },
  };
}

export function recordMatch(match: FinishedMatch): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withMatch(loadStats(), match)));
  } catch {
    // Storage can be full or switched off; the match still ended.
  }
}

/** The robot played most, or null before the first match. */
export function favouriteRobot(stats: PlayerStats): string | null {
  const [best] = Object.entries(stats.robots).sort((a, b) => b[1] - a[1]);
  return best ? best[0] : null;
}
