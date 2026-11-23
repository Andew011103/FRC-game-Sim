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

describe('round frames, aim delay and ending a match', () => {
  beforeAll(() => initPhysics());

  it('a round frame is a disc with one bumper ring, its wheels inside it, and it drives', () => {
    const def = sanitizeRobot({ chassis: { round: true, length: 0.8, width: 0.5, bumperFront: 0.1, bumperLeft: 0 }, drivetrain: { type: 'swerve' }, subsystems: [] })!;
    expect(def.chassis.width).toBe(0.8);
    expect(def.chassis.bumperLeft).toBe(0.1);
    // Each wheel is as far in from the edge of the circle as on a square frame.
    const corner = Math.hypot(def.drivetrain.wheelBase / 2, def.drivetrain.trackWidth / 2);
    expect(corner).toBeCloseTo(0.4 - 0.07, 3);
    const sim = new SimWorld(testField());
    const robot = sim.addRobot(def);
    const start = robot.position();
    run(sim, input({ driveY: 1 }), 1);
    expect(Math.hypot(robot.position().x - start.x, robot.position().z - start.z)).toBeGreaterThan(1.5);
    expect(robot.half.x).toBeCloseTo(0.5);
    expect(robot.half.z).toBeCloseTo(0.5);
    sim.dispose();
  });

  it('a shooter with an aim delay waits that long once lined up before its first shot', () => {
    const firstShot = (aimDelay: number, turret: boolean): number => {
      const pieces: PieceGroup[] = [{ shape: 'ball', radius: 0.075, mass: 0.2, color: '#ffffff', positions: [[4, 3]] }];
      const def = sanitizeRobot({
        chassis: {},
        drivetrain: { type: 'swerve' },
        subsystems: [{ type: 'hopper', capacity: 5 }, { type: 'shooter', autoRange: true, speed: 14, spread: 0, turret, aimDelay }],
      })!;
      // The target is straight ahead, so the robot is lined up from the start.
      const sim = new SimWorld(testField({ pieces, targets: [{ alliance: 'blue', position: [-2, 1, 0] }] }));
      const robot = sim.addRobot(def);
      robot.store(sim, 0);
      run(sim, input(), 0.3);
      let time = 0;
      let fired = -1;
      run(sim, input({ shoot: true }), 2, () => {
        time += 1 / 60;
        if (fired < 0 && robot.held.length === 0) fired = time;
      });
      sim.dispose();
      return fired;
    };
    expect(firstShot(0, false)).toBeLessThan(0.05);
    expect(firstShot(0.8, false)).toBeGreaterThan(0.75);
    expect(firstShot(0.8, false)).toBeLessThan(0.9);
    expect(firstShot(0, true)).toBeLessThan(0.05);
    expect(firstShot(0.5, true)).toBeGreaterThan(0.45);
  });

  it('the host can end the match for everyone, and the room is open again', async () => {
    const { loopback } = await import('../src/net/protocol');
    const { ClientSession, HostSession } = await import('../src/net/session');
    const { findRobot } = await import('../src/robots');
    const host = new HostSession('Host', findRobot('cheesy-poofs'));
    const [hostEnd, clientEnd] = loopback();
    host.accept(hostEnd);
    const guest = new ClientSession(clientEnd, 'Guest', findRobot('simbotics'));
    let ended = false;
    guest.onEnded = () => (ended = true);
    const sim = host.start('rebuilt-2026', {}, 'match', 2);
    for (let i = 0; i < 30; i++) host.step(input());
    expect(guest.room!.playing).toBe(true);
    host.endMatch();
    expect(ended).toBe(true);
    expect(guest.sim).toBeNull();
    expect(guest.room!.playing).toBe(false);
    expect(host.sim).toBeNull();
    host.close();
    sim.dispose();
  });
});

describe('speed presets', () => {
  beforeAll(() => initPhysics());

  it('a preset holds the robot to its share of top speed', () => {
    const top = (share: number) => {
      const sim = new SimWorld(testField());
      const robot = sim.addRobot(testRobot('swerve-shooter'));
      run(sim, input({ driveY: share }), 2);
      const speed = robot.speed();
      sim.dispose();
      return speed;
    };
    const full = top(1);
    expect(top(0.25) / full).toBeGreaterThan(0.2);
    expect(top(0.25) / full).toBeLessThan(0.3);
    expect(top(0.5) / full).toBeCloseTo(0.5, 1);
  });

  it('keeps three presets between 5% and 100%, starting at 25, 50 and 75', async () => {
    const { readSettings } = await import('../src/settings');
    expect(readSettings({}).speedPresets).toEqual([25, 50, 75]);
    expect(readSettings({ speedPresets: [0, 63.4, 400] }).speedPresets).toEqual([5, 63, 100]);
    expect(readSettings({}).keys.speed1).toBe('Digit1');
  });
});

