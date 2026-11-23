import { beforeAll, describe, expect, it } from 'vitest';
import { rebuilt2026 } from '../src/games/rebuilt-2026';
import { fitStart } from '../src/games/start';
import type { GameDefinition, PieceGroup, Spawn } from '../src/games/types';
import { sanitizeRobot } from '../src/robots/custom';
import { robotTags } from '../src/robots/stats';
import type { RobotDefinition } from '../src/robots/types';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testField } from './helpers';

function withSpawn(spawn: Partial<Spawn>): GameDefinition {
  return { ...rebuilt2026, spawns: [{ ...rebuilt2026.spawns[0], ...spawn }] };
}

function robotWith(subsystems: RobotDefinition['subsystems']): RobotDefinition {
  return sanitizeRobot({ chassis: {}, drivetrain: { type: 'swerve' }, subsystems })!;
}

function balls(count: number): PieceGroup[] {
  const positions = Array.from({ length: count }, (_, i): [number, number] => [(i % 10) * 0.2, 2 + Math.floor(i / 10) * 0.2]);
  return [{ shape: 'ball', radius: 0.075, mass: 0.2, color: '#ffffff', positions }];
}

describe('starting position', () => {
  const half = { x: 0.45, z: 0.4 };
  const zone = rebuilt2026.startZone!('blue');
  // The blue zone's tape line is 4.03 m from the wall at x = -8.27.
  const line = -8.27 + 4.03;

  it('a trench robot may start under the bar only with a bumper on the zone line', () => {
    const areas = rebuilt2026.startAreas!('blue', true);
    // Asked for the middle of the field in the trench lane: it is pulled back until it touches the tape.
    const pose = fitStart(areas, zone, half, { x: 0, z: 3.5, yaw: 0 })!;
    expect(pose.x - half.x).toBeLessThanOrEqual(line + 0.03);
    expect(pose.x - half.x).toBeGreaterThan(line - 0.01);
    expect(pose.z).toBeCloseTo(3.5);
    // Turned sideways it reaches less far along the field, so it sits closer to the line.
    const turned = fitStart(areas, zone, half, { x: 0, z: 3.5, yaw: Math.PI / 2 })!;
    expect(turned.x).toBeLessThan(pose.x);
  });

  it('a robot too tall for the trench stops in front of the bar', () => {
    const areas = rebuilt2026.startAreas!('blue', false);
    const pose = fitStart(areas, zone, { x: 0.7, z: 0.4 }, { x: 0, z: 3.5, yaw: 0 })!;
    // The bar is 4.626 m from the wall.
    expect(pose.x + 0.7).toBeLessThan(-8.27 + 4.626);
  });

  it('a robot placed deep in its zone is moved up to touch the starting line, turned as it was', () => {
    const areas = rebuilt2026.startAreas!('blue', false);
    const pose = fitStart(areas, zone, half, { x: -7, z: 1, yaw: Math.PI / 4 })!;
    const reach = (half.x + half.z) * Math.SQRT1_2;
    expect(pose.yaw).toBeCloseTo(Math.PI / 4);
    expect(pose.z).toBeCloseTo(1);
    // Its front corner is on the tape, and it is not past the line into the hub.
    expect(pose.x + reach).toBeGreaterThan(line - 0.026);
    expect(pose.x + reach).toBeLessThanOrEqual(line);
  });
});

