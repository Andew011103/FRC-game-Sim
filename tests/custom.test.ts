import { beforeAll, describe, expect, it } from 'vitest';
import { newRobot, sanitizeRobot } from '../src/robots/custom';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testField, testRobot } from './helpers';

describe('custom robots', () => {
  beforeAll(() => initPhysics());

  it('rejects things that are not robots', () => {
    expect(sanitizeRobot(null)).toBeNull();
    expect(sanitizeRobot('robot')).toBeNull();
    expect(sanitizeRobot({ hello: 1 })).toBeNull();
  });

  it('clamps out-of-range values and is never official', () => {
    const robot = sanitizeRobot({
      id: 'swerve-shooter',
      name: '  Cheater  ',
      official: true,
      chassis: { length: 5, width: -1, height: 'tall', mass: 1 },
      drivetrain: { type: 'swerve', maxSpeed: 99, maxAccel: 99 },
      subsystems: [
        { type: 'shooter', speed: 500, rate: 9999 },
        { type: 'warp-drive' },
        { type: 'hopper', capacity: 12.6 },
      ],
    })!;
    expect(robot.official).toBe(false);
    expect(robot.id.startsWith('custom-')).toBe(true);
    expect(robot.name).toBe('Cheater');
    expect(robot.chassis.length).toBe(0.9);
    expect(robot.chassis.width).toBe(0.4);
    expect(robot.chassis.height).toBe(0.24);
    expect(robot.chassis.mass).toBe(20);
    expect(robot.drivetrain.maxSpeed).toBe(8);
    expect(robot.subsystems.map((s) => s.type)).toEqual(['shooter', 'hopper']);
    expect(robot.subsystems[0].speed).toBe(18);
    expect(robot.subsystems[1].capacity).toBe(13);
  });

  it('a copy of an official robot keeps its parts but becomes custom', () => {
    const copy = newRobot(testRobot('tank-hauler'));
    expect(copy.official).toBe(false);
    expect(copy.name).toBe('Tank Hauler copy');
    expect(copy.drivetrain.type).toBe('tank');
    expect(copy.subsystems.map((s) => s.type)).toEqual(testRobot('tank-hauler').subsystems.map((s) => s.type));
  });

  it('a brand new robot and extreme robots can all be driven', () => {
    const extremes = [
      newRobot(),
      sanitizeRobot({ chassis: { length: 0.4, width: 0.4, mass: 20 }, drivetrain: { type: 'tank', maxSpeed: 8 } })!,
      sanitizeRobot({ chassis: { length: 0.9, width: 0.9, mass: 70 }, drivetrain: { type: 'swerve', maxSpeed: 8 } })!,
    ];
    for (const def of extremes) {
      const sim = new SimWorld(testField());
      const robot = sim.addRobot(def);
      run(sim, input(), 0.5);
      run(sim, input({ driveY: 1 }), 1.5);
      expect(robot.position().x, def.name).toBeGreaterThan(-4.5);
      expect(Math.abs(robot.position().y - robot.rig.rideHeight), def.name).toBeLessThan(0.05);
      sim.dispose();
    }
  });
});
