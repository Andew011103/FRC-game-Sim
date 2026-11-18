import { outlineOf } from '../robots/chassis';
import { fitsUnder } from '../robots/stats';
import type { RobotDefinition } from '../robots/types';
import type { Alliance, Area, GameDefinition } from './types';

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

/** Where a robot starts a match when nobody has placed it: lined up with its driver station, on the starting line. */
export function stationSpot(game: GameDefinition, alliance: Alliance, station: number): Pose {
  const usual = game.spawns.find((spawn) => spawn.alliance === alliance) ?? game.spawns[0];
  // The same side of the field as the driver station: 1 and 3 mirror each other, 2 is the middle.
  const side = alliance === 'blue' ? -1 : 1;
  const stationZ = -side * (game.field.driverStationZ ?? 0) * (2 - station);
  const z = station === 2 || stationZ === 0 ? 0 : Math.sign(stationZ) * Math.abs(usual.z);
  return { x: usual.x, z, yaw: usual.yaw };
}

/**
 * Where a robot actually starts: the spot asked for (or its station's usual
 * one) moved to the nearest place the game allows. A robot that fits nowhere
 * at that angle keeps the spot asked for.
 */
export function robotStart(
  game: GameDefinition,
  robot: RobotDefinition,
  alliance: Alliance,
  want: Pose | null,
  station = 1,
): Pose {
  const pose = want ?? stationSpot(game, alliance, station);
  const outline = outlineOf(robot.chassis);
  const half = { x: (outline.front + outline.back) / 2, z: (outline.left + outline.right) / 2 };
  const { length, width } = game.field;
  const areas = game.startAreas?.(alliance, fitsUnder(robot, game.field.lowBarClearance ?? 0)) ?? [
    { minX: -length / 2, maxX: length / 2, minZ: -width / 2, maxZ: width / 2 },
  ];
  return fitStart(areas, game.startZone?.(alliance) ?? null, half, pose) ?? pose;
}
