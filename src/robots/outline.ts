import { bumpersOf } from './chassis';
import type { ChassisDef } from './types';

// A frame's shape seen from above. Any of its four corners can be cut off:
// chamfered (a straight cut across the corner) or rounded. The bumpers follow
// the frame round its cut corners. Points are in the robot's own space: x runs
// back (-) to front (+), z runs left (-) to right (+).

export interface Point {
  x: number;
  z: number;
}

export type CornerName = 'cornerFL' | 'cornerFR' | 'cornerBR' | 'cornerBL';

/** The four corners in order round the frame: front-left, front-right, back-right, back-left. */
const CORNERS: { key: CornerName; x: number; z: number; in: Point; out: Point }[] = [
  // At each corner the outline arrives along one side and leaves along the next.
  { key: 'cornerFL', x: 1, z: -1, in: { x: 1, z: 0 }, out: { x: 0, z: 1 } },
  { key: 'cornerFR', x: 1, z: 1, in: { x: 0, z: 1 }, out: { x: -1, z: 0 } },
  { key: 'cornerBR', x: -1, z: 1, in: { x: -1, z: 0 }, out: { x: 0, z: -1 } },
  { key: 'cornerBL', x: -1, z: -1, in: { x: 0, z: -1 }, out: { x: 1, z: 0 } },
];

/** Straight pieces a rounded corner is drawn and simulated with. */
const ARC_PIECES = 6;

/** A box's corner cuts, as a frame or a mechanism gives them. */
export interface CornerCuts {
  cornerStyle?: 'chamfer' | 'round';
  cornerFL?: number;
  cornerFR?: number;
  cornerBR?: number;
  cornerBL?: number;
}

/** How much is cut off each corner of a box this long and wide, each no more than half the shorter side. */
export function boxCuts(length: number, width: number, cuts: CornerCuts): Record<CornerName, number> {
  const most = Math.max(0, Math.min(length, width) / 2 - 0.005);
  const cut = (value: number | undefined) => Math.max(0, Math.min(most, value ?? 0));
  return {
    cornerFL: cut(cuts.cornerFL),
    cornerFR: cut(cuts.cornerFR),
    cornerBR: cut(cuts.cornerBR),
    cornerBL: cut(cuts.cornerBL),
  };
}

/** How much is cut off each corner of the frame. */
export function cornerCuts(chassis: ChassisDef): Record<CornerName, number> {
  return boxCuts(chassis.length, chassis.width, chassis);
}

/** Whether a box has any corner cut off. */
export const hasCuts = (length: number, width: number, cuts: CornerCuts): boolean =>
  Object.values(boxCuts(length, width, cuts)).some((cut) => cut > 0.001);

/** Whether the frame has any corner cut off. A round frame is a disc instead. */
export function hasShapedCorners(chassis: ChassisDef): boolean {
  if (chassis.round) return false;
  return Object.values(cornerCuts(chassis)).some((cut) => cut > 0.001);
}

/** The frame's outline, going round from the front-left corner. */
export function frameOutline(chassis: ChassisDef): Point[] {
  return boxOutline(chassis.length, chassis.width, chassis);
}

/** The outline of a box this long and wide, centred on its middle, with its corners cut. */
export function boxOutline(length: number, width: number, given: CornerCuts): Point[] {
  const cuts = boxCuts(length, width, given);
  const rounded = given.cornerStyle === 'round';
  const points: Point[] = [];
  for (const corner of CORNERS) {
    const at = { x: (corner.x * length) / 2, z: (corner.z * width) / 2 };
    const cut = cuts[corner.key];
    if (cut <= 0.001) {
      points.push(at);
      continue;
    }
    if (!rounded) {
      // A straight cut from one side to the next.
      points.push({ x: at.x - corner.in.x * cut, z: at.z - corner.in.z * cut });
      points.push({ x: at.x + corner.out.x * cut, z: at.z + corner.out.z * cut });
      continue;
    }
    // A quarter circle of radius `cut`, tangent to both sides.
    const centre = { x: at.x + (corner.out.x - corner.in.x) * cut, z: at.z + (corner.out.z - corner.in.z) * cut };
    for (let i = 0; i <= ARC_PIECES; i++) {
      const t = (i / ARC_PIECES) * (Math.PI / 2);
      points.push({
        x: centre.x + cut * (-corner.out.x * Math.cos(t) + corner.in.x * Math.sin(t)),
        z: centre.z + cut * (-corner.out.z * Math.cos(t) + corner.in.z * Math.sin(t)),
      });
    }
  }
  return withoutRepeats(points);
}

