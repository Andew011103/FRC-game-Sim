import { beforeAll, describe, expect, it } from 'vitest';
import { configuredGame } from '../src/games';
import { hubX } from '../src/games/rebuilt-2026/field';
import { sanitizeRobot } from '../src/robots/custom';
import type { RobotDefinition } from '../src/robots/types';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run } from './helpers';

const rebuilt = (options: Record<string, unknown> = {}) => configuredGame('rebuilt-2026', options);
const plain = (extra: Record<string, unknown> = {}): RobotDefinition =>
  sanitizeRobot({ chassis: {}, drivetrain: { type: 'swerve' }, subsystems: [], ...extra })!;
const still = input();

/** Foul points an alliance is owed so far. They only reach the score when the match ends. */
const owedTo = (sim: SimWorld, alliance: 'blue' | 'red'): number =>
  sim.match!.fouls.filter((foul) => foul.offender !== alliance).reduce((sum, foul) => sum + (foul.major ? 15 : 5), 0);

describe('fouls', () => {
  beforeAll(() => initPhysics());

  it('only a robot with an open-top hopper is fouled for catching fuel leaving the hub before it lands', () => {
    const caught = (openTop: boolean) => {
      // Parked right where scored fuel comes out of the blue hub, with a wide hopper open on top.
      const sim = new SimWorld(rebuilt(), { mode: 'match' });
      const hopper = { type: 'hopper', capacity: 10, sizeX: 0.6, sizeZ: 0.7, sizeY: 0.4, bottom: 0.3, openTop };
      const robot = sim.addRobot(plain({ subsystems: [hopper] }), 0, { x: hubX('blue') + 1.1, z: 0, yaw: 0 });
      run(sim, still, 0.3);
      // It starts with its preload; only fuel caught on top counts here.
      const preload = robot.held.length;
      for (let i = 0; i < 6; i++) sim.pieces.release(i, { x: hubX('blue'), y: 2.3, z: 0 }, { x: 0, y: 0, z: 0 });
      run(sim, still, 3);
      const result = { held: robot.held.length - preload, owed: owedTo(sim, 'red') };
      sim.dispose();
      return result;
    };
    const open = caught(true);
    expect(open.held).toBeGreaterThan(0);
    expect(open.owed).toBeGreaterThanOrEqual(5);
    // Without an open top, fuel bouncing off the robot is never a foul.
    expect(caught(false)).toEqual({ held: 0, owed: 0 });
  });

  it('with fouls switched off nothing is charged', () => {
    const sim = new SimWorld(rebuilt({ fouls: false }), { mode: 'match' });
    sim.addRobot(plain(), 0, { x: hubX('blue') + 1.0, z: 0, yaw: 0 });
    run(sim, still, 0.3);
    sim.pieces.release(0, { x: hubX('blue'), y: 2.3, z: 0 }, { x: 0, y: 0, z: 0 });
    run(sim, still, 1.5);
    expect(owedTo(sim, 'red')).toBe(0);
    sim.dispose();
  });

  it('in auto, hitting an opponent after fully crossing the centre line is a major foul', () => {
    const sim = new SimWorld(rebuilt(), { mode: 'match' });
    // Blue starts wholly on the red half, clear of the fuel in the middle, and drives into a red robot.
    sim.addRobot(plain(), 0, { x: 1.3, z: 2.5, yaw: 0 });
    sim.addRobot(plain(), 1, { x: 2.5, z: 2.5, yaw: Math.PI });
    run(sim, input({ driveY: 1 }), 1);
    expect(owedTo(sim, 'red')).toBe(15);
    expect(owedTo(sim, 'blue')).toBe(0);
    sim.dispose();
  });

  it('pinning an opponent against the wall is a minor after 3 seconds, then a major every 3 more', () => {
    const sim = new SimWorld(rebuilt(), { mode: 'practice' });
    // Red sits against the side wall in mid-field; blue pushes it there and holds.
    sim.addRobot(plain(), 0, { x: 2.0, z: 2.6, yaw: Math.PI / 2 });
    sim.addRobot(plain(), 1, { x: 2.0, z: 3.55, yaw: Math.PI / 2 });
    const push = input({ driveX: 1 });
    run(sim, push, 2.5);
    expect(owedTo(sim, 'red')).toBe(0);
    run(sim, push, 1.5);
    expect(owedTo(sim, 'red')).toBe(5);
    run(sim, push, 3);
    expect(owedTo(sim, 'red')).toBe(20);
    sim.dispose();
  });

  it('foul points are only added to the score once the match is over', () => {
    const sim = new SimWorld(rebuilt(), { mode: 'match' });
    // Clear of the trench's block, so the robot bumped into is not then pinned against it.
    sim.addRobot(plain(), 0, { x: 0.9, z: 2.5, yaw: 0 });
    sim.addRobot(plain(), 1, { x: 2.1, z: 2.5, yaw: Math.PI });
    run(sim, input({ driveY: 1 }), 1);
    expect(owedTo(sim, 'red')).toBe(15);
    expect(sim.match!.fouls.at(-1)).toMatchObject({ offender: 'blue', major: true });
    expect(sim.match!.points.red['Opponent fouls']).toBeUndefined();
    while (!sim.match!.finished) sim.step([]);
    expect(sim.match!.points.red['Opponent fouls']).toBe(15);
    sim.dispose();
  });

  it('a robot labelled trench goes under the bar whatever its height, and one labelled bump never does', () => {
    const attempt = (traversal: string, sizeY: number): number => {
      const sim = new SimWorld(rebuilt());
      const robot = sim.addRobot(
        plain({ traversal, subsystems: [{ type: 'hopper', sizeY }] }),
        0,
        { x: -5.3, z: 3.39, yaw: 0 },
      );
      run(sim, input({ driveY: 1 }), 2);
      const x = robot.position().x;
      sim.dispose();
      return x;
    };
    expect(attempt('trench', 0.7)).toBeGreaterThan(-2.5);
    expect(attempt('bump', 0.1)).toBeLessThan(-3.6);
    expect(attempt('auto', 0.1)).toBeGreaterThan(-2.5);
    expect(attempt('auto', 0.7)).toBeLessThan(-3.6);
  });
});
