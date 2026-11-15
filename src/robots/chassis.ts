import type { ChassisDef } from './types';

/** Bumper sizes with defaults filled in. */
export interface Bumpers {
  front: number;
  back: number;
  left: number;
  right: number;
  height: number;
}

export function bumpersOf(chassis: ChassisDef): Bumpers {
  const all = chassis.bumperThickness ?? 0.08;
  return {
    front: chassis.bumperFront ?? all,
    back: chassis.bumperBack ?? all,
    left: chassis.bumperLeft ?? all,
    right: chassis.bumperRight ?? all,
    height: Math.min(chassis.bumperHeight ?? 0.13, chassis.height),
  };
}

/** How far the robot reaches from the middle of its frame on each side, bumpers included. */
export function outlineOf(chassis: ChassisDef): { front: number; back: number; left: number; right: number } {
  const bumpers = bumpersOf(chassis);
  return {
    front: chassis.length / 2 + bumpers.front,
    back: chassis.length / 2 + bumpers.back,
    left: chassis.width / 2 + bumpers.left,
    right: chassis.width / 2 + bumpers.right,
  };
}

/** Height of the top of the frame above the floor. */
export const frameTop = (chassis: ChassisDef): number => chassis.groundClearance + chassis.height;
