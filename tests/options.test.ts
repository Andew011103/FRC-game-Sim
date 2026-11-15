import { beforeAll, describe, expect, it } from 'vitest';
import { configuredGame } from '../src/games';
import type { PieceGroup } from '../src/games/types';
import { sanitizeRobot } from '../src/robots/custom';
import type { RobotDefinition } from '../src/robots/types';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testField } from './helpers';

const rebuilt = (options: Record<string, unknown> = {}) => configuredGame('rebuilt-2026', options);

function robotWith(subsystems: RobotDefinition['subsystems']): RobotDefinition {
  return sanitizeRobot({ chassis: {}, drivetrain: { type: 'swerve' }, subsystems })!;
}

function balls(positions: [number, number][]): PieceGroup[] {
  return [{ shape: 'ball', radius: 0.075, mass: 0.2, color: '#ffffff', positions }];
}

/** Rolls fuel into the blue outpost and returns how many of them the human player scores. */
function humanPlayerScore(humanPlayer: string, count: number, seconds: number): number {
  const spare = new SimWorld(rebuilt({ humanPlayer }), { mode: 'practice' });
  for (let i = 0; i < count; i++) {
    spare.pieces.release(i, { x: -8.1, y: 0.08, z: 3.0 + (i % 5) * 0.16 }, { x: -2, y: 0, z: 0 });
    run(spare, input(), 0.05);
  }
  run(spare, input(), seconds);
  const score = spare.match!.score('blue');
  spare.dispose();
  return score;
}

describe('match options', () => {
  beforeAll(() => initPhysics());

  it('the amount of fuel on the field can be chosen', () => {
    const loose = (fuel: string): number => rebuilt({ fuel }).pieces![0].positions.length;
    expect(loose('default')).toBe(504);
    expect(loose('one')).toBe(1);
    expect(loose('quarter')).toBe(126);
    expect(loose('half')).toBe(252);
    expect(loose('more')).toBe(756);
    expect(loose('double')).toBe(1008);
    expect(loose('thousand')).toBe(1000);
    // Anything unknown falls back to the standard amount.
    expect(loose('nonsense')).toBe(504);
    expect(rebuilt({ fuel: 'one' }).preload).toBe(0);
  });

  it('field structures can be switched off', () => {
    const standard = rebuilt();
    const bare = rebuilt({ depot: false, outpost: false, tower: false });
    expect(standard.towers!.length).toBe(2);
    expect(bare.towers!.length).toBe(0);
    expect(bare.statics.length).toBeLessThan(standard.statics.length);
    // The fuel that sits at the depots and outposts goes with them.
    expect(bare.pieces![0].positions.length).toBe(408);

    // Without a tower a climber has nothing to grab.
    const tower = standard.towers!.find((t) => t.alliance === 'blue')!;
    const sim = new SimWorld({ ...bare, spawns: [{ x: tower.x + 0.5, z: tower.z, yaw: 0, alliance: 'blue' }] });
    const robot = sim.addRobot(robotWith([{ type: 'climber', maxLevel: 3 }]));
    run(sim, input({ climbUp: true }), 1);
    expect(robot.climbing).toBe(false);
    sim.dispose();
  });

  it('a better human player scores more of the fuel pushed into the outpost', () => {
    const best = humanPlayerScore('fourth', 20, 8);
    const worst = humanPlayerScore('brick', 20, 25);
    expect(best).toBeGreaterThanOrEqual(15);
    expect(worst).toBeLessThanOrEqual(6);
    // Simulates over half a minute of a full field.
  }, 60000);

  it('with the outpost switched off, fuel against that wall stays on the field', () => {
    const sim = new SimWorld(rebuilt({ outpost: false }));
    sim.pieces.release(0, { x: -8.1, y: 0.08, z: 3.3 }, { x: -2, y: 0, z: 0 });
    run(sim, input(), 1);
    expect(sim.pieces.heldBy[0]).toBe(-1);
    sim.dispose();
  });

  it('the robot can start somewhere other than the usual spot', () => {
    const sim = new SimWorld(rebuilt());
    const robot = sim.addRobot(robotWith([]), 0, { x: -7, z: -2.5, yaw: Math.PI / 2 });
    run(sim, input(), 0.2);
    expect(robot.position().x).toBeCloseTo(-7, 1);
    expect(robot.position().z).toBeCloseTo(-2.5, 1);
    expect(robot.heading()).toBeCloseTo(Math.PI / 2, 1);
    expect(robot.alliance).toBe('blue');
    sim.dispose();
  });
});

