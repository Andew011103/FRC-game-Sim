import { beforeAll, describe, expect, it } from 'vitest';
import { rebuilt2026 } from '../src/games/rebuilt-2026';
import { hubX } from '../src/games/rebuilt-2026/field';
import type { GameDefinition, Spawn } from '../src/games/types';
import { sanitizeRobot } from '../src/robots/custom';
import type { RobotDefinition } from '../src/robots/types';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testField } from './helpers';

function withSpawn(spawn: Partial<Spawn>): GameDefinition {
  return { ...rebuilt2026, spawns: [{ ...rebuilt2026.spawns[0], ...spawn }] };
}

function robotWith(subsystems: RobotDefinition['subsystems']): RobotDefinition {
  return sanitizeRobot({ chassis: {}, drivetrain: { type: 'swerve' }, subsystems })!;
}

const passer = robotWith([
  { type: 'hopper', capacity: 10 },
  { type: 'shooter', turret: true, speed: 16, pitch: 55, spread: 0 },
]);

/** Fires one piece and returns where it first comes down to the floor. */
function landing(sim: SimWorld): { x: number; z: number } {
  const robot = sim.robots[0];
  run(sim, input(), 0.5);
  const piece = robot.held[robot.held.length - 1];
  sim.step([input({ shoot: true })]);
  let spot = { x: NaN, z: NaN };
  let risen = false;
  run(sim, input(), 4, () => {
    const p = sim.pieces.position(piece);
    if (p.y > 1) risen = true;
    if (risen && p.y < 0.2 && Number.isNaN(spot.x)) spot = { x: p.x, z: p.z };
  });
  return spot;
}

describe('REBUILT field', () => {
  beforeAll(() => initPhysics());

  it('a robot outside its zone passes fuel home, to the side of the field it is on', () => {
    // Driver's left half of the field: the corner by the depot.
    const left = new SimWorld(withSpawn({ x: 0, z: -2 }));
    left.addRobot(passer);
    const leftSpot = landing(left);
    expect(leftSpot.x).toBeLessThan(-6);
    expect(leftSpot.z).toBeLessThan(-2);
    left.dispose();

    // Driver's right half: in front of the human player.
    const right = new SimWorld(withSpawn({ x: 0, z: 2 }));
    right.addRobot(passer);
    const rightSpot = landing(right);
    expect(rightSpot.x).toBeLessThan(-5.5);
    expect(rightSpot.z).toBeGreaterThan(2.3);
    right.dispose();
    // Two full fields are simulated, which can be slow on a busy machine.
  }, 30000);

  it('a robot inside its zone shoots at the hub', () => {
    const sim = new SimWorld(rebuilt2026);
    const robot = sim.addRobot(passer);
    const aim = sim.aimFor('blue', robot.position())!;
    expect(aim.pass).toBe(false);
    expect(aim.point.x).toBeCloseTo(hubX('blue'));
    // The red robot's zone is at the other end.
    expect(sim.aimFor('red', robot.position())!.pass).toBe(true);
    sim.dispose();
  });

  it('only fuel inside the six-sided opening scores', () => {
    const sim = new SimWorld(rebuilt2026, { mode: 'match' });
    // Above a corner of the hub's box, outside the funnel: it bounces off and scores nothing.
    sim.pieces.release(0, { x: hubX('blue') + 0.5, y: 2.3, z: 0.5 }, { x: 0, y: 0, z: 0 });
    // Off centre: it lands on the funnel's sloping side and rolls down through the hole.
    sim.pieces.release(1, { x: hubX('blue') + 0.2, y: 2.3, z: -0.3 }, { x: 0, y: 0, z: 0 });
    run(sim, input(), 3);
    expect(sim.match!.score('blue')).toBe(1);
    sim.dispose();
  });

  it('the hub lights follow the stages of the match', () => {
    const sim = new SimWorld(rebuilt2026, { mode: 'match' });
    const light = (alliance: 'blue' | 'red') => sim.rules!.status(sim, alliance).light;
    run(sim, input(), 18.5);
    // Both hubs stay active into the transition shift, so neither warns at the end of auto.
    expect([light('blue'), light('red')]).toEqual(['on', 'on']);

    run(sim, input(), 5);
    const lights = [light('blue'), light('red')].sort();
    // One hub shows the white running light: it will be inactive first.
    expect(lights).toEqual(['chase', 'on']);
    const first = light('blue') === 'chase' ? 'blue' : 'red';
    const second = first === 'blue' ? 'red' : 'blue';

    run(sim, input(), 4.5);
    expect(sim.match!.phase.id).toBe('transition');
    expect(light(first)).toBe('pulse');
    expect(light(second)).toBe('on');

    run(sim, input(), 4);
    expect(sim.match!.phase.id).toBe('shift1');
    expect(light(first)).toBe('off');
    expect(light(second)).toBe('on');

    // Three seconds before shift 1 ends, the active hub warns that it is about to go dark.
    run(sim, input(), 21.5);
    expect(sim.match!.phase.id).toBe('shift1');
    expect(light(second)).toBe('pulse');
    sim.dispose();
  }, 60000);

  it('in free practice the hub lights stay on', () => {
    const sim = new SimWorld(rebuilt2026);
    run(sim, input(), 1);
    expect(sim.rules!.status(sim, 'blue').light).toBe('on');
    sim.dispose();
  });
});

