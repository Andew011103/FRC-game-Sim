import { beforeAll, describe, expect, it } from 'vitest';
import { configuredGame } from '../src/games';
import { rebuilt2026 } from '../src/games/rebuilt-2026';

/** Without an outpost, so no human player throws fuel that a test is not counting. */
const noHumanPlayer = configuredGame('rebuilt-2026', { outpost: false });
import { hubX } from '../src/games/rebuilt-2026/field';
import type { GameDefinition, Spawn } from '../src/games/types';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testRobot } from './helpers';

function withSpawn(spawn: Partial<Spawn>): GameDefinition {
  return { ...rebuilt2026, spawns: [{ ...rebuilt2026.spawns[0], ...spawn }] };
}

/** Drops a loose ball into the blue hub from above. */
function dropInBlueHub(sim: SimWorld, piece: number): void {
  sim.pieces.release(piece, { x: hubX('blue'), y: 2.3, z: 0 }, { x: 0, y: 0, z: 0 });
}

describe('REBUILT', () => {
  beforeAll(() => initPhysics());

  it('stages about 500 fuel and preloads 8 into the robot', () => {
    const sim = new SimWorld(rebuilt2026);
    const robot = sim.addRobot(testRobot('swerve-shooter'));
    const loose = sim.pieces.heldBy.filter((holder) => holder === -1).length;
    const inOutposts = sim.pieces.heldBy.filter((holder) => holder === -3).length;
    // The middle and the depots on the floor; each outpost's 24 already inside it.
    expect(loose).toBe(408 + 48);
    expect(inOutposts).toBe(48);
    expect(robot.held.length).toBe(8);
    sim.dispose();
  });

  it('fuel stays put when nothing touches it', () => {
    const sim = new SimWorld(rebuilt2026);
    const before = sim.pieces.position(0);
    run(sim, input(), 2);
    const after = sim.pieces.position(0);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.02);
    sim.dispose();
  });

  it('scores fuel dropped into the hub and rolls it out toward mid-field', () => {
    const sim = new SimWorld(rebuilt2026, { mode: 'match' });
    dropInBlueHub(sim, 0);
    run(sim, input(), 1.5);
    expect(sim.match!.score('blue')).toBe(1);
    expect(sim.match!.points.blue['Auto fuel']).toBe(1);
    expect(sim.match!.score('red')).toBe(0);
    expect(sim.pieces.position(0).x).toBeGreaterThan(hubX('blue') + 0.6);
    sim.dispose();
  });

  it('fuel that lands within 3 seconds of a period ending counts for that period', () => {
    const sim = new SimWorld(noHumanPlayer, { mode: 'match' });
    // It leaves the hub about two seconds into the transition shift: this ball still counts as auto fuel.
    run(sim, input(), 21);
    dropInBlueHub(sim, 0);
    run(sim, input(), 1.6);
    expect(sim.match!.points.blue['Auto fuel']).toBe(1);
    // That makes blue the higher scorer in auto, so its hub is the one that goes dark first.
    run(sim, input(), 8);
    expect(sim.match!.phase.id).toBe('shift1');
    expect(sim.rules!.status(sim, 'blue').goalActive).toBe(false);

    // A late ball that is out of the hub two seconds into shift 1 still scores for blue, as if in the transition shift.
    dropInBlueHub(sim, 1);
    run(sim, input(), 1.6);
    expect(sim.match!.score('blue')).toBe(2);
    sim.dispose();
  });

  it('counts fuel as it leaves the hub, about half a second after it goes in', () => {
    const sim = new SimWorld(rebuilt2026, { mode: 'match' });
    // Placed just inside the hub, so it is taken in on the next step.
    sim.pieces.release(0, { x: hubX('blue'), y: 1.0, z: 0 }, { x: 0, y: 0, z: 0 });
    run(sim, input(), 0.4);
    expect(sim.match!.score('blue')).toBe(0);
    expect(sim.pieces.heldBy[0]).not.toBe(-1);
    run(sim, input(), 0.4);
    expect(sim.match!.score('blue')).toBe(1);
    expect(sim.pieces.heldBy[0]).toBe(-1);
    sim.dispose();
  });

  it('gives no points for fuel in an inactive hub', () => {
    const sim = new SimWorld(noHumanPlayer, { mode: 'match' });
    dropInBlueHub(sim, 0);
    // Blue outscored red in auto, so blue's hub is dark in shift 1.
    // Wait until shift 1's grace time is over, so the next ball counts for shift 1.
    run(sim, input(), 34);
    expect(sim.match!.phase.id).toBe('shift1');
    expect(sim.rules!.status(sim, 'blue').goalActive).toBe(false);
    expect(sim.rules!.status(sim, 'red').goalActive).toBe(true);
    dropInBlueHub(sim, 1);
    run(sim, input(), 1.5);
    expect(sim.match!.score('blue')).toBe(1);
    expect(sim.match!.counted('blue', 'inactiveFuel')).toBe(1);

    // In shift 2 it is active again.
    run(sim, input(), 25);
    expect(sim.match!.phase.id).toBe('shift2');
    dropInBlueHub(sim, 2);
    run(sim, input(), 1.5);
    expect(sim.match!.score('blue')).toBe(2);
    sim.dispose();
  });

  it('a full match lasts 2 minutes 40 seconds, then 3 more while the last shots are counted', () => {
    const sim = new SimWorld(noHumanPlayer, { mode: 'match' });
    const robot = sim.addRobot(testRobot('swerve-shooter'));
    // Simulates a whole match, which can take a while on a busy machine.
    run(sim, input(), 159.5);
    expect(sim.match!.finished).toBe(false);
    expect(sim.match!.phase.id).toBe('endgame');
    run(sim, input(), 1);
    expect(sim.match!.finished).toBe(false);
    expect(sim.match!.phase.id).toBe('assessment');
    expect(sim.match!.remaining).toBe(0);

    // A ball landing now still scores, but the robots no longer respond.
    dropInBlueHub(sim, 0);
    const before = robot.position().x;
    run(sim, input({ driveY: 1 }), 1.5);
    expect(sim.match!.score('blue')).toBe(1);
    expect(robot.position().x).toBeCloseTo(before, 1);
    run(sim, input(), 1.5);
    expect(sim.match!.finished).toBe(true);
    sim.dispose();
  }, 60000);

  it('free practice has no clock and the hub is always active', () => {
    const sim = new SimWorld(rebuilt2026);
    run(sim, input(), 40);
    expect(sim.match!.finished).toBe(false);
    expect(sim.rules!.status(sim, 'blue').goalActive).toBe(true);
    sim.dispose();
  });

  it('both drivetrains cross the bump', () => {
    for (const id of ['swerve-shooter', 'tank-hauler', 'swerve-defender']) {
      const sim = new SimWorld(rebuilt2026);
      const robot = sim.addRobot(testRobot(id));
      run(sim, input(), 0.3);
      run(sim, input({ driveY: 1 }), 2);
      expect(robot.position().x, id).toBeGreaterThan(-2.2);
      sim.dispose();
    }
  });

  it('a robot fits through the trench unless its blocker is up', () => {
    const lowered = new SimWorld(withSpawn({ x: -5.3, z: 3.39 }));
    const passing = lowered.addRobot(testRobot('swerve-defender'));
    run(lowered, input({ driveY: 1 }), 2);
    expect(passing.position().x).toBeGreaterThan(-2.5);
    lowered.dispose();

    const raised = new SimWorld(withSpawn({ x: -5.3, z: 3.39 }));
    const stuck = raised.addRobot(testRobot('swerve-defender'));
    run(raised, input({ block: true }), 0.2);
    run(raised, input({ driveY: 1 }), 2);
    expect(stuck.position().x).toBeLessThan(-3.6);
    raised.dispose();
  });

  it('climbers reach their top level and earn tower points', () => {
    const tower = rebuilt2026.towers!.find((t) => t.alliance === 'blue')!;
    const expected: Record<string, [number, number]> = {
      'tank-hauler': [1, 10],
      'swerve-shooter': [2, 20],
      'swerve-defender': [3, 30],
    };
    for (const [id, [level, points]] of Object.entries(expected)) {
      const sim = new SimWorld(withSpawn({ x: tower.x + 0.5, z: tower.z }), { mode: 'match' });
      const robot = sim.addRobot(testRobot(id));
      run(sim, input(), 125);
      expect(robot.climbLevel(), id).toBe(0);
      run(sim, input({ climbUp: true }), 5);
      expect(robot.climbLevel(), id).toBe(level);
      run(sim, input(), 34);
      expect(sim.match!.finished, id).toBe(true);
      expect(sim.match!.points.blue['Teleop tower'], id).toBe(points);
      sim.dispose();
    }
    // Simulates three whole matches, so it needs longer than the default limit.
  }, 60000);

  it('a level 1 climb in auto is worth 15, and the robot can come back down', () => {
    const tower = rebuilt2026.towers!.find((t) => t.alliance === 'blue')!;
    const sim = new SimWorld(withSpawn({ x: tower.x + 0.5, z: tower.z }), { mode: 'match' });
    const robot = sim.addRobot(testRobot('swerve-shooter'));
    run(sim, input({ climbUp: true }), 0.4);
    expect(robot.climbLevel()).toBe(1);
    run(sim, input(), 20);
    expect(sim.match!.points.blue['Auto tower']).toBe(15);

    run(sim, input({ climbDown: true }), 2);
    expect(robot.climbing).toBe(false);
    run(sim, input({ driveY: 1 }), 1);
    expect(robot.position().x).toBeGreaterThan(tower.x + 1.5);
    sim.dispose();
  });

  it('cannot climb away from the tower', () => {
    const sim = new SimWorld(rebuilt2026);
    const robot = sim.addRobot(testRobot('swerve-defender'));
    run(sim, input({ climbUp: true }), 2);
    expect(robot.climbing).toBe(false);
    sim.dispose();
  });
});

