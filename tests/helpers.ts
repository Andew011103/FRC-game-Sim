import { readFileSync } from 'node:fs';
import type { GameDefinition } from '../src/games/types';
import { findRobot } from '../src/robots';
import type { RobotDefinition } from '../src/robots/types';
import { NEUTRAL_INPUT, type DriverInput } from '../src/input/types';
import { SIM_DT, type SimWorld } from '../src/sim/world';

const FIXTURES = ['swerve-shooter', 'tank-hauler', 'swerve-defender'];

/**
 * A robot for a test. Three older robots are kept in tests/robots/ so the
 * tests do not depend on which robots the game currently ships with; any
 * other id is looked up among the game's own robots.
 */
export function testRobot(id: string): RobotDefinition {
  if (!FIXTURES.includes(id)) return findRobot(id);
  return JSON.parse(readFileSync(new URL(`./robots/${id}.json`, import.meta.url), 'utf8')) as RobotDefinition;
}

/** A bare full-size field with one blue robot spot at (-6, 0) facing +X. */
export function testField(extra: Partial<GameDefinition> = {}): GameDefinition {
  return {
    id: 'test',
    name: 'Test field',
    field: { length: 16.54, width: 8.07, wallHeight: 0.5 },
    statics: [],
    props: [],
    spawns: [{ x: -6, z: 0, yaw: 0, alliance: 'blue' }],
    ...extra,
  };
}

export function input(partial: Partial<DriverInput> = {}): DriverInput {
  return { ...NEUTRAL_INPUT, ...partial };
}

export function run(sim: SimWorld, driverInput: DriverInput, seconds: number, each?: () => void): void {
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    sim.step([driverInput]);
    each?.();
  }
}
