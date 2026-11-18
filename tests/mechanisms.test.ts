import { beforeAll, describe, expect, it } from 'vitest';
import { rebuilt2026 } from '../src/games/rebuilt-2026';
import type { GameDefinition, PieceGroup, Spawn } from '../src/games/types';
import { OFFICIAL_ROBOTS } from '../src/robots';
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

function balls(positions: [number, number][]): PieceGroup[] {
  return [{ shape: 'ball', radius: 0.075, mass: 0.2, color: '#ffffff', positions }];
}

describe('new mechanisms', () => {
  beforeAll(() => initPhysics());

  it('every official robot loads and can be placed on the field', () => {
    expect(OFFICIAL_ROBOTS.length).toBeGreaterThan(0);
    for (const robot of OFFICIAL_ROBOTS) {
      expect(robot.official, robot.id).toBe(true);
      const sim = new SimWorld(rebuilt2026);
      sim.addRobot(robot);
      run(sim, input({ driveY: 1, shoot: true, intake: true }), 0.5);
      sim.dispose();
    }
  });

  it('a turret in its zone scores most of its shots through the funnel', () => {
    const sim = new SimWorld(rebuilt2026, { mode: 'match' });
    sim.addRobot(
      robotWith([
        { type: 'hopper', capacity: 10 },
        { type: 'shooter', turret: true, autoRange: true, speed: 12, pitch: 65, spread: 1, rate: 4 },
      ]),
    );
    run(sim, input(), 0.5);
    run(sim, input({ shoot: true }), 3);
    run(sim, input(), 3);
    // Eight preloaded fuel: the narrow funnel lets a few bounce out.
    expect(sim.match!.score('blue')).toBeGreaterThanOrEqual(5);
    sim.dispose();
  });

  it('a tall hopper does not fit under the trench bar, a low one does', () => {
    const attempt = (sizeY: number): number => {
      const sim = new SimWorld(withSpawn({ x: -5.3, z: 3.39 }));
      const robot = sim.addRobot(robotWith([{ type: 'hopper', capacity: 10, sizeY }]));
      run(sim, input({ driveY: 1 }), 2);
      const x = robot.position().x;
      sim.dispose();
      return x;
    };
    // The bar is 0.565 above the carpet; the default frame top is lower than that.
    expect(attempt(0.15)).toBeGreaterThan(-2.5);
    expect(attempt(0.6)).toBeLessThan(-3.6);
  });

  it('game pieces still pass through a hopper box', () => {
    const sim = new SimWorld(testField({ pieces: balls([[0, 3]]) }));
    sim.addRobot(robotWith([{ type: 'hopper', capacity: 10, sizeY: 0.8 }]));
    run(sim, input(), 0.2);
    // Thrown across the top of the robot, through where the tall hopper is drawn.
    sim.pieces.release(0, { x: -7, y: 0.9, z: 0 }, { x: 8, y: 1, z: 0 });
    run(sim, input(), 0.3);
    expect(sim.pieces.position(0).x).toBeGreaterThan(-5.4);
    sim.dispose();
  });

  it('an intake that can outtake pushes held pieces back out at the chosen speed', () => {
    const def = robotWith([
      { type: 'intake', x: 0.5, sizeX: 0.2, sizeZ: 0.5, outtake: true, outtakeSpeed: 4, rate: 10 },
      { type: 'hopper', capacity: 5 },
    ]);
    const sim = new SimWorld(testField({ pieces: balls([[0, 3], [0.3, 3]]) }));
    const robot = sim.addRobot(def);
    robot.store(sim, 0);
    robot.store(sim, 1);
    run(sim, input(), 0.2);
    sim.step([input({ outtake: true })]);
    expect(robot.held.length).toBe(1);
    // It leaves from the front of the intake, moving forward.
    const velocity = sim.pieces.bodies[1].linvel();
    expect(velocity.x).toBeGreaterThan(3);
    expect(sim.pieces.position(1).x).toBeGreaterThan(-5.4);

    // An intake without the option ignores the button.
    const plain = new SimWorld(testField({ pieces: balls([[0, 3]]) }));
    const other = plain.addRobot(robotWith([{ type: 'intake' }, { type: 'hopper', capacity: 5 }]));
    other.store(plain, 0);
    run(plain, input({ outtake: true }), 0.5);
    expect(other.held.length).toBe(1);
    sim.dispose();
    plain.dispose();
  });

  it('a flip-out blocker hangs down when stowed and swings up into a flat roof', () => {
    const def = robotWith([
      {
        type: 'blocker',
        x: 0.5,
        sizeX: 0.4,
        sizeZ: 0.6,
        sizeY: 0.03,
        bottom: 0.6,
        motion: 'flip',
        foldToward: 'front',
        deployTime: 0.4,
      },
    ]);
    const sim = new SimWorld(testField({ pieces: balls([[0, 3]]) }));
    const robot = sim.addRobot(def);
    const panel = robot.subsystems[0].parts[0];
    run(sim, input(), 0.1);
    // Stowed: turned a quarter turn, hanging from the hinge on its back bottom edge.
    expect(Math.abs(panel.pitch)).toBeCloseTo(Math.PI / 2);
    expect(panel.position.x).toBeCloseTo(0.5 - 0.2 + 0.015);
    const hanging = panel.position.y;

    run(sim, input({ block: true }), 0.2);
    expect(Math.abs(panel.pitch)).toBeGreaterThan(0.3);
    expect(Math.abs(panel.pitch)).toBeLessThan(1.3);

    run(sim, input(), 0.4);
    // Out: flat, where it was designed, its middle a half-length above where it hung.
    expect(panel.pitch).toBeCloseTo(0);
    expect(panel.position.x).toBeCloseTo(0.5);
    expect(panel.position.y - hanging).toBeCloseTo(0.2 + 0.015);
    // A ball dropped onto the roof does not fall through it.
    sim.pieces.release(0, { x: robot.position().x + 0.5, y: 1.2, z: 0 }, { x: 0, y: 0, z: 0 });
    let lowest = Infinity;
    run(sim, input(), 0.5, () => (lowest = Math.min(lowest, sim.pieces.position(0).y)));
    expect(lowest).toBeGreaterThan(0.6);
    sim.dispose();
  });

  it('fuel pushed into the outpost is thrown back at the hub by the human player', () => {
    const sim = new SimWorld(rebuilt2026, { mode: 'match' });
    // Roll five balls into the blue outpost opening, low on the alliance wall near the corner.
    for (let i = 0; i < 5; i++) {
      sim.pieces.release(i, { x: -8.03, y: 0.08, z: 3.05 + i * 0.16 }, { x: -2, y: 0, z: 0 });
    }
    run(sim, input(), 1.2);
    // The outpost takes them in five a second; then the human player holds them and throws one at a time.
    const states = [0, 1, 2, 3, 4].map((i) => sim.pieces.heldBy[i]);
    expect(states.filter((state) => state === -3).length).toBeGreaterThanOrEqual(4);
    run(sim, input(), 8);
    expect(sim.match!.score('blue')).toBeGreaterThanOrEqual(2);
    sim.dispose();
  });
});
