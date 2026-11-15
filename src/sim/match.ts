import type { Alliance } from '../games/types';

/** One period of a match, such as autonomous or the end game. */
export interface Phase {
  id: string;
  label: string;
  /** Seconds. */
  duration: number;
  /** True for time added after the match clock has run out; it is not shown on the clock. */
  extra?: boolean;
}

/** 'practice' has no clock; 'match' runs the game's full timeline once. */
export type MatchMode = 'practice' | 'match';

const PRACTICE_PHASES: Phase[] = [{ id: 'practice', label: 'Free practice', duration: Infinity }];

/** The clock and the score for one match. */
export class Match {
  readonly phases: Phase[];
  elapsed = 0;
  phaseIndex = 0;
  phaseElapsed = 0;
  finished = false;
  /** Points by alliance, then by category (for example "Teleop fuel"). */
  readonly points: Record<Alliance, Record<string, number>> = { blue: {}, red: {} };
  /** Things counted but not directly worth points (for example fuel scored). */
  readonly counts: Record<Alliance, Record<string, number>> = { blue: {}, red: {} };

  constructor(
    phases: Phase[],
    readonly mode: MatchMode,
  ) {
    this.phases = mode === 'match' ? phases : PRACTICE_PHASES;
  }

  get phase(): Phase {
    return this.phases[this.phaseIndex];
  }

  /** Seconds left in the current period. */
  get phaseRemaining(): number {
    return Math.max(0, this.phase.duration - this.phaseElapsed);
  }

  /** Seconds left in the whole match. */
  get remaining(): number {
    if (this.phase.extra) return 0;
    let total = this.phaseRemaining;
    for (let i = this.phaseIndex + 1; i < this.phases.length; i++) {
      if (!this.phases[i].extra) total += this.phases[i].duration;
    }
    return total;
  }

  score(alliance: Alliance): number {
    return Object.values(this.points[alliance]).reduce((sum, value) => sum + value, 0);
  }

  addPoints(alliance: Alliance, category: string, points: number): void {
    this.points[alliance][category] = (this.points[alliance][category] ?? 0) + points;
  }

  count(alliance: Alliance, key: string, amount = 1): void {
    this.counts[alliance][key] = (this.counts[alliance][key] ?? 0) + amount;
  }

  counted(alliance: Alliance, key: string): number {
    return this.counts[alliance][key] ?? 0;
  }

  /** Moves the clock on. Returns the period that just finished, if one did. */
  advance(dt: number): Phase | null {
    if (this.finished) return null;
    this.elapsed += dt;
    this.phaseElapsed += dt;
    if (this.phaseElapsed < this.phase.duration - 1e-9) return null;

    const ended = this.phase;
    if (this.phaseIndex === this.phases.length - 1) {
      this.finished = true;
    } else {
      this.phaseIndex++;
      this.phaseElapsed = 0;
    }
    return ended;
  }
}
