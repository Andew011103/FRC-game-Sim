import type { DriverInput } from '../../input/types';
import type { TankDef } from '../../robots/types';
import { clamp, rotate, v3, type Quat, type Vec3 } from '../math';
import type { WheelCommand } from './wheels';

/** Arcade drive: forward/back plus turn, mixed into left and right side speeds. */
export function tankCommands(def: TankDef, input: DriverInput, rot: Quat, mounts: Vec3[]): WheelCommand[] {
  const throttle = clamp(input.driveY, -1, 1);
  // The strafe stick also turns, since a tank drive cannot move sideways.
  const turn = clamp(input.turn + input.driveX, -1, 1) * (def.turnScale ?? 0.6);

  let left = throttle + turn;
  let right = throttle - turn;
  const largest = Math.max(1, Math.abs(left), Math.abs(right));
  left /= largest;
  right /= largest;

  const forward = rotate(rot, v3(1, 0, 0));
  return mounts.map((mount) => ({
    dir: forward,
    // The robot's left side is local -Z.
    speed: (mount.z < 0 ? left : right) * def.maxSpeed,
    lateralGrip: def.lateralGrip,
  }));
}
