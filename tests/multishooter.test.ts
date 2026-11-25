import { beforeAll, describe, expect, it } from 'vitest';
import type { PieceGroup } from '../src/games/types';
import { sanitizeRobot } from '../src/robots/custom';
import { wrapAngle } from '../src/sim/math';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testField } from './helpers';

// The robot stands at (-6, 0) facing +X; the target is about 27 degrees to its right.
const TARGET: [number, number, number] = [-2, 1.0, 2];
const COUNT = 6;

function field() {
  const positions = Array.from({ length: COUNT }, (_, i): [number, number] => [4 + i * 0.3, 3]);
  const pieces: PieceGroup[] = [{ shape: 'ball', radius: 0.075, mass: 0.2, color: '#ffffff', positions }];
  return testField({ pieces, targets: [{ alliance: 'blue', position: TARGET }] });
}

/** Three fixed shooters angled 12 degrees apart, the middle one (or none) chosen to aim the robot. */
function threeShooters(middleAims: boolean) {
  const shooter = (z: number, yaw: number, aimsRobot = false) => ({
    type: 'shooter',
    z,
    yaw,
    aimsRobot,
    sizeX: 0.15,
    sizeZ: 0.15,
    autoRange: true,
    speed: 14,
    spread: 0,
    rate: 2,
  });
  return sanitizeRobot({
    chassis: {},
    drivetrain: { type: 'swerve' },
    subsystems: [{ type: 'hopper', capacity: 10 }, shooter(-0.2, 12), shooter(0, 0, middleAims), shooter(0.2, -12)],
  })!;
}

/** The directions, relative to the robot, that the pieces flew off in. */
function shotDirections(sim: SimWorld): number[] {
  const robot = sim.robots[0];
  const seen = new Map<number, number>();
  run(sim, input({ shoot: true }), 2, () => {
    const at = robot.position();
    for (let i = 0; i < COUNT; i++) {
      if (seen.has(i) || sim.pieces.heldBy[i] !== -1) continue;
      const p = sim.pieces.position(i);
      if (Math.hypot(p.x - at.x, p.z - at.z) < 1) continue;
      seen.set(i, wrapAngle(Math.atan2(-(p.z - at.z), p.x - at.x) - robot.heading()));
    }
  });
  return [...seen.values()];
}

describe('several fixed shooters', () => {
  beforeAll(() => initPhysics());

  it('turn the chosen one to the target, and all fire once it is lined up', () => {
    const sim = new SimWorld(field());
    const robot = sim.addRobot(threeShooters(true));
    for (let i = 0; i < COUNT; i++) robot.store(sim, i);
    run(sim, input(), 0.3);
    const directions = shotDirections(sim);
    expect(robot.held.length).toBe(0);
    // The middle shooter points at the target.
    const p = robot.position();
    const bearing = Math.atan2(-(TARGET[2] - p.z), TARGET[0] - p.x);
    expect(Math.abs(wrapAngle(robot.heading() - bearing))).toBeLessThan(0.08);
    // Shots left along all three shooters, 24 degrees from one side to the other.
    expect(Math.max(...directions) - Math.min(...directions)).toBeGreaterThan(0.35);
    sim.dispose();
  });

  it('with none chosen, the first leads', () => {
    const sim = new SimWorld(field());
    const robot = sim.addRobot(threeShooters(false));
    for (let i = 0; i < COUNT; i++) robot.store(sim, i);
    run(sim, input(), 0.3);
    const directions = shotDirections(sim);
    expect(robot.held.length).toBe(0);
    // The first shooter, 12 degrees to the left, is the one pointed at the target.
    const p = robot.position();
    const bearing = Math.atan2(-(TARGET[2] - p.z), TARGET[0] - p.x);
    expect(Math.abs(wrapAngle(robot.heading() + 12 * (Math.PI / 180) - bearing))).toBeLessThan(0.08);
    expect(Math.max(...directions) - Math.min(...directions)).toBeGreaterThan(0.35);
    sim.dispose();
  });
});
