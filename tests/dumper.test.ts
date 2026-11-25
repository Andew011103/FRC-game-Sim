import { beforeAll, describe, expect, it } from 'vitest';
import type { PieceGroup } from '../src/games/types';
import { sanitizeRobot } from '../src/robots/custom';
import { robotTags } from '../src/robots/stats';
import type { RobotDefinition } from '../src/robots/types';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testField } from './helpers';

// The robot stands at (-6, 0) facing +X; the target is about 27 degrees to its right.
const TARGET: [number, number, number] = [-2, 1.0, 2];

function field() {
  const pieces: PieceGroup[] = [{ shape: 'ball', radius: 0.075, mass: 0.2, color: '#ffffff', positions: [[4, 3]] }];
  return testField({ pieces, targets: [{ alliance: 'blue', position: TARGET }] });
}

function dumper(shooter: Record<string, unknown>): RobotDefinition {
  return sanitizeRobot({
    chassis: {},
    drivetrain: { type: 'swerve' },
    subsystems: [
      { type: 'hopper', capacity: 10 },
      { type: 'shooter', autoRange: true, speed: 14, spread: 0, turret: true, ...shooter },
    ],
  })!;
}

function closestApproach(sim: SimWorld, drive: Partial<Parameters<typeof input>[0]> = {}): number {
  let closest = Infinity;
  run(sim, input(drive), 2.5, () => {
    if (sim.pieces.heldBy[0] !== -1) return;
    const p = sim.pieces.position(0);
    closest = Math.min(closest, Math.hypot(p.x - TARGET[0], p.y - TARGET[1], p.z - TARGET[2]));
  });
  return closest;
}

describe('turreted dumper', () => {
  beforeAll(() => initPhysics());

  it('aims with its own swing when the target is within it, leaving the robot alone', () => {
    const sim = new SimWorld(field());
    const robot = sim.addRobot(dumper({ turretRange: 80 }));
    robot.store(sim, 0);
    run(sim, input(), 0.3);
    expect(closestApproach(sim, { shoot: true })).toBeLessThan(0.4);
    expect(Math.abs(robot.heading())).toBeLessThan(0.05);
    sim.dispose();
  });

  it('turns the robot once the target is past its swing, then scores', () => {
    const sim = new SimWorld(field());
    const robot = sim.addRobot(dumper({ turretRange: 20 }));
    robot.store(sim, 0);
    run(sim, input(), 0.3);
    // Not lined up at first: it waits for the robot to come round.
    run(sim, input({ shoot: true }), 0.03);
    expect(robot.held.length).toBe(1);
    expect(closestApproach(sim, { shoot: true })).toBeLessThan(0.4);
    // The robot turned toward the target, but by less than the whole way: the swing covers the rest.
    expect(robot.heading()).toBeLessThan(-0.2);
    expect(robot.heading()).toBeGreaterThan(-0.47);
    sim.dispose();
  });

  it('leaves the turn stick to the driver while the target is within its swing', () => {
    const sim = new SimWorld(field());
    const robot = sim.addRobot(dumper({ turretRange: 180 }));
    run(sim, input({ turn: 1, shoot: true }), 0.3);
    expect(Math.abs(robot.heading())).toBeGreaterThan(0.3);
    sim.dispose();
  });

  it('shoots on the move', () => {
    const sim = new SimWorld(field());
    const robot = sim.addRobot(dumper({ turretRange: 60, moveAccuracy: 100 }));
    robot.store(sim, 0);
    run(sim, input({ driveY: 1 }), 0.5);
    expect(closestApproach(sim, { driveY: 1, shoot: true })).toBeLessThan(0.5);
    expect(robot.held.length).toBe(0);
    sim.dispose();
  });

  it('is tagged by how far its turret turns', () => {
    const tags = (shooter: Record<string, unknown>) => robotTags(dumper(shooter), 0);
    expect(tags({ turretRange: 50 })).toContain('Turreted dumper');
    expect(tags({ turretRange: 120 })).toContain('Limited turret');
    expect(tags({ turretRange: 120 })).not.toContain('Turreted dumper');
    expect(tags({})).toContain('Turret');
    expect(tags({})).not.toContain('Limited turret');
  });

  it('tags open tops, no passing, and the hand-set dual intake and double turret', () => {
    const robot = (extra: Partial<RobotDefinition>, shooter: Record<string, unknown> = {}) =>
      robotTags(
        sanitizeRobot({
          chassis: {},
          drivetrain: { type: 'swerve' },
          subsystems: [{ type: 'hopper', openTop: true }, { type: 'intake' }, { type: 'shooter', turret: true, ...shooter }],
          ...extra,
        })!,
        0,
      );
    expect(robot({})).toContain('Open top');
    expect(robot({})).not.toContain('No passing');
    expect(robot({}, { canPass: false })).toContain('No passing');
    expect(robot({})).not.toContain('Dual intake');
    expect(robot({ dualIntake: true })).toContain('Dual intake');
    expect(robot({ doubleTurret: true })).toContain('Double turret');
    expect(robot({ doubleTurret: true })).not.toContain('Turret');
  });
});
