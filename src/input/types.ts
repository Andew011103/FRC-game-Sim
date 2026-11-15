/** What a driver is asking for this instant. Stick values are between -1 and 1. */
export interface DriverInput {
  /** Strafe: positive is to the driver's right. */
  driveX: number;
  /** Positive is away from the driver (or robot-forward in robot-centric mode). */
  driveY: number;
  /** Positive is clockwise seen from above. */
  turn: number;
  /** Held to run intakes. */
  intake: boolean;
  /** Held to push held pieces back out of intakes that can outtake. */
  outtake: boolean;
  /** Held to fire shooters. */
  shoot: boolean;
  /** Pressed to extend or retract expanding hoppers. */
  deploy: boolean;
  /** Pressed to raise or lower shot blockers. */
  block: boolean;
  /** Held next to the tower to grab on and climb. */
  climbUp: boolean;
  /** Held to lower the robot back to the floor. */
  climbDown: boolean;
}

export const NEUTRAL_INPUT: DriverInput = {
  driveX: 0,
  driveY: 0,
  turn: 0,
  intake: false,
  outtake: false,
  shoot: false,
  deploy: false,
  block: false,
  climbUp: false,
  climbDown: false,
};

export type InputAction = 'toggleFieldCentric' | 'cycleCamera' | 'reset' | 'pause';
