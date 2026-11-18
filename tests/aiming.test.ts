import { beforeAll, describe, expect, it } from 'vitest';
import type { PieceGroup } from '../src/games/types';
import { sanitizeRobot } from '../src/robots/custom';
import type { RobotDefinition } from '../src/robots/types';
import { quatFromEuler, wrapAngle } from '../src/sim/math';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testField, testRobot } from './helpers';

const TARGET: [number, number, number] = [-2, 1.0, 2];

function field(count = 1) {
  const positions = Array.from({ length: count }, (_, i): [number, number] => [4 + i * 0.3, 3]);
  const pieces: PieceGroup[] = [{ shape: 'ball', radius: 0.075, mass: 0.2, color: '#ffffff', positions }];
  return testField({ pieces, targets: [{ alliance: 'blue', position: TARGET }] });
}

/** A swerve robot with a hopper and one shooter. It stands at (-6, 0) facing +X. */
function shooterBot(shooter: Record<string, unknown>): RobotDefinition {
  return sanitizeRobot({
    chassis: {},
    drivetrain: { type: 'swerve' },
    subsystems: [
      { type: 'hopper', capacity: 10 },
      { type: 'shooter', autoRange: true, speed: 14, spread: 0, ...shooter },
    ],
  })!;
}

/** Closest any of the first `count` pieces gets to the target over the next few seconds. */
function closestApproach(sim: SimWorld, drive: Partial<Parameters<typeof input>[0]> = {}, count = 1): number {
  let closest = Infinity;
  run(sim, input(drive), 2.5, () => {
    for (let i = 0; i < count; i++) {
      if (sim.pieces.heldBy[i] !== -1) continue;
      const p = sim.pieces.position(i);
      closest = Math.min(closest, Math.hypot(p.x - TARGET[0], p.y - TARGET[1], p.z - TARGET[2]));
    }
  });
  return closest;
}

