import { beforeAll, describe, expect, it } from 'vitest';
import { configuredGame } from '../src/games';
import { buildNetWorld, decodeInput, encodeInput } from '../src/net/protocol';
import { sanitizeRobot } from '../src/robots/custom';
import { OFF_FIELD } from '../src/sim/pieces';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run } from './helpers';

const robot = () => sanitizeRobot({ chassis: {}, drivetrain: { type: 'swerve' }, subsystems: [] })!;

/** Loose fuel lying on the carpet in front of the blue outpost, which is at z = 3.37 against the blue wall. */
function inFrontOfOutpost(sim: SimWorld): number {
  let count = 0;
  for (let i = 0; i < sim.pieces.count; i++) {
    if (sim.pieces.heldBy[i] !== -1) continue;
    const p = sim.pieces.position(i);
    if (p.x < -5.8 && p.x > -8.2 && Math.abs(p.z - 3.37) < 1.4 && p.y < 0.3) count++;
  }
  return count;
}

const heldByHumanPlayers = (sim: SimWorld) => Array.from(sim.pieces.heldBy).filter((holder) => holder === OFF_FIELD).length;

describe("the human player's chute", () => {
  beforeAll(() => initPhysics());

  it('pours everything in it onto the field in front of the outpost when a driver presses the key', () => {
    const sim = new SimWorld(configuredGame('rebuilt-2026'), { mode: 'practice' });
    sim.addRobot(robot());
    const before = inFrontOfOutpost(sim);
    const holding = heldByHumanPlayers(sim);
    sim.step([input({ humanDrop: true })]);
    run(sim, input(), 3.5);
    // Both alliances' human players start with 24; only blue's dropped.
    expect(holding).toBe(48);
    expect(inFrontOfOutpost(sim) - before).toBeGreaterThanOrEqual(22);
    expect(heldByHumanPlayers(sim)).toBeLessThanOrEqual(24);
    sim.dispose();
  });

  it('one press drops all 24 as 4 rows of 6, side by side across the outpost', () => {
    const sim = new SimWorld(configuredGame('rebuilt-2026'), { mode: 'practice' });
    sim.addRobot(robot());
    // Fuel in the air just in front of the blue outpost, by how far across it each one is.
    const falling = () => {
      const across: number[] = [];
      for (let i = 0; i < sim.pieces.count; i++) {
        if (sim.pieces.heldBy[i] !== -1) continue;
        const p = sim.pieces.position(i);
        if (p.x < -7 && p.y > 0.3) across.push(p.z);
      }
      return across.sort((a, b) => a - b);
    };
    sim.step([input({ humanDrop: true })]);
    run(sim, input(), 0.05);
    const row = falling();
    expect(row).toHaveLength(6);
    // Side by side, 0.16 m apart, centred on the outpost.
    expect(row[5] - row[0]).toBeCloseTo(0.8, 1);
    expect((row[0] + row[5]) / 2).toBeCloseTo(3.37, 1);
    run(sim, input(), 0.5);
    // By then all four rows are out.
    expect(heldByHumanPlayers(sim)).toBeLessThanOrEqual(24);
    sim.dispose();
  });

  it('without a press, the human player throws at the hub instead and nothing piles up by the outpost', () => {
    const sim = new SimWorld(configuredGame('rebuilt-2026'), { mode: 'practice' });
    sim.addRobot(robot());
    const before = inFrontOfOutpost(sim);
    run(sim, input(), 3.5);
    expect(inFrontOfOutpost(sim) - before).toBeLessThan(3);
    sim.dispose();
  });

  it('after a drop, the human player fills the chute again, 2 a second, before throwing any more', () => {
    const sim = new SimWorld(configuredGame('rebuilt-2026'), { mode: 'practice' });
    sim.addRobot(robot());
    // Six more pieces pushed into the blue outpost, on top of the 24 its human player starts with.
    const six = Array.from({ length: sim.pieces.count }, (_, i) => i)
      .filter((i) => sim.pieces.heldBy[i] === -1 && Math.abs(sim.pieces.position(i).x) < 1 && sim.pieces.position(i).y < 0.1)
      .slice(0, 6);
    six.forEach((piece, i) => sim.pieces.release(piece, { x: -8.1, y: 0.08, z: 2.95 + i * 0.16 }, { x: -1, y: 0, z: 0 }));
    const inside = () => six.filter((piece) => sim.pieces.heldBy[piece] === OFF_FIELD).length;
    // Dropped at once: the chute pours the 24 it starts with while the six go into the outpost.
    sim.step([input({ humanDrop: true })]);
    run(sim, input(), 1.5);
    expect(inside()).toBe(6);
    // The 4 rows drop in under half a second, and filling the chute with the six takes 3 more; until then, none of them is thrown.
    run(sim, input(), 1.5);
    expect(inside()).toBe(6);
    run(sim, input(), 4);
    expect(inside()).toBeLessThan(6);
    sim.dispose();
  });

  it('holding the key drops once', () => {
    const sim = new SimWorld(configuredGame('rebuilt-2026'), { mode: 'practice' });
    sim.addRobot(robot());
    const before = inFrontOfOutpost(sim);
    run(sim, input({ humanDrop: true }), 3.5);
    const dropped = inFrontOfOutpost(sim) - before;
    expect(dropped).toBeGreaterThanOrEqual(22);
    expect(dropped).toBeLessThanOrEqual(24);
    sim.dispose();
  });

  it('multiplayer has no drop: the press is not sent, and a multiplayer field ignores it', () => {
    expect(decodeInput(encodeInput(input({ humanDrop: true, powerUp: true }))).input).toMatchObject({ humanDrop: false, powerUp: true });
    expect(encodeInput(input({ humanDrop: true })).byteLength).toBe(5);
    const sim = buildNetWorld({
      gameId: 'rebuilt-2026',
      options: {},
      mode: 'practice',
      powerUps: false,
      seed: 1,
      players: [{ id: 0, name: 'A', robot: robot(), seat: { alliance: 'blue', station: 1 }, pose: null }],
    });
    const before = inFrontOfOutpost(sim);
    sim.step([input({ humanDrop: true })]);
    run(sim, input(), 3.5);
    expect(inFrontOfOutpost(sim) - before).toBeLessThan(3);
    sim.dispose();
  });
});
