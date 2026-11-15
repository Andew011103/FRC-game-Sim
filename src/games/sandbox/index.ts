import { grid, ridge } from '../shared';
import type { BoxElement, GameDefinition } from '../types';

// An open practice field at full competition size, with a drive-over bump,
// loose crates to push, balls to collect and an open-top bin to shoot into.

const BIN = { x: 4.6, z: -2.2, inner: 1.1, height: 1.1, wall: 0.05 };

/** Four walls around an open top. */
function bin(): BoxElement[] {
  const { x, z, inner, height, wall } = BIN;
  const offset = inner / 2 + wall / 2;
  const style = { color: '#38bdf8', opacity: 0.45 };
  return [
    { size: [wall, height, inner + 2 * wall], position: [x - offset, height / 2, z], ...style },
    { size: [wall, height, inner + 2 * wall], position: [x + offset, height / 2, z], ...style },
    { size: [inner, height, wall], position: [x, height / 2, z - offset], ...style },
    { size: [inner, height, wall], position: [x, height / 2, z + offset], ...style },
  ];
}

export const sandbox: GameDefinition = {
  id: 'sandbox',
  name: 'Practice field',
  description: 'An open field with a bump, crates, balls and a bin. No scoring or timer.',
  field: { length: 16.54, width: 8.07, wallHeight: 0.5 },
  statics: [...ridge(2.5, 2.4, 2.2, 1.35, 15, '#c2410c'), ...bin()],
  props: [
    { size: [0.4, 0.4, 0.4], position: [0, 0.2, -2.2], color: '#a16207', mass: 4 },
    { size: [0.4, 0.4, 0.4], position: [0.6, 0.2, -2.6], color: '#a16207', mass: 4 },
    { size: [0.4, 0.4, 0.4], position: [-0.3, 0.2, -3.0], color: '#a16207', mass: 4 },
  ],
  spawns: [
    { x: -6, z: 0, yaw: 0, alliance: 'blue' },
    { x: 6, z: 0, yaw: Math.PI, alliance: 'red' },
  ],
  pieces: [
    {
      shape: 'ball',
      radius: 0.075,
      mass: 0.2,
      color: '#facc15',
      positions: grid(-2.6, 0, 8, 8, 0.4),
    },
  ],
  targets: [
    { alliance: 'blue', position: [BIN.x, BIN.height + 0.15, BIN.z] },
    { alliance: 'red', position: [BIN.x, BIN.height + 0.15, BIN.z] },
  ],
};
