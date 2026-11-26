import { beforeAll, describe, expect, it } from 'vitest';
import type { PieceGroup } from '../src/games/types';
import { sanitizeRobot } from '../src/robots/custom';
import { robotStats } from '../src/robots/stats';
import { averageRate } from '../src/sim/subsystems/shooter';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testField } from './helpers';

const COUNT = 80;

function field() {
  const positions = Array.from({ length: COUNT }, (_, i): [number, number] => [2 + (i % 10) * 0.3, -3 + Math.floor(i / 10) * 0.3]);
  const pieces: PieceGroup[] = [{ shape: 'ball', radius: 0.075, mass: 0.2, color: '#ffffff', positions }];
  return testField({ pieces, targets: [{ alliance: 'blue', position: [-2, 1, 0] }] });
}

const indexer = { burst: true, rate: 2, burstRate: 20, burstFrequency: 1, burstLength: 0.5 };

function burstBot(shooter: Record<string, unknown>) {
  return sanitizeRobot({
    chassis: {},
    drivetrain: { type: 'swerve' },
    subsystems: [
      { type: 'hopper', capacity: 100 },
      { type: 'shooter', autoRange: true, speed: 14, spread: 0, timingJitter: 0, ...shooter },
    ],
  })!;
}

/** The gaps between shots over `seconds` of holding shoot. */
function shotGaps(shooter: Record<string, unknown>, seconds: number): number[] {
  const sim = new SimWorld(field(), { seed: 3 });
  const robot = sim.addRobot(burstBot(shooter));
  for (let i = 0; i < COUNT; i++) robot.store(sim, i);
  run(sim, input(), 0.3);
  const times: number[] = [];
  let held = robot.held.length;
  let clock = 0;
  run(sim, input({ shoot: true }), seconds, () => {
    clock += 1 / 60;
    for (; held > robot.held.length; held--) times.push(clock);
  });
  sim.dispose();
  return times.slice(1).map((time, i) => time - times[i]);
}

describe('burst fire', () => {
  beforeAll(() => initPhysics());

  it('fires most shots at its usual rate, with random bursts at the burst rate', () => {
    const gaps = shotGaps(indexer, 20);
    const fast = gaps.filter((gap) => gap < 0.09);
    const slow = gaps.filter((gap) => gap > 0.4);
    // Bursts at 20 a second come at least a few times, and the usual half-second gaps still come too.
    expect(fast.length).toBeGreaterThan(5);
    expect(slow.length).toBeGreaterThan(5);
  });

  it('averages out to the share of time spent in bursts', () => {
    // One burst a second, half a second long: a third of the time at 20, the rest at 2.
    expect(averageRate(indexer)).toBeCloseTo(2 * (2 / 3) + 20 * (1 / 3), 5);
    expect(averageRate({ ...indexer, burst: false })).toBe(2);
    const fireRate = robotStats(burstBot(indexer)).find((stat) => stat.label === 'Fire rate')!;
    expect(fireRate.text).toBe('8.0 per s');
  });

  it('without bursts, fires evenly at its usual rate', () => {
    const gaps = shotGaps({ ...indexer, burst: false }, 6);
    expect(gaps.every((gap) => Math.abs(gap - 0.5) < 0.04)).toBe(true);
  });
});
