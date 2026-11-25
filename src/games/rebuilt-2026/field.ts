import { grid, ridge } from '../shared';
import type { Alliance, Area, BoxElement, Goal, PieceGroup, Spawn, Target, Tower } from '../types';

// Field geometry for the 2026 game, from the official game manual
// (inches converted to metres). Blue is at -X, red at +X; the red half is
// the blue half turned 180 degrees about the field centre.
//
// Positions across the field's width come from the field layout drawing.
// NOT CONFIRMED: how far the tower uprights stand from the alliance wall
// (UPRIGHT_FROM_WALL), and the hub's heights below its opening (HUB_BOX,
// HUB_CHAMFER, FUNNEL_BOTTOM). Everything is built from boxes of about the
// right size, so slopes and the funnel are close, not exact.

// The driver camera stands at a side station so the tower does not block the view.
export const FIELD = {
  length: 16.54,
  width: 8.07,
  wallHeight: 0.5,
  zoneDepth: 4.03,
  driverStationZ: -2.4,
  lowBarClearance: 0.565,
};

export const HALF_LENGTH = FIELD.length / 2;
const HALF_WIDTH = FIELD.width / 2;

/** Hub centre, measured from the alliance wall. Its near face is on the alliance zone line. */
const HUB_FROM_WALL = 4.626;
const HUB_SIZE = 1.194;
/** Height of the front edge of the opening. */
export const HUB_HEIGHT = 1.83;
/** The opening is a hexagon this far across, measured between opposite sides. */
const HUB_OPENING = 1.06;
/** Height of the hub's upright sides, and of the floor inside that scored fuel lands on. */
const HUB_BOX = 1.15;
const HUB_FLOOR = 1.0;
/** The sloped faces above the sides, where the lights are: how far they rise and lean in. */
const HUB_CHAMFER = 0.2;
/** The deck the funnel stands on. */
const HUB_DECK = HUB_BOX + HUB_CHAMFER;
/** The funnel narrows to this far across at the deck. */
const FUNNEL_BOTTOM = 0.6;
const HUB_PANEL = 0.03;
/** Fuel leaves the back of the hub this high: about 3 feet, 3/5 of the hub's height. */
const HUB_EXIT_HEIGHT = 0.95;

const BUMP = { width: 1.854, depth: 1.128, angle: 15 };
/**
 * The trench is a bar to drive under: it runs from a block beside the bump out
 * to the side wall. The block runs as deep as the bump: a column under the bar,
 * sloping down each side to a short upright face at each end.
 */
const TRENCH = {
  clearance: 0.565,
  opening: 1.266,
  bar: 0.09,
  blockHeight: 0.889,
  /** How deep the full-height column under the bar is, along the field. */
  blockDepth: 0.2,
  /** Height of the upright face at each end of the block. */
  endHeight: 0.4,
};

export const RUNGS: [number, number, number] = [0.686, 1.143, 1.6];
const UPRIGHT = { height: 1.83, thickness: 0.038, depth: 0.089, spacing: 0.819, rungOverhang: 0.149 };
const UPRIGHT_FROM_WALL = 1.05;
const TOWER_Z = 0.29;
/** The depot is a low-railed rectangle against the alliance wall. */
const DEPOT = { z: -1.929, width: 1.067, depth: 0.686, rail: 0.03 };
/** The outpost is a low opening in the alliance wall near the corner; fuel pushed into it goes to the human player. */
export const OUTPOST = { z: 3.369, width: 0.9, height: 0.3 };

export const FUEL = { radius: 0.075, mass: 0.215, color: '#facc15', spacing: 0.153 };

const COLORS = { blue: '#3b82f6', red: '#ef4444' };
const DARK_COLORS = { blue: '#1d4ed8', red: '#b91c1c' };

/** -1 for blue, +1 for red: which end of the field an alliance owns. */
export const end = (alliance: Alliance): number => (alliance === 'blue' ? -1 : 1);

export const hubX = (alliance: Alliance): number => end(alliance) * (HALF_LENGTH - HUB_FROM_WALL);

/**
 * A box with sloped faces round its top, where the lights are, and a
 * six-sided funnel standing on the deck above. The funnel narrows toward the
 * bottom, so fuel that comes in too fast or off centre can bounce back out.
 * Fuel that drops through lands inside the box and is scored.
 */