describe('hopper display and extension', () => {
  beforeAll(() => initPhysics());

  it('shows how full the robot is as a level on the box', () => {
    const pieces = [{ shape: 'ball' as const, radius: 0.075, mass: 0.2, color: '#fff', positions: [[3, 3], [3.3, 3], [3.6, 3], [3.9, 3]] as [number, number][] }];
    const sim = new SimWorld(testField({ pieces }));
    const robot = sim.addRobot(robotWith([{ type: 'hopper', capacity: 4, sizeY: 0.4 }]));
    const [bin, fill] = robot.subsystems[0].parts;
    run(sim, input(), 0.1);
    expect(fill.visible).toBe(false);

    robot.store(sim, 0);
    run(sim, input(), 0.1);
    expect(fill.visible).toBe(true);
    expect(fill.size[1]).toBeCloseTo(0.1, 1);
    // The level sits on the bottom of the box.
    expect(fill.position.y - fill.size[1] / 2).toBeCloseTo(bin.position.y - 0.2, 1);

    for (const piece of [1, 2, 3]) robot.store(sim, piece);
    run(sim, input(), 0.1);
    // Full: a little larger than the box all round, so no two faces share a plane.
    expect(fill.size[1]).toBeGreaterThan(0.4);
    expect(fill.size[0]).toBeGreaterThan(bin.size[0]);
    expect(fill.position.y).toBeCloseTo(bin.position.y);
    sim.dispose();
  });

  it('an extension can be narrower than the hopper and sit to one side', () => {
    const def = robotWith([
      {
        type: 'hopper',
        sizeX: 0.6,
        sizeZ: 0.5,
        sizeY: 0.2,
        expandable: true,
        expandDirection: 'up',
        expandDistance: 0.3,
        // When expanding up, "width" runs left to right and "height" runs front to back.
        extHeight: 0.3,
        extLift: 0.15,
      },
    ]);
    const sim = new SimWorld(testField());
    const robot = sim.addRobot(def);
    const [bin, extension] = robot.subsystems[0].parts;
    run(sim, input({ deploy: true }), 0.6);
    // A foot of the hopper at the front rises; the rest stays as it is.
    expect(extension.size[0]).toBeCloseTo(0.3);
    expect(extension.size[1]).toBeCloseTo(0.3);
    expect(extension.size[2]).toBeCloseTo(0.5);
    expect(extension.position.x).toBeCloseTo(bin.position.x + 0.15);
    sim.dispose();
  });
});