describe('builder additions', () => {
  beforeAll(() => initPhysics());

  it('an intake pulls in fuel from as far as its reach', () => {
    const collected = (reach: number): number => {
      // The intake box ends 0.6 in front of the robot; the ball is 0.2 beyond that.
      const def = robotWith([
        { type: 'intake', x: 0.5, sizeX: 0.2, sizeZ: 0.5, reach, rate: 20 },
        { type: 'hopper', capacity: 5 },
      ]);
      const sim = new SimWorld(testField({ pieces: balls([[-5.2, 0]]) }));
      const robot = sim.addRobot(def);
      run(sim, input({ intake: true }), 0.3);
      const held = robot.held.length;
      sim.dispose();
      return held;
    };
    expect(collected(0)).toBe(0);
    expect(collected(0.15)).toBe(1);
  });

  it('a shooter can fire at its own rate in auto', () => {
    const shotsIn = (mode: 'match' | 'practice'): number => {
      const sim = new SimWorld(rebuilt(), { mode });
      const robot = sim.addRobot(
        robotWith([
          { type: 'hopper', capacity: 8 },
          { type: 'shooter', rate: 12, timingJitter: 0, slowInAuto: true, autoRate: 1 },
        ]),
      );
      robot.autoAim = false;
      const before = robot.held.length;
      run(sim, input({ shoot: true }), 2.05);
      const shots = before - robot.held.length;
      sim.dispose();
      return shots;
    };
    // A match starts in auto: one shot at once, then one a second.
    expect(shotsIn('match')).toBe(3);
    expect(shotsIn('practice')).toBe(8);
  });

  it('a round hopper is drawn as a drum, with its level', () => {
    const sim = new SimWorld(testField());
    const robot = sim.addRobot(robotWith([{ type: 'hopper', round: true }]));
    const [bin, fill] = robot.subsystems[0].parts;
    expect(bin.shape).toBe('cylinder');
    expect(fill.shape).toBe('cylinder');
    sim.dispose();
  });

  it('the extension shows a level only for what the hopper itself cannot hold', () => {
    const sim = new SimWorld(testField({ pieces: balls([[3, 3], [3.3, 3], [3.6, 3]]) }));
    const robot = sim.addRobot(
      robotWith([
        { type: 'hopper', capacity: 2, expandable: true, expandDirection: 'back', expandDistance: 0.3, expandedCapacity: 4 },
      ]),
    );
    const [, extension, , extensionFill] = robot.subsystems[0].parts;
    robot.store(sim, 0);
    robot.store(sim, 1);
    run(sim, input(), 0.1);
    expect(extensionFill.visible).toBe(false);

    // Out, with only the hopper's own two pieces aboard: the extension is still empty.
    run(sim, input({ deploy: true }), 0.6);
    expect(extensionFill.visible).toBe(false);

    // A third piece is one of the two the extension adds room for: its level is half its height and covers its footprint.
    robot.store(sim, 2);
    run(sim, input(), 0.1);
    expect(extensionFill.visible).toBe(true);
    expect(extensionFill.size[1]).toBeCloseTo(extension.size[1] / 2, 1);
    expect(extensionFill.size[0]).toBeGreaterThan(extension.size[0]);
    expect(extensionFill.position.x).toBeCloseTo(extension.position.x);
    sim.dispose();
  });
});
