import type { Alliance } from '../games/types';

/** One period of a match, such as autonomous or the end game. */
export interface Phase {
  id: string;
  label: string;
  /** Seconds. */
  duration: number;
  /** True for time added after the match clock has run out; it is not shown on the clock. */
  extra?: boolean;
  /** Seconds every robot stands still after this period, with the clock stopped, as after auto. */
  pauseAfter?: number;
}

/** Seconds of countdown before a timed match starts. */
export const COUNTDOWN_SECONDS = 3;

/** Why the robots are being held still: the countdown before the start, or the pause after a period. */
export type HoldReason = 'start' | 'pause';

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
  /** Points each robot scored itself, by its place in the world's robot list. */
  readonly solo: number[] = [];
  /** Fouls called so far, newest last: who committed each, whether it was major, and when (match seconds). */
  readonly fouls: { offender: Alliance; major: boolean; at: number }[] = [];
  /** Seconds left that the robots are held still with the clock stopped. */
  hold = 0;
  holdReason: HoldReason | null = null;

  constructor(
    phases: Phase[],
    readonly mode: MatchMode,
    /** Whether a timed match counts down 3, 2, 1 before it starts and stops after periods that ask for it, as a real match does. */
    private readonly pauses = false,
  ) {
    this.phases = mode === 'match' ? phases : PRACTICE_PHASES;
    if (mode === 'match' && pauses) {
      this.hold = COUNTDOWN_SECONDS;
      this.holdReason = 'start';
    }
  }

  /** Whether the robots are being held still right now. */
  get holding(): boolean {
    return this.hold > 0;
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

  /** Credits a robot with points it scored itself. The alliance's points are added separately. */
  addSolo(robotIndex: number, points: number): void {
    this.solo[robotIndex] = (this.solo[robotIndex] ?? 0) + points;
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
    if (this.hold > 0) {
      this.hold = Math.max(0, this.hold - dt);
      if (this.hold <= 1e-9) {
        this.hold = 0;
        this.holdReason = null;
      }
      return null;
    }
    this.elapsed += dt;
    this.phaseElapsed += dt;
    if (this.phaseElapsed < this.phase.duration - 1e-9) return null;

    const ended = this.phase;
    if (this.phaseIndex === this.phases.length - 1) {
      this.finished = true;
    } else {
      this.phaseIndex++;
      this.phaseElapsed = 0;
      if (ended.pauseAfter && this.pauses) {
        this.hold = ended.pauseAfter;
        this.holdReason = 'pause';
      }
    }
    return ended;
  }
}