function hub(alliance: Alliance): BoxElement[] {
  const x = hubX(alliance);
  const half = HUB_SIZE / 2;
  const shell = HUB_BOX - HUB_FLOOR;
  const wall = { color: '#1e293b' };
  const elements: BoxElement[] = [
    { size: [HUB_SIZE, HUB_FLOOR, HUB_SIZE], position: [x, HUB_FLOOR / 2, 0], ...wall },
    // The alliance-colored panel round the middle of the box.
    { size: [HUB_SIZE + 0.02, 0.45, HUB_SIZE + 0.02], position: [x, 0.6, 0], color: COLORS[alliance] },
    // Upright sides above the inner floor.
    ...[-1, 1].flatMap((side): BoxElement[] => [
      { size: [HUB_PANEL, shell, HUB_SIZE], position: [x + side * (half - HUB_PANEL / 2), HUB_FLOOR + shell / 2, 0], ...wall },
      { size: [HUB_SIZE, shell, HUB_PANEL], position: [x, HUB_FLOOR + shell / 2, side * (half - HUB_PANEL / 2)], ...wall },
    ]),
  ];

  // The sloped faces carry the lights. They are listed in order round the box so a light can run along them.
  const slope = Math.PI / 4;
  const slant = HUB_CHAMFER / Math.sin(slope);
  const segments = 3;
  const run = HUB_SIZE - HUB_CHAMFER;
  const length = run / segments;
  const along = (i: number): number => -run / 2 + length * (i + 0.5);
  const inset = half - HUB_CHAMFER / 2;
  const y = HUB_BOX + HUB_CHAMFER / 2;
  const light = { color: COLORS[alliance], tag: `hub-${alliance}` };
  const lengthwise: [number, number, number] = [slant, HUB_PANEL, length - 0.015];
  const crosswise: [number, number, number] = [length - 0.015, HUB_PANEL, slant];
  for (let i = 0; i < segments; i++) {
    elements.push({ size: lengthwise, position: [x + inset, y, along(i)], rotation: [0, 0, -slope], ...light });
  }
  for (let i = 0; i < segments; i++) {
    elements.push({ size: crosswise, position: [x - along(i), y, inset], rotation: [slope, 0, 0], ...light });
  }
  for (let i = 0; i < segments; i++) {
    elements.push({ size: lengthwise, position: [x - inset, y, -along(i)], rotation: [0, 0, slope], ...light });
  }
  for (let i = 0; i < segments; i++) {
    elements.push({ size: crosswise, position: [x + along(i), y, -inset], rotation: [-slope, 0, 0], ...light });
  }

  // The deck: a frame round the hole the funnel empties into.
  const outer = half - HUB_CHAMFER;
  const hole = FUNNEL_BOTTOM / 2;
  const rim = outer - hole;
  const deck = { color: DARK_COLORS[alliance] };
  for (const side of [-1, 1]) {
    elements.push({ size: [rim, HUB_PANEL, outer * 2], position: [x + side * (hole + rim / 2), HUB_DECK, 0], ...deck });
    elements.push({ size: [hole * 2, HUB_PANEL, rim], position: [x, HUB_DECK, side * (hole + rim / 2)], ...deck });
  }

  // The funnel: six panels leaning outward. Two of its sides run along the field's length.
  const top = HUB_OPENING / 2;
  const rise = HUB_HEIGHT - HUB_DECK;
  const lean = Math.atan2(top - hole, rise);
  const middle = (top + hole) / 2 + HUB_PANEL / 2;
  const widthAtTop = 2 * top * Math.tan(Math.PI / 6);
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 6 + (i * Math.PI) / 3;
    elements.push({
      size: [HUB_PANEL, Math.hypot(rise, top - hole), widthAtTop],
      position: [x + Math.cos(angle) * middle, HUB_DECK + rise / 2, -Math.sin(angle) * middle],
      rotation: [0, angle, -lean],
      color: '#e2e8f0',
      opacity: 0.35,
    });
  }

  // A tall net on the mid-field side stops overshoots.
  const netHeight = 1.5;
  elements.push({
    size: [HUB_PANEL, netHeight, HUB_SIZE],
    position: [x - end(alliance) * (half - HUB_PANEL / 2), HUB_DECK + netHeight / 2, 0],
    color: '#e2e8f0',
    opacity: 0.15,
  });
  return elements;
}

