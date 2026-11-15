import type { BoxElement } from './types';

const SLAB_HALF_THICKNESS = 0.05;

/**
 * A drive-over bump: two ramps meeting at a ridge centred on x.
 * depth is the total front-to-back size, so each ramp covers half of it.
 */
export function ridge(
  x: number,
  z: number,
  widthZ: number,
  depth: number,
  angleDeg: number,
  color: string,
): BoxElement[] {
  const angle = (angleDeg * Math.PI) / 180;
  const halfSlope = depth / 4 / Math.cos(angle);
  const centerY = halfSlope * Math.sin(angle) - SLAB_HALF_THICKNESS * Math.cos(angle);
  const size: [number, number, number] = [halfSlope * 2, SLAB_HALF_THICKNESS * 2, widthZ];
  return [
    { size, position: [x - depth / 4, centerY, z], rotation: [0, 0, angle], color },
    { size, position: [x + depth / 4, centerY, z], rotation: [0, 0, -angle], color },
  ];
}

/** Floor spots in a grid, centred on (x, z). */
export function grid(x: number, z: number, columns: number, rows: number, spacing: number): [number, number][] {
  const spots: [number, number][] = [];
  const x0 = x - ((columns - 1) * spacing) / 2;
  const z0 = z - ((rows - 1) * spacing) / 2;
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      spots.push([x0 + column * spacing, z0 + row * spacing]);
    }
  }
  return spots;
}
