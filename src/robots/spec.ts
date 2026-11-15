import type { FieldSpec } from '../sim/subsystems/types';

// The settings a player may change on a custom robot, with their limits.
// The builder draws its form from these lists, and loading a robot clamps
// every value to them, so a hand-edited file cannot exceed the limits.

export const FRAME_FIELDS: FieldSpec[] = [
  { key: 'length', label: 'Length', kind: 'number', default: 0.7, min: 0.4, max: 0.9, step: 0.01, unit: 'm' },
  { key: 'width', label: 'Width', kind: 'number', default: 0.7, min: 0.4, max: 0.9, step: 0.01, unit: 'm' },
  { key: 'height', label: 'Height', kind: 'number', default: 0.24, min: 0.1, max: 0.45, step: 0.01, unit: 'm' },
  { key: 'groundClearance', label: 'Ground clearance', kind: 'number', default: 0.07, min: 0.03, max: 0.12, step: 0.01, unit: 'm' },
  { key: 'mass', label: 'Weight', kind: 'number', default: 55, min: 20, max: 70, step: 1, unit: 'kg' },
];

/** How far the bumper sticks out on each side (0 leaves the side bare) and how tall the band is. */
export const BUMPER_FIELDS: FieldSpec[] = [
  { key: 'bumperFront', label: 'Front', kind: 'number', default: 0.08, min: 0, max: 0.3, step: 0.01, unit: 'm' },
  { key: 'bumperBack', label: 'Back', kind: 'number', default: 0.08, min: 0, max: 0.3, step: 0.01, unit: 'm' },
  { key: 'bumperLeft', label: 'Left', kind: 'number', default: 0.08, min: 0, max: 0.3, step: 0.01, unit: 'm' },
  { key: 'bumperRight', label: 'Right', kind: 'number', default: 0.08, min: 0, max: 0.3, step: 0.01, unit: 'm' },
  { key: 'bumperHeight', label: 'Band height', kind: 'number', default: 0.13, min: 0.03, max: 0.3, step: 0.01, unit: 'm' },
];

export const CHASSIS_FIELDS: FieldSpec[] = [...FRAME_FIELDS, ...BUMPER_FIELDS];

export const DRIVE_FIELDS: Record<'swerve' | 'tank', FieldSpec[]> = {
  swerve: [
    { key: 'maxSpeed', label: 'Top speed', kind: 'number', default: 5, min: 1, max: 8, step: 0.1, unit: 'm/s' },
    { key: 'maxAccel', label: 'Acceleration', kind: 'number', default: 10, min: 2, max: 20, step: 0.5, unit: 'm/s²' },
    { key: 'grip', label: 'Tyre grip', kind: 'number', default: 1.15, min: 0.6, max: 1.6 },
    { key: 'maxAngularSpeed', label: 'Turn speed', kind: 'number', default: 9, min: 2, max: 16, step: 0.5, unit: 'rad/s' },
  ],
  tank: [
    { key: 'maxSpeed', label: 'Top speed', kind: 'number', default: 4.3, min: 1, max: 8, step: 0.1, unit: 'm/s' },
    { key: 'maxAccel', label: 'Acceleration', kind: 'number', default: 8, min: 2, max: 20, step: 0.5, unit: 'm/s²' },
    { key: 'grip', label: 'Tyre grip', kind: 'number', default: 1.1, min: 0.6, max: 1.6 },
    { key: 'lateralGrip', label: 'Sideways grip', kind: 'number', default: 0.35, min: 0.1, max: 1 },
    { key: 'turnScale', label: 'Turn sensitivity', kind: 'number', default: 0.6, min: 0.3, max: 1 },
  ],
};

/** How far the wheels sit inside the frame edge. */
export const WHEEL_INSET = 0.07;
export const WHEEL_RADIUS = 0.05;
export const MAX_SUBSYSTEMS = 8;
