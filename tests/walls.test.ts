import { beforeAll, describe, expect, it } from 'vitest';
import { findRobot } from '../src/robots';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testField } from './helpers';

/** How far a robot gets along the field in half a second, once moving, starting at (x, z) facing `yaw`. */
function progress(robotId: string, z: number, yaw: number, driveX: number): number {
  const sim = new SimWorld(testField({ spawns: [{ x: -6, z, yaw, alliance: 'blue' }] }));
  const robot = sim.addRobot(findRobot(robotId));
  run(sim, input({ driveY: 1, driveX }), 1.2);
  const from = robot.position().x;
  run(sim, input({ driveY: 1, driveX }), 0.5);
  const speed = (robot.position().x - from) / 0.5;
  sim.dispose();
  return speed;
}

describe('walls', () => {
  beforeAll(() => initPhysics());

  it('a swerve robot driving diagonally into a wall slides along it at most of its speed', () => {
    // The stick points 31 degrees into the side wall; along the wall that is 86% of full speed.
    const pressed = Math.max(progress('jack-in-the-bot', 3.5, 0, 0.6), progress('jack-in-the-bot', -3.5, 0, -0.6));
    const free = progress('jack-in-the-bot', 0, 0, 0);
    expect(pressed / free).toBeGreaterThan(0.55);
  });

  it('a tank drive angled into a wall scrapes along it instead of stopping', () => {
    // Pointed 10 degrees into the side wall, which it reaches almost at once.
    const angle = 0.17;
    const pressed = Math.min(progress('kitbot', 3.6, -angle, 0), progress('kitbot', -3.6, angle, 0));
    const free = progress('kitbot', 0, 0, 0);
    expect(pressed / free).toBeGreaterThan(0.6);
  });
});
