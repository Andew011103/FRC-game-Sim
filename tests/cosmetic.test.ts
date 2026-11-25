import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_SETTINGS, robotAllowed, robotFromWire, robotToWire } from '../src/net/protocol';
import { OFFICIAL_ROBOTS } from '../src/robots';
import { asOfficialSkin } from '../src/robots/cosmetic';
import { sanitizeRobot } from '../src/robots/custom';
import type { RobotDefinition } from '../src/robots/types';

/** A player's copy of an official robot, as the builder makes it. */
const copyOf = (robot: RobotDefinition): RobotDefinition => sanitizeRobot(JSON.parse(JSON.stringify({ ...robot, id: undefined })))!;

const withShooter = () => OFFICIAL_ROBOTS.find((robot) => robot.subsystems.some((part) => part.type === 'shooter'))!;

describe('looks-only changes to official robots', () => {
  it('every official robot, copied as it is, still counts as itself', () => {
    for (const official of OFFICIAL_ROBOTS) {
      const robot = asOfficialSkin(copyOf(official));
      expect(robot.official, official.id).toBe(true);
      expect(robot.id).toBe(official.id);
    }
  });

  it('new colors, LED strips and see-through structures keep it official, and show', () => {
    const official = withShooter();
    const copy = copyOf(official);
    copy.color = '#123456';
    copy.name = 'My own look';
    const shooter = copy.subsystems.findIndex((part) => part.type === 'shooter');
    copy.subsystems[shooter] = { ...copy.subsystems[shooter], color: '#abcdef' };
    copy.subsystems.push({ type: 'led', x: 0, z: 0, bottom: 0.3, sizeX: 0.3, sizeZ: 0.02, sizeY: 0.02, pattern: 'chase' });
    copy.subsystems.push({ type: 'structure', solid: false, x: 0, z: 0, bottom: 0.3, sizeX: 0.2, sizeZ: 0.2, sizeY: 0.2 });
    const robot = asOfficialSkin(sanitizeRobot(copy)!);
    expect(robot.official).toBe(true);
    expect(robot.customSkin).toBe(true);
    expect(robot.id).toBe(official.id);
    expect(robot.name).toBe(official.name);
    expect(robot.color).toBe('#123456');
    expect(robot.subsystems.some((part) => part.color === '#abcdef')).toBe(true);
    expect(robot.subsystems.filter((part) => part.type === 'led')).toHaveLength(
      official.subsystems.filter((part) => part.type === 'led').length + 1,
    );

    // Sent to another player whole, and still official there.
    const wire = robotToWire(robot);
    expect(typeof wire).toBe('object');
    const received = robotFromWire(JSON.parse(JSON.stringify(wire)))!;
    expect(received.official).toBe(true);
    expect(received.color).toBe('#123456');
    expect(robotAllowed(received, DEFAULT_ROOM_SETTINGS)).toBe(true);
  });

  it('any change to how it plays makes it a custom robot', () => {
    const official = withShooter();
    const faster = copyOf(official);
    faster.drivetrain = { ...faster.drivetrain, maxSpeed: faster.drivetrain.maxSpeed + 0.5 };
    const solid = copyOf(official);
    solid.subsystems.push({ type: 'structure', solid: true, x: 0, z: 0, bottom: 0.3, sizeX: 0.2, sizeZ: 0.2, sizeY: 0.2 });
    const shooter = copyOf(official);
    const at = shooter.subsystems.findIndex((part) => part.type === 'shooter');
    shooter.subsystems[at] = { ...shooter.subsystems[at], rate: Number(shooter.subsystems[at].rate) + 1 };
    for (const robot of [faster, solid, shooter]) {
      const played = asOfficialSkin(sanitizeRobot(robot)!);
      expect(played.official).toBe(false);
      expect(robotAllowed(played, DEFAULT_ROOM_SETTINGS)).toBe(false);
      expect(robotAllowed(played, { customRobots: true })).toBe(true);
    }
  });

  it('a claim of being a skin from another player is not believed', () => {
    const official = OFFICIAL_ROBOTS[0];
    const fake = { ...copyOf(official), customSkin: true, official: true, drivetrain: { ...official.drivetrain, maxSpeed: 9 } };
    expect(robotFromWire(fake)!.official).toBe(false);
  });
});