/** A bump on each side of the hub, then a trench from each bump out to the side wall. */
function bumpsAndTrenches(alliance: Alliance): BoxElement[] {
  const x = hubX(alliance);
  const elements: BoxElement[] = [];
  const bumpInner = HUB_SIZE / 2;
  const bumpOuter = bumpInner + BUMP.width;
  const blockWidth = HALF_WIDTH - bumpOuter - TRENCH.opening;
  const barY = TRENCH.clearance + TRENCH.bar / 2;

  for (const side of [-1, 1]) {
    elements.push(
      ...ridge(x, side * (bumpInner + BUMP.width / 2), BUMP.width, BUMP.depth, BUMP.angle, DARK_COLORS[alliance]),
    );
    const openingZ = side * (HALF_WIDTH - TRENCH.opening / 2);
    elements.push(
      // The block the bar is fixed to, beside the bump, with its sloped sides.
      ...trenchBlock(x, side * (bumpOuter + blockWidth / 2), blockWidth, DARK_COLORS[alliance]),
      // The bar robots drive under.
      { size: [TRENCH.bar, TRENCH.bar, TRENCH.opening], position: [x, barY, openingZ], color: COLORS[alliance], lowBar: true },
      // The tag plate standing on the bar.
      { size: [0.03, 0.2, 0.2], position: [x, barY + TRENCH.bar / 2 + 0.1, openingZ], color: '#e5e7eb', lowBar: true },
    );
  }
  return elements;
}

/**
 * The trench's block, as deep along the field as the bump: a full-height
 * column under the bar in the middle, and on each side a slope down to a short
 * upright face, like a rectangle with its top corners cut off at a slant.
 */
function trenchBlock(x: number, z: number, widthZ: number, color: string): BoxElement[] {
  const half = BUMP.depth / 2;
  const column = TRENCH.blockDepth / 2;
  const run = half - column;
  const rise = TRENCH.blockHeight - TRENCH.endHeight;
  const slope = Math.atan2(rise, run);
  const length = Math.hypot(run, rise);
  // Thick enough to fill the triangle under the slope, down to the top of the lower box.
  const thickness = (rise * run) / length + 0.02;
  const elements: BoxElement[] = [
    // The lower part, the full depth of the bump.
    { size: [BUMP.depth, TRENCH.endHeight, widthZ], position: [x, TRENCH.endHeight / 2, z], color },
    // The column under the bar.
    { size: [TRENCH.blockDepth, TRENCH.blockHeight, widthZ], position: [x, TRENCH.blockHeight / 2, z], color },
  ];
  for (const side of [-1, 1]) {
    // A slab whose top face runs from the top of the column down to the top of the end face.
    const topMiddle = { x: x + side * (column + run / 2), y: TRENCH.endHeight + rise / 2 };
    // The slab's middle sits half its thickness below the slope, along the slope's upward normal.
    const normal = { x: side * Math.sin(slope), y: Math.cos(slope) };
    elements.push({
      size: [length, thickness, widthZ],
      position: [topMiddle.x - (normal.x * thickness) / 2, topMiddle.y - (normal.y * thickness) / 2, z],
      rotation: [0, 0, -side * slope],
      color,
    });
  }
  return elements;
}

const towerX = (alliance: Alliance): number => end(alliance) * (HALF_LENGTH - UPRIGHT_FROM_WALL);
const towerZ = (alliance: Alliance): number => -end(alliance) * TOWER_Z;

function tower(alliance: Alliance): BoxElement[] {
  const x = towerX(alliance);
  const z = towerZ(alliance);
  // The frame is in the alliance's color; the rungs are bare metal.
  const color = COLORS[alliance];
  const rungLength = UPRIGHT.spacing + 2 * UPRIGHT.rungOverhang;
  return [
    ...[-1, 1].map(
      (side): BoxElement => ({
        size: [UPRIGHT.depth, UPRIGHT.height, UPRIGHT.thickness],
        position: [x, UPRIGHT.height / 2, z + (side * UPRIGHT.spacing) / 2],
        color,
      }),
    ),
    ...RUNGS.map(
      (height): BoxElement => ({
        size: [0.042, 0.042, rungLength],
        position: [x, height, z],
        color: '#cbd5e1',
      }),
    ),
    { size: [UPRIGHT.thickness, UPRIGHT.thickness, UPRIGHT.spacing], position: [x, UPRIGHT.height, z], color },
  ];
}

