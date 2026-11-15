import type { BoxElement } from '../games/types';
import type { SimRobot } from './robot';
import type { SimWorld } from './world';

// Flat, top-down tests for "are these touching?". The rules use them for
// fouls; they are approximate (a robot is its outline rectangle) and cheap.

/** A rectangle on the floor: its centre, half sizes, and the direction it faces. */
export interface Footprint {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  cos: number;
  sin: number;
}

/** A robot's outline, bumpers included, grown outward by a margin. */
export function footprintOf(robot: SimRobot, margin = 0): Footprint {
  const position = robot.position();
  const heading = robot.heading();
  return {
    x: position.x,
    z: position.z,
    halfX: robot.half.x + margin,
    halfZ: robot.half.z + margin,
    cos: Math.cos(heading),
    sin: Math.sin(heading),
  };
}

/** The footprint of a fixed field element that is not tilted or turned. */
function footprintOfBox(element: BoxElement): Footprint {
  return {
    x: element.position[0],
    z: element.position[2],
    halfX: element.size[0] / 2,
    halfZ: element.size[2] / 2,
    cos: 1,
    sin: 0,
  };
}

/** The four corners as [x, z]. */
export function cornersOf(f: Footprint): [number, number][] {
  const corners: [number, number][] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const lx = sx * f.halfX;
      const lz = sz * f.halfZ;
      // The rectangle's own +x points along its heading; its +z is to the right of that.
      corners.push([f.x + lx * f.cos + lz * f.sin, f.z - lx * f.sin + lz * f.cos]);
    }
  }
  return corners;
}

/** Whether two rectangles overlap (separating-axis test). */
export function overlap(a: Footprint, b: Footprint): boolean {
  const cornersA = cornersOf(a);
  const cornersB = cornersOf(b);
  const axes: [number, number][] = [
    [a.cos, -a.sin],
    [a.sin, a.cos],
    [b.cos, -b.sin],
    [b.sin, b.cos],
  ];
  for (const [ax, az] of axes) {
    const along = (corners: [number, number][]) => corners.map(([x, z]) => x * ax + z * az);
    const pa = along(cornersA);
    const pb = along(cornersB);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}

/** Whether a point is inside a rectangle grown by a margin. */
export function containsPoint(f: Footprint, x: number, z: number, margin = 0): boolean {
  const dx = x - f.x;
  const dz = z - f.z;
  const lx = dx * f.cos - dz * f.sin;
  const lz = dx * f.sin + dz * f.cos;
  return Math.abs(lx) <= f.halfX + margin && Math.abs(lz) <= f.halfZ + margin;
}

/** Whether a robot is up against a wall or another upright, immovable part of the field. */
export function againstField(sim: SimWorld, robot: SimRobot): boolean {
  const footprint = footprintOf(robot, 0.04);
  for (const element of sim.statics) {
    // Ramps and bars a robot can drive over or under do not hold it in place.
    if (element.rotation || element.lowBar) continue;
    if (element.position[1] + element.size[1] / 2 < 0.12) continue;
    if (overlap(footprint, footprintOfBox(element))) return true;
  }
  return false;
}