describe('match pauses', () => {
  beforeAll(() => initPhysics());

  it('counts down before the start and stands still for 3 seconds after auto', () => {
    const sim = new SimWorld(rebuilt2026, { mode: 'match', pauses: true });
    const robot = sim.addRobot(testRobot('swerve-shooter'));
    const start = robot.position().x;
    run(sim, input({ driveY: 1 }), 2.5);
    expect(sim.match!.holdReason).toBe('start');
    expect(sim.match!.elapsed).toBe(0);
    expect(Math.abs(robot.position().x - start)).toBeLessThan(0.02);
    run(sim, input(), 0.6 + 20);
    expect(sim.match!.phase.id).toBe('transition');
    expect(sim.match!.holdReason).toBe('pause');
    const remaining = sim.match!.remaining;
    run(sim, input({ driveY: 1 }), 2.5);
    expect(sim.match!.remaining).toBe(remaining);
    run(sim, input(), 1);
    expect(sim.match!.holding).toBe(false);
    expect(sim.match!.remaining).toBeLessThan(remaining);
    sim.dispose();
  });
});

describe('hub timing', () => {
  beforeAll(() => initPhysics());

  it('fuel shot just before a hub turns on counts if it leaves the hub once it is on', () => {
    const sim = new SimWorld(noHumanPlayer, { mode: 'match' });
    // Blue outscores red in auto, so blue's hub is dark in shift 1 (30 s to 55 s) and lit again in shift 2.
    dropInBlueHub(sim, 0);
    run(sim, input(), 54.7);
    expect(sim.match!.phase.id).toBe('shift1');
    expect(sim.rules!.status(sim, 'blue').goalActive).toBe(false);
    const before = sim.match!.score('blue');
    // In the air and in the hub as shift 1 ends; out of the hub, scored, once shift 2 has begun.
    dropInBlueHub(sim, 1);
    run(sim, input(), 1.5);
    expect(sim.match!.phase.id).toBe('shift2');
    expect(sim.match!.score('blue')).toBe(before + 1);
    sim.dispose();
  });

  it('fuel comes out of the back of the hub about 3 feet up, spread out', () => {
    const sim = new SimWorld(noHumanPlayer, { mode: 'match' });
    const heights: number[] = [];
    const sideways: number[] = [];
    for (let i = 0; i < 6; i++) {
      dropInBlueHub(sim, i);
      // Watch for it coming out: the first moment it is loose again after being taken in.
      let taken = false;
      for (let step = 0; step < 120; step++) {
        sim.step([]);
        if (sim.pieces.heldBy[i] !== -1) taken = true;
        else if (taken) {
          heights.push(sim.pieces.position(i).y);
          sideways.push(sim.pieces.bodies[i].linvel().z);
          break;
        }
      }
    }
    expect(heights).toHaveLength(6);
    for (const height of heights) expect(height).toBeGreaterThan(0.8);
    expect(Math.max(...sideways) - Math.min(...sideways)).toBeGreaterThan(0.2);
    sim.dispose();
  });
});