/** Low rails on three sides of the depot. Robots drive over them; resting fuel stays in. */
function depot(alliance: Alliance): BoxElement[] {
  const e = end(alliance);
  const z = -e * DEPOT.z;
  const { width, depth, rail } = DEPOT;
  const color = COLORS[alliance];
  return [
    { size: [rail, rail, width], position: [e * (HALF_LENGTH - depth), rail / 2, z], color },
    ...[-1, 1].map(
      (side): BoxElement => ({
        size: [depth, rail, rail],
        position: [e * (HALF_LENGTH - depth / 2), rail / 2, z + (side * width) / 2],
        color,
      }),
    ),
  ];
}

/** The outpost: a low opening in the alliance wall, drawn as a dark slot with a frame. */
function outpost(alliance: Alliance): BoxElement[] {
  const e = end(alliance);
  const z = -e * OUTPOST.z;
  const { width, height } = OUTPOST;
  const face = e * (HALF_LENGTH - 0.005);
  return [
    { size: [0.01, height, width], position: [face, height / 2, z], color: '#020617' },
    { size: [0.02, 0.04, width + 0.08], position: [face, height + 0.02, z], color: COLORS[alliance] },
    ...[-1, 1].map(
      (side): BoxElement => ({
        size: [0.02, height, 0.04],
        position: [face, height / 2, z + side * (width / 2 + 0.02)],
        color: COLORS[alliance],
      }),
    ),
  ];
}

/** What can be changed about the field before a match. */
export interface FieldSetup {
  /** How much fuel starts on the field: one piece, a total, or a multiple of the usual amount. */
  fuel: { one: true } | { total: number } | { scale: number };
  depot: boolean;
  outpost: boolean;
  tower: boolean;
}

export const STANDARD_SETUP: FieldSetup = { fuel: { scale: 1 }, depot: true, outpost: true, tower: true };

/** Fuel in the mid-field block, and beside each depot and outpost, on a standard field. */
const STANDARD_FUEL = { middle: 408, station: 24 };
const MIDDLE_ROWS = 34;

function fuelSpots(setup: FieldSetup): [number, number][] {
  const { fuel } = setup;
  if ('one' in fuel) return [[0, 0]];

  const standard = STANDARD_FUEL.middle + 4 * STANDARD_FUEL.station;
  const total = 'total' in fuel ? fuel.total : Math.round(standard * fuel.scale);
  // Smaller amounts thin out the depots and outposts too; larger ones only add to the middle.
  const share = Math.min(1, total / standard);
  const station = Math.round(STANDARD_FUEL.station * share);
  const middle = Math.max(0, total - 4 * station);

  const spots = grid(0, 0, Math.ceil(middle / MIDDLE_ROWS), MIDDLE_ROWS, FUEL.spacing).slice(0, middle);
  for (const alliance of ['blue', 'red'] as Alliance[]) {
    const e = end(alliance);
    // Depot: fuel inside its rails, against the alliance wall.
    if (setup.depot) {
      spots.push(...grid(e * (HALF_LENGTH - DEPOT.depth / 2), -e * DEPOT.z, 4, 6, 0.16).slice(0, station));
    }
    // Outpost: its fuel starts on the floor in front of the opening.
    if (setup.outpost) {
      spots.push(...grid(e * (HALF_LENGTH - 0.7), -e * OUTPOST.z, 4, 6, 0.16).slice(0, station));
    }
  }
  return spots;
}

function goal(alliance: Alliance): Goal {
  const x = hubX(alliance);
  const inside = HUB_SIZE / 2 - HUB_PANEL;
  // Scored fuel rolls out of the base toward the middle of the field.
  const out = -end(alliance);
  return {
    alliance,
    // Anything that has dropped through the funnel into the box.
    min: [x - inside, HUB_FLOOR + 0.02, -inside],
    max: [x + inside, HUB_DECK - 0.03, inside],
    // Out of the back of the hub, about 3 feet up (3/5 of its height), across its width.
    exits: [-0.42, -0.21, 0, 0.21, 0.42].map((z) => ({
      position: [x + out * (HUB_SIZE / 2 + 0.1), HUB_EXIT_HEIGHT, z] as [number, number, number],
      velocity: [out * 1.5, 0.2, 0] as [number, number, number],
    })),
  };
}

/** Width of the tape line along the edge of each alliance zone. */
const TAPE = 0.05;

