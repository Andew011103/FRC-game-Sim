// Collision groups. Each value packs "what I am" (high 16 bits) and "what I
// touch" (low 16 bits); two shapes collide only when each one is something
// the other touches.

const FIELD_BIT = 0x4000;
const LOOSE_BIT = 0x8000;
/** Bars that some robots are allowed to pass under whatever their shape. */
const LOW_BAR_BIT = 0x2000;
const pack = (membership: number, filter: number): number => ((membership & 0xffff) << 16) | (filter & 0xffff);

/** The floor, walls and field elements. */
export const FIELD_GROUPS = pack(0xffff & ~LOOSE_BIT & ~LOW_BAR_BIT, 0xffff);
/** Robots, game pieces and props: they touch the field and each other. */
export const MOVING_GROUPS = pack(0xffff & ~FIELD_BIT & ~LOW_BAR_BIT, 0xffff);
/** Touches robots, game pieces and props but never the field. */
export const LOOSE_ONLY_GROUPS = pack(LOOSE_BIT, LOOSE_BIT);
/** Touches the field but nothing that moves, so game pieces pass through it. */
export const FIELD_ONLY_GROUPS = pack(0x0001, FIELD_BIT | LOW_BAR_BIT);
/** A low bar: everything touches it except robots that are let under. */
export const LOW_BAR_GROUPS = pack(LOW_BAR_BIT, 0xffff);
/** Touches low bars and nothing else. */
export const LOW_BAR_ONLY_GROUPS = pack(0x0001, LOW_BAR_BIT);

/** The same groups for a robot that is let under low bars. */
export const underLowBars = (groups: number): number => groups & ~LOW_BAR_BIT;
