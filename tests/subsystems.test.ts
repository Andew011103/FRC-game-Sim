import { beforeAll, describe, expect, it } from 'vitest';
import type { PieceGroup } from '../src/games/types';
import { OFFICIAL_ROBOTS } from '../src/robots';
import type { RobotDefinition } from '../src/robots/types';
import { SUBSYSTEM_SPECS } from '../src/sim/subsystems';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testField, testRobot } from './helpers';

function balls(positions: [number, number][]): PieceGroup[] {
  return [{ shape: 'ball', radius: 0.075, mass: 0.2, color: '#ffffff', positions }];
}

// The swerve robot's front bumper is at x = -5.57; this spot is just in front of it.
const IN_FRONT: [number, number] = [-5.45, 0];

describe('subsystems', () => {
  beforeAll(() => initPhysics());

  it('every built-in robot only uses known subsystem types', () => {
    for (const robot of OFFICIAL_ROBOTS) {
      for (const subsystem of robot.subsystems) {
        expect(SUBSYSTEM_SPECS[subsystem.type], `${robot.id}: ${subsystem.type}`).toBeDefined();
      }
    }
  });

  it('intake collects a ball only while the button is held', () => {
    const sim = new SimWorld(testField({ pieces: balls([IN_FRONT]) }));
    const robot = sim.addRobot(testRobot('swerve-shooter'));
    run(sim, input(), 0.5);
    expect(robot.held.length).toBe(0);
    run(sim, input({ intake: true }), 0.2);
    expect(robot.held).toEqual([0]);
    expect(sim.pieces.heldBy[0]).toBe(robot.index);
    sim.dispose();
  });

  it('intake stops when the hopper is full', () => {
    const base = testRobot('swerve-shooter');
    const small: RobotDefinition = {
      ...base,
      subsystems: [
        { type: 'intake', side: 'front', rate: 30 },
        { type: 'hopper', capacity: 1 },
      ],
    };
    const sim = new SimWorld(testField({ pieces: balls([IN_FRONT, [-5.45, 0.2]]) }));
    const robot = sim.addRobot(small);
    run(sim, input({ intake: true }), 0.5);
    expect(robot.held.length).toBe(1);
    sim.dispose();
  });

  it('turret shooter lands a shot on the target', () => {
    const target: [number, number, number] = [-2, 1.0, 1.5];
    const sim = new SimWorld(
      testField({ pieces: balls([[0, 3]]), targets: [{ alliance: 'blue', position: target }] }),
    );
    const robot = sim.addRobot(testRobot('swerve-shooter'));
    expect(robot.store(sim, 0)).toBe(true);
    run(sim, input(), 1);
    run(sim, input({ shoot: true }), 0.1);
    expect(robot.held.length).toBe(0);
    expect(sim.pieces.heldBy[0]).toBe(-1);

    let closest = Infinity;
    run(sim, input(), 2, () => {
      const p = sim.pieces.position(0);
      closest = Math.min(closest, Math.hypot(p.x - target[0], p.y - target[1], p.z - target[2]));
    });
    expect(closest).toBeLessThan(0.3);
    sim.dispose();
  });

  it('fixed shooter fires the way the robot faces', () => {
    const sim = new SimWorld(testField({ pieces: balls([[0, 3]]) }));
    const robot = sim.addRobot(testRobot('tank-hauler'));
    robot.store(sim, 0);
    run(sim, input(), 0.5);
    run(sim, input({ shoot: true }), 0.1);
    const velocity = sim.pieces.bodies[0].linvel();
    expect(velocity.x).toBeGreaterThan(3);
    expect(Math.abs(velocity.z)).toBeLessThan(0.6);
    sim.dispose();
  });

  it('expanding hopper changes capacity on each press', () => {
    const sim = new SimWorld(testField());
    const robot = sim.addRobot(testRobot('tank-hauler'));
    expect(robot.capacity()).toBe(30);
    // The hopper takes a moment to slide out, and only then holds more.
    run(sim, input({ deploy: true }), 0.2);
    expect(robot.capacity()).toBe(30);
    run(sim, input(), 0.5);
    expect(robot.capacity()).toBe(50);
    run(sim, input({ deploy: true }), 0.2);
    expect(robot.capacity()).toBe(30);
    sim.dispose();
  });

  it('blocker raises and lowers on each press', () => {
    const sim = new SimWorld(testField());
    const robot = sim.addRobot(testRobot('swerve-defender'));
    const blocker = robot.subsystems.find((subsystem) => subsystem.type === 'blocker')!;
    expect(blocker.deployed).toBe(false);
    run(sim, input({ block: true }), 0.2);
    expect(blocker.deployed).toBe(true);
    run(sim, input(), 0.1);
    run(sim, input({ block: true }), 0.2);
    expect(blocker.deployed).toBe(false);
    sim.dispose();
  });

  it('a raised blocker stops a shot', () => {
    const sim = new SimWorld(testField({ pieces: balls([[0, 3]]) }));
    sim.addRobot(testRobot('swerve-defender'));
    run(sim, input({ block: true }), 0.2);
    // Fire a ball straight at the raised panel from in front of the robot.
    sim.pieces.release(0, { x: -4.5, y: 0.6, z: 0 }, { x: -8, y: 0, z: 0 });
    run(sim, input(), 0.5);
    expect(sim.pieces.position(0).x).toBeGreaterThan(-5.7);
    sim.dispose();
  });
});
