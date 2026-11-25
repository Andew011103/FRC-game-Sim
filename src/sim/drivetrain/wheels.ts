import RAPIER, { type RigidBody, type World } from '@dimforge/rapier3d-compat';
import type { RobotDefinition } from '../../robots/types';
import { add, clamp, conjugate, cross, dot, normalize, rotate, scale, sub, v3, type Vec3 } from '../math';

// Wheels are not simulated as separate bodies. Each one is a downward ray
// from the chassis: a spring holds the chassis up where the ray hits the
// floor, and a traction force pushes the chassis toward the speed the wheel
// is commanded to turn at. This handles bumps and ramps and costs very little.

/** What one wheel is asked to do, in world space. */
export interface WheelCommand {
  /** Direction the wheel is pointing. */
  dir: Vec3;
  /** Speed the wheel surface is driven at along dir. */
  speed: number;
  /** Sideways grip as a fraction of forward grip. */
  lateralGrip: number;
}

/** Per-wheel state the renderer reads. */
export interface WheelState {
  localPos: Vec3;
  /** Steering angle about the robot's up axis; 0 points to the robot's front. */
  steer: number;
  grounded: boolean;
}

export interface WheelRig {
  mounts: Vec3[];
  /** Height of the chassis centre above the floor at rest. */
  rideHeight: number;
  sag: number;
  stiffness: number;
  damping: number;
  grip: number;
  stallForce: number;
  freeSpeed: number;
  tractionGain: number;
  maxLoad: number;
}

const GRAVITY = 9.81;
const SUSPENSION_SAG = 0.012;
const DAMPING_RATIO = 0.8;

export function buildRig(def: RobotDefinition, dt: number): WheelRig {
  const { chassis, drivetrain } = def;
  const hx = drivetrain.wheelBase / 2;
  const hz = drivetrain.trackWidth / 2;
  const mounts = [v3(hx, 0, -hz), v3(hx, 0, hz), v3(-hx, 0, -hz), v3(-hx, 0, hz)];
  const massPerWheel = chassis.mass / mounts.length;
  const stiffness = (massPerWheel * GRAVITY) / SUSPENSION_SAG;
  return {
    mounts,
    rideHeight: chassis.groundClearance + chassis.height / 2,
    sag: SUSPENSION_SAG,
    stiffness,
    damping: 2 * DAMPING_RATIO * Math.sqrt(stiffness * massPerWheel),
    grip: drivetrain.grip,
    stallForce: massPerWheel * drivetrain.maxAccel,
    // Motor force falls off with speed and reaches a tenth of stall at top speed.
    freeSpeed: drivetrain.maxSpeed / 0.9,
    // Kept low enough that the velocity controller is stable at this timestep.
    tractionGain: (0.4 * massPerWheel) / dt,
    maxLoad: chassis.mass * GRAVITY * 3,
  };
}

export function applyWheelForces(
  world: World,
  body: RigidBody,
  rig: WheelRig,
  commands: WheelCommand[],
  states: WheelState[],
  dt: number,
): void {
  const pos = body.translation();
  const rot = body.rotation();
  const inverseRot = conjugate(rot);
  const linvel = body.linvel();
  const angvel = body.angvel();
  const com = body.worldCom();
  const down = rotate(rot, v3(0, -1, 0));
  const reach = rig.rideHeight + rig.sag;

  for (let i = 0; i < rig.mounts.length; i++) {
    const state = states[i];
    const command = commands[i];
    state.steer = steerAngle(rotate(inverseRot, command.dir));

    const origin = add(pos, rotate(rot, rig.mounts[i]));
    // Wheels only stand on fixed geometry; loose objects get pushed by the chassis.
    const hit = world.castRayAndGetNormal(
      new RAPIER.Ray(origin, down),
      reach,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
    );
    state.grounded = hit !== null;
    if (!hit) continue;

    const normal = hit.normal;
    const contact = add(origin, scale(down, hit.timeOfImpact));
    const pointVel = add(linvel, cross(angvel, sub(contact, com)));
    const normalSpeed = dot(pointVel, normal);

    const compression = reach - hit.timeOfImpact;
    const load = clamp(rig.stiffness * compression - rig.damping * normalSpeed, 0, rig.maxLoad);

    const planeVel = sub(pointVel, scale(normal, normalSpeed));
    const dir = normalize(sub(command.dir, scale(normal, dot(command.dir, normal))));
    const side = cross(normal, dir);
    const speedAlong = dot(planeVel, dir);
    const speedSide = dot(planeVel, side);

    // The motor only weakens with speed when it is pushing the way it is already going.
    let drive = rig.tractionGain * (command.speed - speedAlong);
    const accelerating = drive * speedAlong > 0;
    const motorLimit = accelerating
      ? rig.stallForce * Math.max(0, 1 - Math.abs(speedAlong) / rig.freeSpeed)
      : rig.stallForce;
    drive = clamp(drive, -motorLimit, motorLimit);

    const traction = rig.grip * load;
    const sideLimit = traction * command.lateralGrip;
    let scrub = clamp(-rig.tractionGain * speedSide, -sideLimit, sideLimit);

    const total = Math.hypot(drive, scrub);
    if (total > traction && total > 0) {
      // The tyre is sliding: it pushes against the way it slips over the floor, as hard as its grip
      // allows. Pressed into a wall at an angle, the slip is mostly sideways, so the wheel still
      // carries the robot along the wall at the share of its speed that points that way, as a real one does.
      const slipAlong = command.speed - speedAlong;
      const slipSide = -speedSide;
      const slip = Math.hypot(slipAlong, slipSide);
      if (slip > 1e-6) {
        drive = clamp((traction * slipAlong) / slip, -motorLimit, motorLimit);
        scrub = clamp((traction * slipSide) / slip, -sideLimit, sideLimit);
      } else {
        drive *= traction / total;
        scrub *= traction / total;
      }
    }

    const force = add(scale(normal, load), add(scale(dir, drive), scale(side, scrub)));
    body.applyImpulseAtPoint(scale(force, dt), contact, true);
  }
}

function steerAngle(localDir: Vec3): number {
  return Math.atan2(-localDir.z, localDir.x);
}
