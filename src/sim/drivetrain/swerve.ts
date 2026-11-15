import type { DriverInput } from '../../input/types';
import type { SwerveDef } from '../../robots/types';
import { conjugate, normalize, rotate, v3, type Quat, type Vec3 } from '../math';
import type { WheelCommand } from './wheels';

export interface SwerveContext {
  rot: Quat;
  mounts: Vec3[];
  fieldCentric: boolean;
  /** +1 for a driver looking along +X (blue), -1 for red. */
  driverSign: number;
  /** Last steering direction of each wheel in robot space; updated in place. */
  lastDirs: Vec3[];
}

/** Turns stick input into a direction and speed for each swerve module. */
export function swerveCommands(def: SwerveDef, input: DriverInput, ctx: SwerveContext): WheelCommand[] {
  let { driveX, driveY } = input;
  const magnitude = Math.hypot(driveX, driveY);
  if (magnitude > 1) {
    driveX /= magnitude;
    driveY /= magnitude;
  }

  let vx: number;
  let vz: number;
  if (ctx.fieldCentric) {
    vx = driveY * ctx.driverSign;
    vz = driveX * ctx.driverSign;
  } else {
    const forward = flatten(rotate(ctx.rot, v3(1, 0, 0)));
    const right = flatten(rotate(ctx.rot, v3(0, 0, 1)));
    vx = forward.x * driveY + right.x * driveX;
    vz = forward.z * driveY + right.z * driveX;
  }
  vx *= def.maxSpeed;
  vz *= def.maxSpeed;
  const omega = -input.turn * def.maxAngularSpeed;

  // Each module's velocity is the chassis velocity plus its share of the spin.
  const velocities = ctx.mounts.map((mount) => {
    const arm = rotate(ctx.rot, mount);
    return v3(vx + omega * arm.z, 0, vz - omega * arm.x);
  });
  const fastest = Math.max(...velocities.map((v) => Math.hypot(v.x, v.z)));
  const limit = fastest > def.maxSpeed ? def.maxSpeed / fastest : 1;

  const inverseRot = conjugate(ctx.rot);
  return velocities.map((velocity, i) => {
    const speed = Math.hypot(velocity.x, velocity.z) * limit;
    if (speed < 0.01) {
      // No command: hold the last steering angle and brake.
      return { dir: rotate(ctx.rot, ctx.lastDirs[i]), speed: 0, lateralGrip: 1 };
    }
    const dir = normalize(velocity);
    ctx.lastDirs[i] = rotate(inverseRot, dir);
    return { dir, speed, lateralGrip: 1 };
  });
}

function flatten(v: Vec3): Vec3 {
  return normalize(v3(v.x, 0, v.z));
}
