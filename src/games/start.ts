import type { Area } from './types';

export interface Pose {
  x: number;
  z: number;
  yaw: number;
}

/**
 * The nearest allowed starting spot to a wanted one. The robot's whole
 * outline (half sizes given, bumpers included) must lie inside one of the
 * areas, and, when a zone is given, the outline must reach into that zone:
 * touching its edge is enough. Returns null when the robot fits nowhere at
 * this angle.
 */
export function fitStart(
  areas: Area[],
  zone: Area | null,
  half: { x: number; z: number },
  want: Pose,
): Pose | null {
  // How far the turned outline extends along and across the field from its centre.
  const reachX = Math.abs(half.x * Math.cos(want.yaw)) + Math.abs(half.z * Math.sin(want.yaw));
  const reachZ = Math.abs(half.x * Math.sin(want.yaw)) + Math.abs(half.z * Math.cos(want.yaw));
  let best: Pose | null = null;
  let bestDistance = Infinity;
  for (const area of areas) {
    const minX = Math.max(area.minX + reachX, zone ? zone.minX - reachX : -Infinity);
    const maxX = Math.min(area.maxX - reachX, zone ? zone.maxX + reachX : Infinity);
    const minZ = Math.max(area.minZ + reachZ, zone ? zone.minZ - reachZ : -Infinity);
    const maxZ = Math.min(area.maxZ - reachZ, zone ? zone.maxZ + reachZ : Infinity);
    // The robot is too big for this area at this angle, or cannot reach the zone from it.
    if (minX > maxX || minZ > maxZ) continue;
    const x = Math.min(maxX, Math.max(minX, want.x));
    const z = Math.min(maxZ, Math.max(minZ, want.z));
    const distance = Math.hypot(x - want.x, z - want.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { x, z, yaw: want.yaw };
    }
  }
  return best;
}