/**
 * The outline of the bumpers round the frame. Each stretch of frame is pushed
 * out by its side's bumper: a cut across a corner by a blend of the two sides
 * it joins. Sides with no bumper stay where they are.
 */
export function bumperOutline(chassis: ChassisDef): Point[] {
  const frame = frameOutline(chassis);
  const bumpers = bumpersOf(chassis);
  const n = frame.length;
  // Each edge's outward direction and how far it is pushed out.
  const edges = frame.map((from, i) => {
    const to = frame[(i + 1) % n];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const size = Math.hypot(dx, dz);
    // The outline goes clockwise seen from above, so outward is to the left of travel.
    let normal = { x: dz / size, z: -dx / size };
    const middle = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
    if (normal.x * middle.x + normal.z * middle.z < 0) normal = { x: -normal.x, z: -normal.z };
    const along = normal.x ** 2 * (normal.x > 0 ? bumpers.front : bumpers.back);
    const across = normal.z ** 2 * (normal.z > 0 ? bumpers.right : bumpers.left);
    return { from, normal, push: along + across };
  });
  // Each corner of the bumper is where its two pushed-out edges meet.
  return withoutRepeats(
    edges.map((edge, i) => {
      const before = edges[(i - 1 + n) % n];
      return meet(
        { x: before.from.x + before.normal.x * before.push, z: before.from.z + before.normal.z * before.push },
        { x: -before.normal.z, z: before.normal.x },
        { x: edge.from.x + edge.normal.x * edge.push, z: edge.from.z + edge.normal.z * edge.push },
        { x: -edge.normal.z, z: edge.normal.x },
        { x: edge.from.x + ((before.normal.x + edge.normal.x) / 2) * edge.push, z: edge.from.z + ((before.normal.z + edge.normal.z) / 2) * edge.push },
      );
    }),
  );
}

/**
 * How far in from each straight side the wheels must sit so they stay inside
 * the cut corners, at least the usual inset.
 */
export function wheelInset(chassis: ChassisDef, usual: number): number {
  if (!hasShapedCorners(chassis)) return usual;
  const deepest = Math.max(...Object.values(cornerCuts(chassis)));
  if (chassis.cornerStyle === 'round') {
    // The wheel's centre must be `usual` inside the arc.
    return Math.max(usual, deepest - (deepest - usual) / Math.SQRT2);
  }
  // The wheel's centre must be `usual` inside the straight cut.
  return Math.max(usual, (deepest + usual * Math.SQRT2) / 2);
}

/** Where two lines meet, each given by a point and a direction; `fallback` when they are parallel. */
function meet(a: Point, da: Point, b: Point, db: Point, fallback: Point): Point {
  const cross = da.x * db.z - da.z * db.x;
  if (Math.abs(cross) < 1e-9) return fallback;
  const t = ((b.x - a.x) * db.z - (b.z - a.z) * db.x) / cross;
  return { x: a.x + da.x * t, z: a.z + da.z * t };
}

function withoutRepeats(points: Point[]): Point[] {
  return points.filter((point, i) => {
    const next = points[(i + 1) % points.length];
    return Math.hypot(point.x - next.x, point.z - next.z) > 1e-6;
  });
}
