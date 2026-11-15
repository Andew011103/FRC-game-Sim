import { beforeAll, describe, expect, it } from 'vitest';
import type { PieceGroup } from '../src/games/types';
import { sanitizeRobot } from '../src/robots/custom';
import type { RobotDefinition } from '../src/robots/types';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testField, testRobot } from './helpers';

function balls(positions: [number, number][]): PieceGroup[] {
  return [{ shape: 'ball', radius: 0.075, mass: 0.2, color: '#ffffff', positions }];
}

/** A custom robot with the given subsystems and chassis settings. The test robot stands at (-6, 0) facing +X. */
function build(subsystems: RobotDefinition['subsystems'], chassis: Record<string, unknown> = {}): RobotDefinition {
  return sanitizeRobot({ chassis, drivetrain: { type: 'swerve' }, subsystems })!;
}

describe('free-form subsystems and chassis', () => {
  beforeAll(() => initPhysics());

  it('older robot files are converted to the same layout', () => {
    const robot = sanitizeRobot(testRobot('tank-hauler'))!;
    const [intake, hopper, shooter] = robot.subsystems;
    // Frame is 0.8 long with 0.08 bumpers, so the intake starts at the bumper face, 0.48 from the centre.
    expect((intake.x as number) - (intake.sizeX as number) / 2).toBeCloseTo(0.48);
    expect(intake.sizeZ).toBeCloseTo(0.66);
    // The shooter's top is its old release height.
    expect((shooter.bottom as number) + (shooter.sizeY as number)).toBeCloseTo(0.55);
    // The hopper still ends 0.25 past the back bumper when expanded.
    expect(hopper.expandDirection).toBe('back');
    expect((hopper.sizeX as number) / 2 + (hopper.expandDistance as number)).toBeCloseTo(0.48 + 0.25);
    expect(robot.chassis.bumperLeft).toBe(0.08);
  });

  it('an intake box collects only what touches it, wherever it is placed', () => {
    const def = build([
      { type: 'intake', x: 0, z: -0.6, sizeX: 0.5, sizeZ: 0.2, bottom: 0, sizeY: 0.2, rate: 30 },
      { type: 'hopper', capacity: 5 },
    ]);
    // Ball 0 is to the robot's left (inside the box); ball 1 is in front of it.
    const sim = new SimWorld(testField({ pieces: balls([[-6, -0.6], [-5.45, 0]]) }));
    const robot = sim.addRobot(def);
    run(sim, input({ intake: true }), 0.5);
    expect(robot.held).toEqual([0]);
    sim.dispose();
  });

  it('a hopper can expand upward', () => {
    const def = build([
      { type: 'hopper', capacity: 10, expandable: true, expandDirection: 'up', expandDistance: 0.4, expandedCapacity: 30 },
    ]);
    const sim = new SimWorld(testField());
    const robot = sim.addRobot(def);
    const [bin, extension] = robot.subsystems[0].parts;
    // Part way out it is visibly shorter and does not hold more yet.
    run(sim, input({ deploy: true }), 0.2);
    expect(robot.capacity()).toBe(10);
    expect(extension.visible).toBe(true);
    expect(extension.size[1]).toBeGreaterThan(0.1);
    expect(extension.size[1]).toBeLessThan(0.3);
    run(sim, input(), 0.4);
    expect(robot.capacity()).toBe(30);
    expect(extension.size).toEqual([bin.size[0], 0.4, bin.size[2]]);
    expect(extension.position.y).toBeCloseTo(bin.position.y + bin.size[1] / 2 + 0.2);
    sim.dispose();
  });

  it('a blocker reshaped and moved to the back stops a shot from behind', () => {
    const def = build([
      { type: 'blocker', x: -0.3, z: 0, sizeX: 0.03, sizeZ: 0.7, bottom: 0.31, sizeY: 0.8, deployable: false },
    ]);
    const sim = new SimWorld(testField({ pieces: balls([[0, 3]]) }));
    sim.addRobot(def);
    run(sim, input(), 0.2);
    sim.pieces.release(0, { x: -7.2, y: 0.7, z: 0 }, { x: 8, y: 0, z: 0 });
    run(sim, input(), 0.4);
    expect(sim.pieces.position(0).x).toBeLessThan(-6.2);
    sim.dispose();
  });

  it('a longer bumper on one side keeps things further away on that side only', () => {
    const def = build([], { length: 0.7, bumperFront: 0.3, bumperBack: 0 });
    expect(def.chassis.bumperFront).toBe(0.3);
    expect(def.chassis.bumperBack).toBe(0);
    // Roll one ball at the front and one at the back; each stops against the robot's edge.
    const sim = new SimWorld(testField({ pieces: balls([[-4.5, 0], [-7.5, 0]]) }));
    sim.addRobot(def);
    run(sim, input(), 0.3);
    sim.pieces.bodies[0].setLinvel({ x: -2, y: 0, z: 0 }, true);
    sim.pieces.bodies[1].setLinvel({ x: 2, y: 0, z: 0 }, true);
    let nearestFront = Infinity;
    let nearestBack = Infinity;
    run(sim, input(), 1.2, () => {
      nearestFront = Math.min(nearestFront, sim.pieces.position(0).x + 6);
      nearestBack = Math.min(nearestBack, -6 - sim.pieces.position(1).x);
    });
    // Front edge is 0.35 + 0.3 from the centre, back edge 0.35; add the ball's radius.
    expect(nearestFront).toBeGreaterThan(0.65 + 0.06);
    expect(nearestBack).toBeGreaterThan(0.35 + 0.06);
    expect(nearestBack).toBeLessThan(0.55);
    sim.dispose();
  });
});