describe('polish', () => {
  beforeAll(() => initPhysics());

  it('a robot shoots at the hub while any of it is over its zone line, and passes once clear', () => {
    const shooter = robotWith([
      { type: 'hopper', capacity: 10 },
      { type: 'shooter', turret: true },
    ]);
    const aimAt = (x: number): boolean => {
      const sim = new SimWorld(withSpawn({ x, z: 3.4 }));
      const robot = sim.addRobot(shooter);
      const pass = sim.aimFor('blue', robot.position(), robot)!.pass;
      sim.dispose();
      return pass;
    };
    // The line is at x = -4.24. A robot centred just past it still has its back bumper on it.
    expect(aimAt(-4.0)).toBe(false);
    expect(aimAt(-3.0)).toBe(true);
  });

  it('closing a hopper extension spills what was in it and keeps the hopper full', () => {
    const def = robotWith([
      { type: 'hopper', capacity: 5, expandable: true, expandedCapacity: 12, expandDirection: 'back', expandTime: 0.3 },
    ]);
    const sim = new SimWorld(testField({ pieces: balls(12) }));
    const robot = sim.addRobot(def);
    const [, , fill, extensionFill] = robot.subsystems[0].parts;
    run(sim, input({ deploy: true }), 0.1);
    run(sim, input(), 0.4);
    expect(robot.capacity()).toBe(12);

    // Five pieces: the hopper is full and the extension shows nothing.
    for (let i = 0; i < 5; i++) robot.store(sim, i);
    run(sim, input(), 0.05);
    expect(fill.visible).toBe(true);
    expect(extensionFill.visible).toBe(false);

    for (let i = 5; i < 12; i++) robot.store(sim, i);
    run(sim, input(), 0.05);
    expect(extensionFill.visible).toBe(true);

    run(sim, input({ deploy: true }), 0.05);
    run(sim, input(), 0.6);
    expect(robot.held.length).toBe(5);
    // The seven spilled pieces are loose again, behind the robot.
    const loose = [...Array(12).keys()].filter((i) => sim.pieces.heldBy[i] === -1);
    expect(loose.length).toBe(7);
    sim.dispose();
  });

  it('outtaken pieces leave from across the width of the intake', () => {
    const def = robotWith([
      { type: 'intake', x: 0.5, sizeX: 0.2, sizeZ: 0.7, outtake: true, outtakeSpeed: 3, rate: 20 },
      { type: 'hopper', capacity: 12 },
    ]);
    const sim = new SimWorld(testField({ pieces: balls(12) }));
    const robot = sim.addRobot(def);
    for (let i = 0; i < 12; i++) robot.store(sim, i);
    run(sim, input(), 0.2);
    const starts: number[] = [];
    let held = robot.held.length;
    run(sim, input({ outtake: true }), 1.5, () => {
      if (robot.held.length === held) return;
      held = robot.held.length;
      // The piece just released is the only loose one not yet seen.
      const piece = [...Array(12).keys()].find((i) => sim.pieces.heldBy[i] === -1 && !seen.has(i))!;
      seen.add(piece);
      starts.push(sim.pieces.position(piece).z);
    });
    expect(starts.length).toBe(12);
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(0.35);
    sim.dispose();
  });

  it('a piece that leaves the field is thrown back in', () => {
    const sim = new SimWorld(testField({ pieces: balls(1) }));
    sim.addRobot(robotWith([]));
    sim.pieces.release(0, { x: 3, y: 0.5, z: 5.5 }, { x: 0, y: 0, z: 0 });
    run(sim, input(), 3);
    const spot = sim.pieces.position(0);
    expect(Math.abs(spot.z)).toBeLessThan(4.03);
    expect(Math.abs(spot.x)).toBeLessThan(8.27);
    sim.dispose();
  });

  it('the scoreboard is told the fuel toward the next bonus and the part of teleop', () => {
    const sim = new SimWorld(rebuilt2026, { mode: 'match' });
    expect(sim.rules!.status(sim, 'blue').progress).toEqual({ value: 0, goal: 630 });
    expect(sim.rules!.status(sim, 'blue').stage).toBeUndefined();
    run(sim, input(), 20.5);
    expect(sim.rules!.status(sim, 'blue').stage).toEqual({ index: 1, total: 6 });
    sim.dispose();

    const practice = new SimWorld(rebuilt2026);
    expect(practice.rules!.status(practice, 'blue').stage).toBeUndefined();
    practice.dispose();
  }, 30000);

  it('the robot selector lists only what sets a robot apart', () => {
    const plain = { ...robotWith([{ type: 'intake' }, { type: 'hopper' }, { type: 'shooter' }]), traversal: 'trench' as const };
    expect(robotTags(plain, 0.565)).toEqual([]);
    const odd = sanitizeRobot({
      chassis: {},
      drivetrain: { type: 'tank' },
      traversal: 'bump',
      subsystems: [
        { type: 'intake', outtake: true },
        { type: 'intake' },
        { type: 'hopper', expandable: true },
        { type: 'blocker' },
        { type: 'climber' },
      ],
    })!;
    expect(robotTags(odd, 0.565)).toEqual([
      'Bump only',
      'Tank drive',
      'Dual intake',
      'Outtake',
      'Expanding hopper',
      'No shooter',
      'Shot blocker',
      'Climber',
    ]);
    expect(robotTags(robotWith([{ type: 'shooter', turret: true }]), 0)).toEqual(['Turret']);
  });

  it('team numbers and icons are kept only when they are valid', () => {
    const icon = 'data:image/png;base64,AAAA';
    const robot = sanitizeRobot({ chassis: {}, drivetrain: {}, team: '1323', icon })!;
    expect(robot.team).toBe('1323');
    expect(robot.icon).toBe(icon);
    const bad = sanitizeRobot({ chassis: {}, drivetrain: {}, team: '12ab', icon: 'https://example.com/a.png' })!;
    expect(bad.team).toBeUndefined();
    expect(bad.icon).toBeUndefined();
  });
});

const seen = new Set<number>();