describe('aiming', () => {
  beforeAll(() => initPhysics());

  it('a shooter that corrects for tilt still scores from a leaning robot', () => {
    const miss = (tiltCorrection: boolean): number => {
      // The target is straight ahead of the robot, which leans 15 degrees to one side.
      const ahead: [number, number, number] = [-2, 1.0, 0];
      const pieces: PieceGroup[] = [{ shape: 'ball', radius: 0.075, mass: 0.2, color: '#ffffff', positions: [[4, 3]] }];
      const sim = new SimWorld(testField({ pieces, targets: [{ alliance: 'blue', position: ahead }] }));
      const robot = sim.addRobot(shooterBot({ tiltCorrection }));
      robot.autoAim = false;
      robot.store(sim, 0);
      const at = robot.position();
      const lean = quatFromEuler(0.26, 0, 0);
      let closest = Infinity;
      robot.body.setRotation(lean, true);
      run(sim, input({ shoot: true }), 2.5, () => {
        robot.body.setTranslation(at, true);
        robot.body.setRotation(lean, true);
        robot.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        robot.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        if (sim.pieces.heldBy[0] !== -1) return;
        const p = sim.pieces.position(0);
        closest = Math.min(closest, Math.hypot(p.x - ahead[0], p.y - ahead[1], p.z - ahead[2]));
      });
      sim.dispose();
      return closest;
    };
    expect(miss(true)).toBeLessThan(0.25);
    expect(miss(false)).toBeGreaterThan(0.6);
  });

  it('a fixed shooter turns its marked face to the target before firing', () => {
    const sim = new SimWorld(field());
    const robot = sim.addRobot(shooterBot({ face: 'back' }));
    robot.store(sim, 0);
    run(sim, input(), 0.3);
    // Facing away from the target, it must not fire on the first step.
    run(sim, input({ shoot: true }), 0.05);
    expect(robot.held.length).toBe(1);
    run(sim, input({ shoot: true }), 1.5);
    expect(robot.held.length).toBe(0);

    const p = robot.position();
    const bearing = Math.atan2(-(TARGET[2] - p.z), TARGET[0] - p.x);
    expect(Math.abs(wrapAngle(robot.heading() - (bearing + Math.PI)))).toBeLessThan(0.1);
    sim.dispose();
  });

  it('a fixed shooter lands its shot after turning', () => {
    const sim = new SimWorld(field());
    const robot = sim.addRobot(shooterBot({ face: 'left' }));
    robot.store(sim, 0);
    run(sim, input(), 0.3);
    expect(closestApproach(sim, { shoot: true })).toBeLessThan(0.35);
    sim.dispose();
  });

  it('the driver keeps the turn stick when not shooting', () => {
    const sim = new SimWorld(field());
    const robot = sim.addRobot(shooterBot({}));
    run(sim, input({ turn: 1 }), 0.5);
    expect(Math.abs(robot.heading())).toBeGreaterThan(0.5);
    sim.dispose();
  });

  it('Shoot on the Move decides whether a shot fired while driving lands', () => {
    const miss = (moveAccuracy: number, turret: boolean): number => {
      const sim = new SimWorld(field());
      const robot = sim.addRobot(shooterBot({ turret, moveAccuracy }));
      robot.store(sim, 0);
      // Drive along the field past the target, shooting once up to speed.
      run(sim, input({ driveY: 1 }), 0.5);
      expect(robot.speed()).toBeGreaterThan(1.5);
      const closest = closestApproach(sim, { driveY: 1, shoot: true });
      expect(robot.held.length, `${moveAccuracy}% turret=${turret}`).toBe(0);
      sim.dispose();
      return closest;
    };
    for (const turret of [true, false]) {
      // Turning a whole robot is slower than turning a turret, so it is allowed a wider miss.
      expect(miss(100, turret), `100% turret=${turret}`).toBeLessThan(turret ? 0.4 : 0.6);
      expect(miss(0, turret), `0% turret=${turret}`).toBeGreaterThan(0.8);
    }
  });

  it('a wide shooter fires a row of pieces, one lane after another', () => {
    const sim = new SimWorld(field(4));
    const robot = sim.addRobot(shooterBot({ lanes: 4, rate: 4, sizeZ: 0.6, sizeX: 0.2, turret: true }));
    for (let i = 0; i < 4; i++) robot.store(sim, i);
    run(sim, input(), 0.5);
    // At 4 per second in each lane, the lanes take turns a sixteenth of a second apart.
    sim.step([input({ shoot: true })]);
    expect(robot.held.length).toBe(3);
    run(sim, input({ shoot: true }), 0.1);
    expect(robot.held.length).toBeGreaterThan(0);
    run(sim, input({ shoot: true }), 0.1);
    expect(robot.held.length).toBe(0);

    // The four pieces travel side by side, 0.15 apart across the box.
    const heading = robot.heading();
    const bearing = Math.atan2(-(TARGET[2] - robot.position().z), TARGET[0] - robot.position().x);
    const across = [0, 1, 2, 3].map((i) => {
      const p = sim.pieces.position(i);
      const dx = p.x - robot.position().x;
      const dz = p.z - robot.position().z;
      return dx * Math.sin(bearing) + dz * Math.cos(bearing);
    });
    across.sort((a, b) => a - b);
    expect(heading).toBeCloseTo(0, 1);
    expect(across[3] - across[0]).toBeCloseTo(0.45, 1);
    expect(closestApproach(sim, {}, 4)).toBeLessThan(0.4);
    sim.dispose();
  });

  it('an older aim direction becomes a face plus the angle left over', () => {
    const robot = sanitizeRobot(testRobot('tank-hauler'))!;
    const shooter = robot.subsystems.find((subsystem) => subsystem.type === 'shooter')!;
    expect(shooter.face).toBe('front');
    const converted = sanitizeRobot({
      chassis: {},
      drivetrain: { type: 'swerve' },
      subsystems: [{ type: 'shooter', yaw: 170 }],
    })!;
    expect(converted.subsystems[0].face).toBe('back');
    expect(converted.subsystems[0].yaw).toBeCloseTo(-10);
  });
});

describe('ranged launch', () => {
  it("uses the shooter's angle when it can, and flattens only for shots too far for it", async () => {
    const { launchFor } = await import('../src/sim/subsystems/shooter');
    const deg = Math.PI / 180;
    const near = launchFor(3, 1.2, 75 * deg, 9);
    expect(near.pitch).toBeCloseTo(75 * deg, 6);
    expect(near.speed).toBeLessThan(9);
    const far = launchFor(6, 1.2, 75 * deg, 9);
    expect(far.pitch).toBeLessThan(70 * deg);
    expect(far.pitch).toBeGreaterThan(45 * deg);
    expect(far.speed).toBeLessThanOrEqual(9);
    // Never steeper than the shooter's own angle.
    for (const distance of [1, 2, 4, 8, 12]) expect(launchFor(distance, 1.2, 50 * deg, 12).pitch).toBeLessThanOrEqual(50 * deg + 1e-9);
  });
});
