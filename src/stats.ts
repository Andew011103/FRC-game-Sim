import type { Alliance } from './games/types';

// A player's record over the matches they have finished. Signed in, it is
// worked out from their account; otherwise it is kept in this browser.

const STORAGE_KEY = 'drive-practice.stats';

export interface PlayerStats {
  /** Multiplayer matches, and how they went. */
  matches: number;
  wins: number;
  losses: number;
  ties: number;
  /** Multiplayer: the best and the summed score of the player's own alliance. */
  bestScore: number;
  totalScore: number;
  /** Multiplayer: the points the player's own robot scored, summed, and how many matches recorded them. */
  soloTotal: number;
  soloMatches: number;
  /** Timed singleplayer matches finished, and the best score in one. */
  singleMatches: number;
  singleBest: number;
  /** Multiplayer: bonus ranking points earned (Energized, Supercharged, Traversal), summed. */
  bonusRp: number;
  /** Matches driven with each robot, of either kind, by the robot's name. */
  robots: Record<string, number>;
}

export const EMPTY_STATS: PlayerStats = {
  matches: 0,
  wins: 0,
  losses: 0,
  ties: 0,
  bestScore: 0,
  totalScore: 0,
  soloTotal: 0,
  soloMatches: 0,
  singleMatches: 0,
  singleBest: 0,
  bonusRp: 0,
  robots: {},
};

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

export function loadStats(): PlayerStats {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    const robots: Record<string, number> = {};
    for (const [name, played] of Object.entries((saved.robots ?? {}) as Record<string, unknown>)) {
      if (count(played) > 0) robots[name] = count(played);
    }
    const stats: PlayerStats = { ...EMPTY_STATS, robots };
    for (const key of Object.keys(EMPTY_STATS) as (keyof PlayerStats)[]) {
      if (key !== 'robots') stats[key] = count(saved[key]);
    }
    return stats;
  } catch {
    return { ...EMPTY_STATS, robots: {} };
  }
}

export interface FinishedMatch {
  alliance: Alliance;
  blue: number;
  red: number;
  robot: string;
  /** True for a timed singleplayer match, which has no winner. */
  single: boolean;
  /** Multiplayer: the points the player's own robot scored, or null where that was not recorded. */
  solo: number | null;
  /** Multiplayer: how many bonus ranking points the player's alliance earned; missing on older records. */
  bonusRp?: number;
}

/** A record with one more finished match added. */
export function withMatch(stats: PlayerStats, match: FinishedMatch): PlayerStats {
  const mine = match[match.alliance];
  const theirs = match[match.alliance === 'blue' ? 'red' : 'blue'];
  const robots = { ...stats.robots, [match.robot]: (stats.robots[match.robot] ?? 0) + 1 };
  if (match.single) {
    return { ...stats, robots, singleMatches: stats.singleMatches + 1, singleBest: Math.max(stats.singleBest, mine) };
  }
  return {
    ...stats,
    robots,
    matches: stats.matches + 1,
    wins: stats.wins + (mine > theirs ? 1 : 0),
    losses: stats.losses + (mine < theirs ? 1 : 0),
    ties: stats.ties + (mine === theirs ? 1 : 0),
    bestScore: Math.max(stats.bestScore, mine),
    totalScore: stats.totalScore + mine,
    soloTotal: stats.soloTotal + (match.solo ?? 0),
    soloMatches: stats.soloMatches + (match.solo === null ? 0 : 1),
    bonusRp: stats.bonusRp + Math.max(0, Math.min(3, Math.round(match.bonusRp ?? 0))),
  };
}

const SEASON_KEY = 'drive-practice.season';

/** This browser's record for a Drive Pass season: only matches played since it started. Empty in a new season. */
export function loadSeasonStats(season: string): PlayerStats {
  try {
    const saved = JSON.parse(localStorage.getItem(SEASON_KEY) ?? '{}') as { season?: string; stats?: Record<string, unknown> };
    if (saved.season !== season || !saved.stats) return { ...EMPTY_STATS, robots: {} };
    const stats: PlayerStats = { ...EMPTY_STATS, robots: {} };
    for (const key of Object.keys(EMPTY_STATS) as (keyof PlayerStats)[]) {
      if (key !== 'robots') stats[key] = count(saved.stats[key]);
    }
    return stats;
  } catch {
    return { ...EMPTY_STATS, robots: {} };
  }
}

/** Adds a match to this browser's record for the season. A new season starts a new record. */
export function recordSeasonMatch(match: FinishedMatch, season: string): void {
  try {
    localStorage.setItem(SEASON_KEY, JSON.stringify({ season, stats: withMatch(loadSeasonStats(season), match) }));
  } catch {
    // Not being able to save is harmless; the match is still on the full record.
  }
}

export function recordMatch(match: FinishedMatch): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withMatch(loadStats(), match)));
  } catch {
    // Storage can be full or switched off; the match still ended.
  }
}

/** The robots driven most, most first, with how many matches each. */
export function topRobots(stats: PlayerStats, most = 5): [string, number][] {
  return Object.entries(stats.robots)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, most);
}

/** The robot played most, or null before the first match. */
export function favouriteRobot(stats: PlayerStats): string | null {
  return topRobots(stats, 1)[0]?.[0] ?? null;
}
