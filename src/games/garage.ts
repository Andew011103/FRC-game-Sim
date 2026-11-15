import type { GameDefinition } from './types';

/** An empty floor used to show a robot in the builder. Not a playable field. */
export const garage: GameDefinition = {
  id: 'garage',
  name: 'Garage',
  field: { length: 16.54, width: 8.07, wallHeight: 0.5 },
  statics: [],
  props: [],
  spawns: [{ x: 0, z: 0, yaw: 0, alliance: 'blue' }],
};
