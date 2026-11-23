import { beforeAll, describe, expect, it } from 'vitest';
import { sanitizeRobot } from '../src/robots/custom';
import { bumperOutline, frameOutline, hasShapedCorners } from '../src/robots/outline';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testField } from './helpers';

const shaped = (chassis: Record<string, unknown>) =>
  sanitizeRobot({ chassis: { length: 0.7, width: 0.7, bumperThickness: 0.08, ...chassis }, drivetrain: { type: 'swerve' }, subsystems: [] })!;

describe('frames with cut corners', () => {
  beforeAll(() => initPhysics());

  it('chamfers each corner by its own amount, and the bumpers follow round them', () => {
    const def = shaped({ cornerFL: 0.15, cornerFR: 0.15, cornerBL: 0.05 });
    expect(hasShapedCorners(def.chassis)).toBe(true);
    const frame = frameOutline(def.chassis);
    // Three cut corners make two points each; the square one makes one.
    expect(frame).toHaveLength(7);
    expect(frame).toContainEqual({ x: 0.35, z: -0.35 + 0.15 });
    expect(frame).toContainEqual({ x: 0.35 - 0.15, z: -0.35 });
    // The bumper's front edge is the front bumper's thickness out; its chamfer is parallel to the frame's.
    const bumper = bumperOutline(def.chassis);
    expect(Math.max(...bumper.map((p) => p.x))).toBeCloseTo(0.35 + 0.08);
    expect(Math.max(...bumper.map((p) => p.z))).toBeCloseTo(0.35 + 0.08);
    // A plain robot is unaffected.
    expect(hasShapedCorners(shaped({}).chassis)).toBe(false);
  });

  it('rounds corners into arcs, and keeps the wheels inside the cut corners', () => {
    const def = shaped({ cornerStyle: 'round', cornerFL: 0.2, cornerFR: 0.2, cornerBL: 0.2, cornerBR: 0.2 });
    const frame = frameOutline(def.chassis);
    // Every point of a rounded corner is on the circle tangent to both sides.
    const arc = frame.filter((p) => p.x > 0.15 + 1e-6 && p.z > 0.15 + 1e-6);
    for (const p of arc) expect(Math.hypot(p.x - 0.15, p.z - 0.15)).toBeCloseTo(0.2, 5);
    const wheel = { x: def.drivetrain.wheelBase / 2, z: def.drivetrain.trackWidth / 2 };
    expect(Math.hypot(wheel.x - 0.15, wheel.z - 0.15)).toBeLessThanOrEqual(0.2 - 0.07 + 1e-6);
    const chamfered = shaped({ cornerFL: 0.25, cornerFR: 0.25, cornerBL: 0.25, cornerBR: 0.25 });
    const w = { x: chamfered.drivetrain.wheelBase / 2, z: chamfered.drivetrain.trackWidth / 2 };
    // Inside the straight cut x + z = 0.7 - 0.25, by at least the usual inset.
    expect((0.35 + 0.35 - 0.25 - (w.x + w.z)) / Math.SQRT2).toBeGreaterThanOrEqual(0.07 - 1e-6);
  });

  it('drives, and a ball can sit where a square corner would have been', () => {
    const corner = (cut: number) => {
      const def = shaped({ cornerFL: cut, cornerFR: cut, cornerBL: cut, cornerBR: cut, bumperThickness: 0, groundClearance: 0.03 });
      // A ball just ahead of the front-right corner. The robot is moved 0.15 m forward, into where a square corner would reach.
      const ball: [number, number] = [-6 + 0.35 + 0.1, 0.27];
      const pieces = [{ shape: 'ball' as const, radius: 0.075, mass: 0.2, color: '#fff', positions: [ball] }];
      const sim = new SimWorld(testField({ pieces }));
      const robot = sim.addRobot(def);
      run(sim, input(), 0.3);
      const at = robot.position();
      for (let i = 0; i < 10; i++) {
        robot.body.setTranslation({ x: at.x + 0.015 * (i + 1), y: at.y, z: at.z }, true);
        sim.step([input()]);
      }
      run(sim, input(), 0.3);
      const p = sim.pieces.position(0);
      sim.dispose();
      return Math.hypot(p.x - ball[0], p.z - ball[1]);
    };
    expect(corner(0)).toBeGreaterThan(0.05);
    expect(corner(0.25)).toBeLessThan(0.02);
    const def = shaped({ cornerFL: 0.15, cornerFR: 0.15, cornerBL: 0.15, cornerBR: 0.15 });
    const sim = new SimWorld(testField());
    const robot = sim.addRobot(def);
    const start = robot.position();
    run(sim, input({ driveY: 1 }), 1);
    expect(Math.hypot(robot.position().x - start.x, robot.position().z - start.z)).toBeGreaterThan(1.5);
    sim.dispose();
  });
});

describe('hoppers with cut corners', () => {
  beforeAll(() => initPhysics());

  it('are drawn, and fill, in their own shape', () => {
    const def = sanitizeRobot({
      chassis: {},
      drivetrain: { type: 'swerve' },
      subsystems: [{ type: 'hopper', sizeX: 0.5, sizeZ: 0.4, cornerFL: 0.1, cornerFR: 0.1, cornerStyle: 'chamfer' }],
    })!;
    const sim = new SimWorld(testField());
    const robot = sim.addRobot(def);
    const [box, , fill] = [robot.subsystems[0].parts[0], null, robot.subsystems[0].parts.at(-1)!];
    expect(box.outline).toHaveLength(6);
    expect(fill.outline).toEqual(box.outline);
    // Scaled to a box of size 1: the front-left cut ends 0.1 m along a 0.5 m side.
    expect(box.outline).toContainEqual({ x: 0.5, z: (-0.2 + 0.1) / 0.4 });
    const plain = sanitizeRobot({ chassis: {}, drivetrain: { type: 'swerve' }, subsystems: [{ type: 'hopper' }] })!;
    const other = new SimWorld(testField());
    expect(other.addRobot(plain).subsystems[0].parts[0].outline).toBeUndefined();
    sim.dispose();
    other.dispose();
  });
});

describe('open-top hoppers', () => {
  beforeAll(() => initPhysics());

  it('take in fuel that falls onto them, up to their capacity', () => {
    const fill = (openTop: boolean) => {
      const positions = Array.from({ length: 5 }, (): [number, number] => [20, 0]);
      const sim = new SimWorld(testField({ pieces: [{ shape: 'ball', radius: 0.075, mass: 0.2, color: '#fff', positions }] }));
      const def = sanitizeRobot({
        chassis: {},
        drivetrain: { type: 'swerve' },
        subsystems: [{ type: 'hopper', capacity: 3, sizeX: 0.5, sizeZ: 0.5, sizeY: 0.3, bottom: 0.3, openTop }],
      })!;
      const robot = sim.addRobot(def);
      run(sim, input(), 0.3);
      const at = robot.position();
      for (let i = 0; i < 5; i++) sim.pieces.release(i, { x: at.x + (i - 2) * 0.08, y: 1.2 + i * 0.2, z: at.z }, { x: 0, y: 0, z: 0 });
      run(sim, input(), 1.5);
      const held = robot.held.length;
      sim.dispose();
      return held;
    };
    expect(fill(true)).toBe(3);
    expect(fill(false)).toBe(0);
  });
});