describe('turned parts, decorations and game piece effects', () => {
  beforeAll(() => initPhysics());

  it('turns points the same way as its quaternion', async () => {
    const { turnPoint, turnQuat } = await import('../src/sim/subsystems/types');
    const turn = { yaw: 30, pitch: -50, roll: 75 };
    const p = { x: 0.3, y: -0.2, z: 0.5 };
    const q = turnQuat(turn);
    // q p q*, written out.
    const t = { x: 2 * (q.y * p.z - q.z * p.y), y: 2 * (q.z * p.x - q.x * p.z), z: 2 * (q.x * p.y - q.y * p.x) };
    const expected = {
      x: p.x + q.w * t.x + (q.y * t.z - q.z * t.y),
      y: p.y + q.w * t.y + (q.z * t.x - q.x * t.z),
      z: p.z + q.w * t.z + (q.x * t.y - q.y * t.x),
    };
    const turned = turnPoint(p, turn);
    expect(turned.x).toBeCloseTo(expected.x, 6);
    expect(turned.y).toBeCloseTo(expected.y, 6);
    expect(turned.z).toBeCloseTo(expected.z, 6);
    // A quarter turn about the up axis takes the front to the left (-z), as the renderer draws it.
    const quarter = turnPoint({ x: 1, y: 0, z: 0 }, { yaw: 90, pitch: 0, roll: 0 });
    expect(quarter.z).toBeCloseTo(-1, 6);
  });

  it('a turned LED strip has its segments along the turned line, each turned with it', () => {
    const def = sanitizeRobot({
      chassis: {},
      drivetrain: { type: 'swerve' },
      subsystems: [{ type: 'led', sizeX: 0.4, sizeZ: 0.03, sizeY: 0.03, bottom: 0.4, pitch: 90 }],
    })!;
    const sim = new SimWorld(testField());
    const robot = sim.addRobot(def);
    const parts = robot.subsystems[0].parts;
    expect(parts.length).toBe(10);
    // Tilted straight up: the strip stands upright, so its ends differ in height, not in x.
    expect(Math.abs(parts[0].position.x - parts.at(-1)!.position.x)).toBeLessThan(0.001);
    expect(Math.abs(parts[0].position.y - parts.at(-1)!.position.y)).toBeCloseTo(0.36, 3);
    expect(parts[0].pitch).toBeCloseTo(Math.PI / 2);
    sim.dispose();
  });

  it('LED strips and see-through structures do not count toward the subsystem limit', async () => {
    const { MAX_SUBSYSTEMS, MAX_DECORATIONS } = await import('../src/robots/spec');
    const def = sanitizeRobot({
      chassis: {},
      drivetrain: { type: 'swerve' },
      subsystems: [
        ...Array.from({ length: MAX_SUBSYSTEMS + 2 }, () => ({ type: 'structure' })),
        ...Array.from({ length: MAX_DECORATIONS + 3 }, (_, i) => (i % 2 ? { type: 'led' } : { type: 'structure', solid: false })),
      ],
    })!;
    expect(def.subsystems.filter((part) => part.solid === true).length).toBe(MAX_SUBSYSTEMS);
    expect(def.subsystems.length).toBe(MAX_SUBSYSTEMS + MAX_DECORATIONS);
  });

  it('a see-through structure is not felt by the field, so it does not stop a robot fitting under the trench', async () => {
    const { robotHeight } = await import('../src/robots/stats');
    const tall = (solid: boolean) =>
      sanitizeRobot({ chassis: {}, drivetrain: { type: 'swerve' }, subsystems: [{ type: 'structure', bottom: 0.3, sizeY: 1.2, solid }] })!;
    expect(robotHeight(tall(true))).toBeGreaterThan(1.4);
    expect(robotHeight(tall(false))).toBeLessThan(0.5);
    // Laid on its side, a tall structure is no longer tall.
    const lying = sanitizeRobot({
      chassis: {},
      drivetrain: { type: 'swerve' },
      subsystems: [{ type: 'structure', bottom: 0.3, sizeX: 0.1, sizeZ: 0.1, sizeY: 1, pitch: 90 }],
    })!;
    expect(robotHeight(lying)).toBeLessThan(0.95);
  });

  it('a shot piece is marked with its shooter until it lands, and the mark reaches other players', async () => {
    const { SnapshotReader, SnapshotWriter } = await import('../src/net/snapshot');
    const pieces: PieceGroup[] = [{ shape: 'ball', radius: 0.075, mass: 0.2, color: '#ffffff', positions: [[4, 3]] }];
    const def = sanitizeRobot({
      chassis: {},
      drivetrain: { type: 'swerve' },
      subsystems: [{ type: 'hopper', capacity: 5 }, { type: 'shooter', speed: 8, spread: 0, pitch: 60 }],
    })!;
    const field = testField({ pieces, targets: [{ alliance: 'blue', position: [6, 1, 0] }] });
    const host = new SimWorld(field);
    const copy = new SimWorld(field);
    const robot = host.addRobot(def);
    copy.addRobot(def);
    robot.autoAim = false;
    robot.store(host, 0);
    run(host, input(), 0.3);
    const writer = new SnapshotWriter();
    const reader = new SnapshotReader();
    let flying = false;
    let copied = false;
    run(host, input({ shoot: true }), 0.4, () => {
      reader.apply(copy, writer.write(host, 1));
      if (host.pieces.launchedBy[0] === 0) flying = true;
      if (copy.pieces.launchedBy[0] === 0 && copy.pieces.heldBy[0] === -1) copied = true;
    });
    expect(flying).toBe(true);
    expect(copied).toBe(true);
    run(host, input(), 3);
    reader.apply(copy, writer.write(host, 2));
    expect(host.pieces.launchedBy[0]).toBe(-1);
    expect(copy.pieces.launchedBy[0]).toBe(-1);
    host.dispose();
    copy.dispose();
  });

  it("a skin's game piece effect comes before the one a player equipped", async () => {
    const { dressRobot, PASS } = await import('../src/pass/pass');
    const { cleanEffect } = await import('../src/pass/effects');
    expect(cleanEffect({ kind: 'flame', color: '#ff0000' })).toEqual({ kind: 'flame', color: '#ff0000' });
    expect(cleanEffect({ kind: 'flame', color: 'red' })).toEqual({ kind: 'flame', color: 'alliance' });
    expect(cleanEffect({ kind: 'explode' })).toBeUndefined();
    // Fuel colour, glow and intensity are three separate strengths, each kept in its range; ones at their start are left out.
    expect(cleanEffect({ kind: 'comet', color: '#00ff00', fuelColor: 0.2, glow: 1.5, intensity: 0.433 })).toEqual({
      kind: 'comet',
      color: '#00ff00',
      fuelColor: 0.2,
      glow: 1.5,
      intensity: 0.43,
    });
    expect(cleanEffect({ kind: 'comet', color: '#00ff00', fuelColor: 4, glow: -1, intensity: 9 })).toEqual({ kind: 'comet', color: '#00ff00', fuelColor: 1, glow: 0, intensity: 2 });
    expect(cleanEffect({ kind: 'comet', color: '#00ff00', fuelColor: 0.3, glow: 1, intensity: 1 })).toEqual({ kind: 'comet', color: '#00ff00' });
    const { effectScales } = await import('../src/pass/effects');
    expect(effectScales({ kind: 'glow', color: '#ff0000' })).toEqual({ fuelColor: 0.3, glow: 1, intensity: 1 });
    const { readSettings } = await import('../src/settings');
    expect(readSettings({}).showPieceEffects).toBe(true);
    expect(readSettings({ showPieceEffects: false }).showPieceEffects).toBe(false);
    const robot = testRobot('swerve-shooter');
    // An effect id that is not in the pass does nothing.
    expect(dressRobot(robot, null, 'no-such-effect').pieceEffect).toBeUndefined();
    const reward = [...PASS.tiers.map((tier) => tier.reward), ...PASS.champions].find((r) => r.type === 'pieceEffect');
    if (reward) expect(dressRobot(robot, null, reward.id).pieceEffect).toBeDefined();
    // Custom robots never carry an effect of their own.
    expect(sanitizeRobot({ chassis: {}, drivetrain: { type: 'swerve' }, subsystems: [], pieceEffect: { kind: 'glow', color: '#ffffff' } })!.pieceEffect).toBeUndefined();
  });
});
