import { beforeAll, describe, expect, it } from 'vitest';
import { rebuilt2026 } from '../src/games/rebuilt-2026';
import { robotStart } from '../src/games/start';
import type { PieceGroup } from '../src/games/types';
import { sanitizeRobot } from '../src/robots/custom';
import { cleanEpa, epaColor } from '../src/robots/epa';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testField, testRobot } from './helpers';

describe('EPA', () => {
  const all = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  it('is kept to one decimal place between 0 and 100', () => {
    expect(cleanEpa(42.345)).toBe(42.3);
    expect(cleanEpa('120')).toBe(100);
    expect(cleanEpa(-3)).toBe(0);
    expect(cleanEpa('')).toBeUndefined();
    expect(cleanEpa('fast')).toBeUndefined();
  });

  it('is coloured red at the bottom, white at the median, blue at the top quarter and magenta in the top tenth', () => {
    expect(epaColor(10, all)).toBe('#df7a86');
    expect(epaColor(55, all)).toBe('#eff0f4');
    expect(epaColor(100, all)).toBe('#c078f4');
    // Two robots with the same EPA always share a colour, and a stronger one is never redder.
    expect(epaColor(73.4, all)).toBe(epaColor(73.4, [...all].reverse()));
    expect(epaColor(25, all)).not.toBe(epaColor(35, all));
  });
});

describe('robot builder additions', () => {
  beforeAll(() => initPhysics());

  it('a sliding blocker travels to where it was designed and stays there', () => {
    const def = sanitizeRobot({
      chassis: {},
      drivetrain: { type: 'swerve' },
      subsystems: [{ type: 'blocker', sizeX: 0.5, sizeZ: 0.6, sizeY: 0.03, bottom: 0.9, motion: 'slide', travelY: 0.3, travelX: -0.1, deployTime: 0.3 }],
    })!;
    const sim = new SimWorld(testField());
    const robot = sim.addRobot(def);
    const panel = robot.subsystems[0].parts[0];
    run(sim, input(), 0.1);
    const stowed = { ...panel.position };
    expect(panel.visible).toBe(true);
    run(sim, input({ block: true }), 0.05);
    run(sim, input(), 0.5);
    expect(panel.position.y - stowed.y).toBeCloseTo(0.3);
    expect(panel.position.x - stowed.x).toBeCloseTo(-0.1);
    expect(panel.size[1]).toBeCloseTo(0.03);
    sim.dispose();
  });

  it('a shot is stopped by anything held flat against the top of the shooter', () => {
    const pieces: PieceGroup[] = [{ shape: 'ball', radius: 0.075, mass: 0.2, color: '#ffffff', positions: [[4, 3]] }];
    const shooterDef = sanitizeRobot({
      chassis: {},
      drivetrain: { type: 'swerve' },
      subsystems: [
        { type: 'hopper', capacity: 5 },
        { type: 'shooter', speed: 10, spread: 0, pitch: 70 },
      ],
    })!;
    const flight = (covered: boolean): number => {
      // A first look at where the shooter's top is, then the field with a plate laid on it.
      const probe = new SimWorld(testField({ pieces }));
      const probeRobot = probe.addRobot(shooterDef);
      run(probe, input(), 0.3);
      const box = probeRobot.subsystems.find((subsystem) => subsystem.type === 'shooter')!.parts[0];
      const top = probeRobot.position().y + box.position.y + box.size[1] / 2;
      const x = probeRobot.position().x + box.position.x;
      probe.dispose();

      const plate = { size: [0.6, 0.02, 0.6] as [number, number, number], position: [x, top + 0.02, 0] as [number, number, number], color: '#000' };
      const sim = new SimWorld(testField({ pieces, statics: covered ? [plate] : [], targets: [{ alliance: 'blue', position: [6, 1, 0] }] }));
      const robot = sim.addRobot(shooterDef);
      robot.autoAim = false;
      robot.store(sim, 0);
      run(sim, input(), 0.3);
      let highest = -Infinity;
      run(sim, input({ shoot: true }), 1, () => {
        if (sim.pieces.heldBy[0] === -1) highest = Math.max(highest, sim.pieces.position(0).y - top);
      });
      sim.dispose();
      return highest;
    };
    expect(flight(false)).toBeGreaterThan(1);
    expect(flight(true)).toBeLessThan(0.05);
  });

  it('a climber given a climb time takes that long to reach the top', () => {
    const tower = rebuilt2026.towers!.find((t) => t.alliance === 'blue')!;
    const base = testRobot('swerve-defender');
    const def = { ...base, subsystems: base.subsystems.map((s) => (s.type === 'climber' ? { ...s, climbTime: 8 } : s)) };
    const sim = new SimWorld({ ...rebuilt2026, spawns: [{ ...rebuilt2026.spawns[0], x: tower.x + 0.5, z: tower.z }] });
    const robot = sim.addRobot(def);
    run(sim, input(), 0.3);
    run(sim, input({ climbUp: true }), 6);
    expect(robot.climbLevel()).toBeLessThan(3);
    run(sim, input({ climbUp: true }), 2.5);
    expect(robot.climbLevel()).toBe(3);
    sim.dispose();
  });
});

describe('starting line', () => {
  it("each driver station's robot starts on the line, lined up with its station", () => {
    const robot = testRobot('swerve-shooter');
    const line = -16.54 / 2 + 4.03;
    const spots = [1, 2, 3].map((station) => robotStart(rebuilt2026, robot, 'blue', null, station));
    expect(new Set(spots.map((spot) => Math.sign(spot.z))).size).toBe(3);
    for (const spot of spots) {
      expect(spot.yaw).toBe(0);
      // The front of the robot is on the tape.
      expect(spot.x + 0.3).toBeGreaterThan(line - 0.5);
      expect(robotStart(rebuilt2026, robot, 'blue', spot, 1)).toEqual(spot);
    }
  });
});
