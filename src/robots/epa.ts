import { OFFICIAL_ROBOTS } from '.';
import type { RobotDefinition } from './types';

// EPA rates how strong an official robot is, from 0.0 to 100.0, so players can
// pick evenly matched alliances. Only official robots have one. Its color
// says where it stands among all official robots: red below the median, white
// at the median, blue at the top quarter and magenta in the top tenth.

/** An EPA as stored: 0 to 100 with one decimal place, or undefined when there is none. */
export function cleanEpa(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number)) return undefined;
  return Math.round(Math.min(100, Math.max(0, number)) * 10) / 10;
}

/** A robot's EPA, if it is an official robot that has one. */
export function epaOf(robot: RobotDefinition): number | null {
  if (!robot.official) return null;
  return cleanEpa(robot.epa) ?? null;
}

/** The color scale, by share of robots below: the four given colors at the bottom, median, top quarter and top tenth. */
const STOPS: [number, string][] = [
  [0, '#DF7A86'],
  [0.17, '#EBA27A'],
  [0.34, '#EED48A'],
  [0.5, '#EFF0F4'],
  [0.57, '#BDEBC8'],
  [0.64, '#9FE3DE'],
  [0.7, '#A9C9F6'],
  [0.75, '#8CA8F3'],
  [0.8, '#8E93EE'],
  [0.84, '#9C86F0'],
  [0.87, '#AE7EF2'],
  [0.9, '#C078F4'],
  [1, '#C078F4'],
];

const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Where an EPA falls among the given ones, from 0 (lowest) to 1 (highest). Equal EPAs always land at the same place. */
export function epaRank(epa: number, all: number[] = officialEpas()): number {
  const sorted = [...all].sort((a, b) => a - b);
  if (sorted.length < 2) return 0.5;
  if (epa <= sorted[0]) return 0;
  if (epa >= sorted[sorted.length - 1]) return 1;
  // Between the two nearest EPAs, by how far it is from each. Repeated values are counted at their middle.
  const place = (value: number): number => {
    const first = sorted.indexOf(value);
    const last = sorted.lastIndexOf(value);
    return (first + last) / 2 / (sorted.length - 1);
  };
  const above = sorted.findIndex((value) => value >= epa);
  if (sorted[above] === epa) return place(epa);
  const below = sorted[above - 1];
  const t = (epa - below) / (sorted[above] - below);
  return place(below) + t * (place(sorted[above]) - place(below));
}

/** The color for an EPA. */
export function epaColor(epa: number, all?: number[]): string {
  const rank = epaRank(epa, all);
  const next = STOPS.findIndex(([at]) => at >= rank);
  if (next <= 0) return STOPS[0][1].toLowerCase();
  const [a, from] = STOPS[next - 1];
  const [b, to] = STOPS[next];
  const t = b > a ? (rank - a) / (b - a) : 0;
  const mixed = rgb(from).map((value, i) => Math.round(value + (rgb(to)[i] - value) * t));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function officialEpas(): number[] {
  return OFFICIAL_ROBOTS.map(epaOf).filter((epa): epa is number => epa !== null);
}
