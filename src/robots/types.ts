// A robot is plain JSON-compatible data: a chassis, a drivetrain and a list
// of subsystems. Lengths are metres, masses kilograms, speeds metres/second.

export interface ChassisDef {
  /** Frame size without bumpers. Length runs front to back. */
  length: number;
  width: number;
  height: number;
  mass: number;
  groundClearance: number;
  /** Older files: one bumper thickness for all four sides. */
  bumperThickness?: number;
  /** How far the bumper sticks out past the frame on each side. 0 leaves that side bare. */
  bumperFront?: number;
  bumperBack?: number;
  bumperLeft?: number;
  bumperRight?: number;
  /** Height of the bumper band, measured up from the bottom of the frame. */
  bumperHeight?: number;
  /** A round frame: a disc whose diameter is the length, with one ring of bumper as thick as the front bumper. */
  round?: boolean;
  /** How the frame's corners are cut: straight across, or rounded. */
  cornerStyle?: 'chamfer' | 'round';
  /** How much is cut off each corner, measured along the sides. 0 leaves a corner square. */
  cornerFL?: number;
  cornerFR?: number;
  cornerBR?: number;
  cornerBL?: number;
  /** Height of the centre of mass above the floor. Defaults to a low value. */
  comHeight?: number;
}

interface DrivetrainBase {
  /** Front-to-back distance between wheel centres. */
  wheelBase: number;
  /** Left-to-right distance between wheel centres. */
  trackWidth: number;
  wheelRadius: number;
  maxSpeed: number;
  /** Acceleration from a standstill, before traction limits. */
  maxAccel: number;
  /** Tyre friction coefficient on carpet. */
  grip: number;
}

export interface SwerveDef extends DrivetrainBase {
  type: 'swerve';
  /** Radians per second. */
  maxAngularSpeed: number;
}

export interface TankDef extends DrivetrainBase {
  type: 'tank';
  /** Sideways grip as a fraction of forward grip; low values turn easily. */
  lateralGrip: number;
  /** Scales the turn stick so spinning in place is controllable. */
  turnScale?: number;
}

export type DrivetrainDef = SwerveDef | TankDef;

/** Filled in by the subsystem library (intake, shooter, climber and so on). */
export interface SubsystemDef {
  type: string;
  [setting: string]: unknown;
}

export type Traversal = 'auto' | 'trench' | 'bump';

export interface RobotDefinition {
  id: string;
  name: string;
  description?: string;
  /** Official robots ship with the game and are the only ones eligible for leaderboards. */
  official: boolean;
  color?: string;
  /** Team number, digits only. Shown in white on the bumpers and on the scoreboard. */
  team?: string;
  /** The team's icon as a small image data URL, for the scoreboard. */
  icon?: string;
  /**
   * Set while a Drive Pass skin is being made in the builder: the official
   * robot it dresses up, the reward it is saved as, and the Ranking Points it needs.
   */
  skinOf?: { robotId: string; rewardId: string; rp: number; champion?: boolean };
  /** Drive Pass: how fuel this robot shoots looks in the air. Only ever set by a skin or an equipped reward. */
  pieceEffect?: { kind: string; color: string; fuelColor?: number; glow?: number; intensity?: number };
  /** How strong the robot is, 0.0 to 100.0. Set for official robots only, so multiplayer alliances can be made even. */
  epa?: number;
  /**
   * Whether the robot fits under low bars such as the trench. 'auto' goes by
   * its shape; 'trench' always fits; 'bump' never does and must go over.
   */
  traversal?: Traversal;
  chassis: ChassisDef;
  drivetrain: DrivetrainDef;
  subsystems: SubsystemDef[];
}