/** A strip across the field's whole width, between two distances from an alliance's wall. */
function strip(alliance: Alliance, near: number, far: number): Pick<Area, 'minX' | 'maxX'> {
  const e = end(alliance);
  const a = e * (HALF_LENGTH - near);
  const b = e * (HALF_LENGTH - far);
  return { minX: Math.min(a, b), maxX: Math.max(a, b) };
}

/**
 * An alliance's starting line: the tape at the edge of its zone, in line with
 * the near face of its hub and bumps. A robot starts with its bumpers or
 * frame touching it.
 */
export function startZone(alliance: Alliance): Area {
  return { ...strip(alliance, FIELD.zoneDepth - TAPE / 2, FIELD.zoneDepth + TAPE / 2), minZ: -HALF_WIDTH, maxZ: HALF_WIDTH };
}

/** The hub's base reaches a centimetre over the line, so robots in front of it stop just short. */
const HUB_BASE_OVER_LINE = 0.012;

/**
 * The floor a starting robot may stand on: its alliance zone, and the lanes
 * between each trench block and the side wall. A robot that fits under the
 * trench bar may be under it; any other must stop short of the bar. The
 * robot must also be touching its starting line (see startZone), which limits how far
 * down a lane it can go.
 */
export function startAreas(alliance: Alliance, underBars: boolean): Area[] {
  const areas: Area[] = [{ ...strip(alliance, 0, FIELD.zoneDepth - HUB_BASE_OVER_LINE), minZ: -HALF_WIDTH, maxZ: HALF_WIDTH }];
  const laneEnd = underBars ? HUB_FROM_WALL + 1.5 : HUB_FROM_WALL - TRENCH.bar / 2 - 0.02;
  for (const side of [-1, 1]) {
    const inner = side * (HALF_WIDTH - TRENCH.opening);
    const outer = side * HALF_WIDTH;
    areas.push({ ...strip(alliance, 0, laneEnd), minZ: Math.min(inner, outer), maxZ: Math.max(inner, outer) });
  }
  return areas;
}

/**
 * A robot that is not touching its own alliance zone cannot usefully shoot at
 * its hub, so it passes fuel home: to the corner by the depot from the
 * driver's left half of the field, and to the floor in front of the human
 * player from the right half. reach is how far the robot's outline extends
 * along the field from its centre; a robot whose bumper is over the zone's
 * tape line still shoots.
 */
export function passTarget(
  alliance: Alliance,
  from: { x: number; z: number },
  reach = 0,
): [number, number, number] | null {
  const e = end(alliance);
  const fromWall = HALF_LENGTH - e * from.x;
  if (fromWall - reach <= FIELD.zoneDepth + TAPE / 2) return null;
  // The driver's right is +Z for blue and -Z for red.
  const onRight = -e * from.z > 0;
  return onRight
    ? [e * (HALF_LENGTH - 1.5), 0.1, -e * (OUTPOST.z - 0.2)]
    : [e * (HALF_LENGTH - 1.3), 0.1, e * (HALF_WIDTH - 1.2)];
}

const ALLIANCES: Alliance[] = ['blue', 'red'];

/** The parts of the field that depend on how it is set up. */
export function buildField(setup: FieldSetup): { statics: BoxElement[]; pieces: PieceGroup[]; towers: Tower[] } {
  return {
    statics: ALLIANCES.flatMap((alliance) => [
      ...hub(alliance),
      ...bumpsAndTrenches(alliance),
      ...(setup.tower ? tower(alliance) : []),
      ...(setup.depot ? depot(alliance) : []),
      ...(setup.outpost ? outpost(alliance) : []),
    ]),
    pieces: [{ shape: 'ball', ...FUEL, positions: fuelSpots(setup) }],
    towers: setup.tower
      ? ALLIANCES.map((alliance) => ({ alliance, x: towerX(alliance), z: towerZ(alliance), rungs: RUNGS }))
      : [],
  };
}

export const goals: Goal[] = ALLIANCES.map(goal);

export const targets: Target[] = ALLIANCES.map((alliance) => ({
  alliance,
  // The middle of the opening, so a shot that is neither long nor short drops straight in.
  position: [hubX(alliance), HUB_HEIGHT, 0],
}));

/** Robots start in their alliance zone, lined up with a bump. */
export const spawns: Spawn[] = [
  { x: -5.0, z: 1.524, yaw: 0, alliance: 'blue' },
  { x: 5.0, z: -1.524, yaw: Math.PI, alliance: 'red' },
];
