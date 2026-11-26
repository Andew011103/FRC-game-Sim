import { iconOf, teamOf } from './team';
import type { RobotDefinition } from './types';

// Every JSON file in builtin/ is an official robot. To add one, put its file
// there (the builder's "Save as official" button does this while developing).
const files = import.meta.glob<RobotDefinition>('./builtin/*.json', { eager: true, import: 'default' });

/** Robots that ship with the game, in file-name order. */
export const OFFICIAL_ROBOTS: RobotDefinition[] = Object.keys(files)
  .sort()
  .map((path) => ({ ...files[path], team: teamOf(files[path]), icon: iconOf(files[path]), official: true }));

// While developing, saving an official robot changes this folder. The running
// game and the interface's state both hold the old list, and patching the
// new one in leaves them out of step, so the page starts again instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

/** A plain swerve chassis, used only if there is no other robot to fall back on. */
const BASIC_ROBOT: RobotDefinition = {
  id: 'basic',
  name: 'Basic robot',
  official: false,
  chassis: { length: 0.7, width: 0.7, height: 0.2, mass: 50, groundClearance: 0.07, bumperThickness: 0.08 },
  drivetrain: {
    type: 'swerve',
    wheelBase: 0.56,
    trackWidth: 0.56,
    wheelRadius: 0.05,
    maxSpeed: 4.05,
    maxAccel: 9,
    grip: 1.1,
    maxAngularSpeed: 8,
  },
  subsystems: [],
};

/** The robot selected when nothing else is: the first official one. */
export const DEFAULT_ROBOT_ID = OFFICIAL_ROBOTS[0]?.id ?? BASIC_ROBOT.id;

/** Looks a robot up by id among the official robots and any custom ones given. */
export function findRobot(id: string, custom: RobotDefinition[] = []): RobotDefinition {
  return (
    OFFICIAL_ROBOTS.find((robot) => robot.id === id) ??
    custom.find((robot) => robot.id === id) ??
    OFFICIAL_ROBOTS[0] ??
    custom[0] ??
    BASIC_ROBOT
  );
}
