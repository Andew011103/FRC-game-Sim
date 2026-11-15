import { beforeAll, describe, expect, it } from 'vitest';
import { grid } from '../src/games/shared';
import type { PieceGroup } from '../src/games/types';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testField, testRobot } from './helpers';

/** Drives straight for a while and reports how far the robot got and how fast it ended. */
function drive(robotId: string, fuel: [number, number][]): { distance: number; speed: number; lift: number; slowest: number } {
  const pieces: PieceGroup[] = [{ shape: 'ball', radius: 0.075, mass: 0.215, color: '#facc15', positions: fuel }];
  const sim = new SimWorld(testField({ pieces }));
  const robot = sim.addRobot(testRobot(robotId));
  const rest = robot.position().y;
  let lift = 0;
  let slowest = Infinity;
  let t = 0;
  run(sim, input({ driveY: 1 }), 1.6, () => {
    t += 1 / 60;
    lift = Math.max(lift, robot.position().y - rest);
    if (t > 1) slowest = Math.min(slowest, robot.speed());
  });
  const result = { distance: robot.position().x + 6, speed: robot.speed(), lift, slowest };
  sim.dispose();
  return result;
}

describe('pushing through fuel', () => {
  beforeAll(() => initPhysics());

  it('a block of fuel slows a robot only a little, and never lifts it', () => {
    // The whole mid-field block: 408 balls, about 88 kg in all, across the robot's path.
    const block = grid(-3, 0, 12, 34, 0.153);
    // Cheesy Poofs has no front bumper, so its bare frame edge meets the fuel.
    for (const id of ['cheesy-poofs', 'swerve-shooter', 'tank-hauler']) {
      const clear = drive(id, []);
      const blocked = drive(id, block);
      expect(blocked.distance / clear.distance, id).toBeGreaterThan(0.8);
      expect(blocked.lift, id).toBeLessThan(0.02);
    }
  });
});
