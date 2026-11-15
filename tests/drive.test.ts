import { beforeAll, describe, expect, it } from 'vitest';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testField, testRobot } from './helpers';

const STOP = input();
const FORWARD = input({ driveY: 1 });

describe('driving', () => {
  beforeAll(() => initPhysics());

  it('rests at ride height without drifting', () => {
    const sim = new SimWorld(testField());
    const robot = sim.addRobot(testRobot('swerve-shooter'));
    run(sim, STOP, 2);
    expect(robot.position().y).toBeCloseTo(robot.rig.rideHeight, 2);
    expect(robot.speed()).toBeLessThan(0.02);
    expect(robot.position().x).toBeCloseTo(-6, 2);
    sim.dispose();
  });

  it('swerve reaches top speed driving away from the driver', () => {
    const sim = new SimWorld(testField());
    const def = testRobot('swerve-shooter');
    const robot = sim.addRobot(def);
    run(sim, STOP, 0.5);
    run(sim, FORWARD, 1.5);
    expect(robot.speed()).toBeGreaterThan(def.drivetrain.maxSpeed * 0.9);
    expect(robot.speed()).toBeLessThan(def.drivetrain.maxSpeed * 1.05);
    expect(robot.position().x).toBeGreaterThan(-3);
    expect(Math.abs(robot.position().z)).toBeLessThan(0.05);
    sim.dispose();
  });

  it('swerve strafes right without turning', () => {
    const sim = new SimWorld(testField());
    const robot = sim.addRobot(testRobot('swerve-shooter'));
    run(sim, STOP, 0.5);
    run(sim, input({ driveX: 1 }), 0.6);
    expect(robot.position().z).toBeGreaterThan(0.5);
    expect(Math.abs(robot.heading())).toBeLessThan(0.02);
    sim.dispose();
  });

  it('swerve stops quickly when the sticks are released', () => {
    const sim = new SimWorld(testField());
    const robot = sim.addRobot(testRobot('swerve-shooter'));
    run(sim, FORWARD, 1);
    run(sim, STOP, 1);
    expect(robot.speed()).toBeLessThan(0.05);
    sim.dispose();
  });

  it('positive turn spins both drivetrains clockwise', () => {
    for (const id of ['swerve-shooter', 'tank-hauler']) {
      const sim = new SimWorld(testField());
      const robot = sim.addRobot(testRobot(id));
      run(sim, STOP, 0.5);
      run(sim, input({ turn: 1 }), 1);
      expect(robot.body.angvel().y, id).toBeLessThan(-1);
      expect(robot.speed(), id).toBeLessThan(0.3);
      sim.dispose();
    }
  });

  it('tank drives forward and cannot strafe', () => {
    const sim = new SimWorld(testField());
    const def = testRobot('tank-hauler');
    const robot = sim.addRobot(def);
    run(sim, STOP, 0.5);
    run(sim, FORWARD, 1.5);
    expect(robot.speed()).toBeGreaterThan(def.drivetrain.maxSpeed * 0.85);
    expect(Math.abs(robot.position().z)).toBeLessThan(0.05);
    sim.dispose();
  });
});
