import type { Goal } from '../games/types';
import { v3 } from './math';
import { OFF_FIELD } from './pieces';
import type { SimWorld } from './world';

/**
 * Takes every loose game piece inside a goal off the field and returns
 * them. They stay out of play until `expelGoalPiece` sends each one back.
 */
export function takeGoalPieces(sim: SimWorld, goal: Goal): number[] {
  const { pieces } = sim;
  const { min, max } = goal;
  const taken: number[] = [];

  for (let i = 0; i < pieces.count; i++) {
    if (pieces.heldBy[i] !== -1) continue;
    const x = pieces.cur[i * 3];
    const y = pieces.cur[i * 3 + 1];
    const z = pieces.cur[i * 3 + 2];
    if (x < min[0] || x > max[0] || y < min[1] || y > max[1] || z < min[2] || z > max[2]) continue;
    pieces.hold(i, OFF_FIELD);
    taken.push(i);
  }
  return taken;
}

/** Sends a piece a goal took in back onto the field through one of the goal's exits. */
export function expelGoalPiece(sim: SimWorld, goal: Goal, piece: number): void {
  const exit = goal.exits[Math.floor(sim.random() * goal.exits.length)];
  // Each piece comes out a little differently: sideways, faster or slower, higher or lower.
  const sideways = (sim.random() - 0.5) * 1.0;
  const speed = 0.75 + sim.random() * 0.5;
  const lift = (sim.random() - 0.5) * 0.6;
  sim.pieces.release(
    piece,
    v3(...exit.position),
    v3(exit.velocity[0] * speed, exit.velocity[1] + lift, exit.velocity[2] + sideways),
  );
}
