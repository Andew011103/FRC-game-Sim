import { againstField, containsPoint, cornersOf, footprintOf, overlap } from '../../sim/contact';
import { expelGoalPiece, takeGoalPieces } from '../../sim/goals';
import type { Match, Phase } from '../../sim/match';
import { v3 } from '../../sim/math';
import { OFF_FIELD } from '../../sim/pieces';
import { SIM_DT, type SimWorld } from '../../sim/world';
import { otherAlliance, type Alliance, type Bonus, type GameRules, type Goal, type GoalLight, type StatusInfo } from '../types';
import { HALF_LENGTH, HUB_HEIGHT, OUTPOST, end, hubX } from './field';

// Scoring for the 2026 game, from the official game manual:
// - Fuel in an active hub is 1 point; fuel in an inactive hub is 0.
// - Both hubs are active in auto, the transition shift and the end game.
//   In shifts 1-4 they alternate, and the alliance that scored more fuel in
//   auto has its hub inactive first.
// - Fuel still in flight when a period ends counts for that period if it
//   scores within 3 seconds. After the end game the robots stop and the
//   field keeps counting for those 3 seconds.
// - Hub lights: alliance colour while active, dark while inactive, pulsing
//   for the last 3 seconds before it goes inactive or the match ends,
//   alliance colour with a white light running round during the transition
//   shift on the hub that will be inactive first, and white while the last
//   shots are counted after the match.
// - Tower: level 1 is 15 points in auto (two robots at most) and 10 in
//   teleop; level 2 is 20 and level 3 is 30, teleop only.
// - Fuel pushed into the outpost goes to the human player, who throws it at
//   the hub while the hub is active.
// - Fouls give points to the other alliance: 5 for a minor, 15 for a major.
//   Minor: touching fuel leaving a hub before it reaches the carpet.
//   Major: in auto, touching an opposing robot after crossing the centre
//   line completely; in the end game, touching an opposing robot that is at
//   its tower. Pinning an opposing robot against the field for 3 seconds is
//   a minor, then a major for every 3 seconds more.

/** Fuel that scores this soon after a period ends still counts for that period. */
const GRACE_SECONDS = 3;

export const PHASES: Phase[] = [
  { id: 'auto', label: 'Auto', duration: 20 },
  { id: 'transition', label: 'Transition', duration: 10 },
  { id: 'shift1', label: 'Shift 1', duration: 25 },
  { id: 'shift2', label: 'Shift 2', duration: 25 },
  { id: 'shift3', label: 'Shift 3', duration: 25 },
  { id: 'shift4', label: 'Shift 4', duration: 25 },
  { id: 'endgame', label: 'End game', duration: 30 },
  { id: 'assessment', label: 'Counting last shots', duration: GRACE_SECONDS, extra: true },
];

/** A hub takes this long, in seconds, to pass fuel through. Fuel counts as it comes out, not as it goes in. */
const HUB_SECONDS = [0.5, 0.7];

/** The hub lights pulse for this long before the hub goes inactive. */
const WARNING_SECONDS = 3;

const AUTO_TOWER_POINTS = 15;
const AUTO_TOWER_ROBOTS = 2;
const TELEOP_TOWER_POINTS = [0, 10, 20, 30];

// Regional and district event thresholds.
const ENERGIZED_FUEL = 100;
const SUPERCHARGED_FUEL = 360;
const TRAVERSAL_POINTS = 50;

/** The human player at an outpost: throws per second, and the share of throws aimed well enough to go in. */
export interface HumanPlayer {
  perSecond: number;
  accuracy: number;
}

/** How a throw leaves the human player's hands, and how far off a bad throw is. */
const THROW = { height: 1.5, pitch: (62 * Math.PI) / 180, missAim: [0.07, 0.16], missSpeed: [0.06, 0.14] };
/** Fuel this close to the alliance wall, in front of the outpost opening, has been pushed in. */
const OUTPOST_DEPTH = 0.16;
const ALLIANCES: Alliance[] = ['blue', 'red'];

/** The period a piece scoring right now belongs to, allowing for the grace time after each period. */
function scoringPhase(match: Match): Phase {
  const inGrace = match.phaseIndex > 0 && match.phaseElapsed < GRACE_SECONDS;
  return inGrace ? match.phases[match.phaseIndex - 1] : match.phase;
}

const MINOR_FOUL = 5;
const MAJOR_FOUL = 15;
const PIN_SECONDS = 3;
/** A robot is charged for touching fuel leaving the hub at most this often. */
const FUEL_FOUL_INTERVAL = 1;
/** How close to its tower a robot counts as being at it. */
const TOWER_REACH = 0.9;

export function createRebuiltRules(setup: { humanPlayer: HumanPlayer | null; fouls: boolean }): GameRules {
  /** Fuel that has left a hub and not yet reached the carpet. */
  const leavingHub = new Set<number>();
  /** Seconds until each robot can be charged again for touching such fuel. */
  const fuelFoulWait: number[] = [];
  /** For each pair of opposing robots, by "offender>other": contact so far. */
  const contacts = new Map<string, { touching: boolean; pinned: number; pinFouls: number }>();

  const foul = (sim: SimWorld, offender: Alliance, points: number): void => {
    const match = sim.match!;
    match.addPoints(otherAlliance(offender), 'Opponent fouls', points);
    match.count(offender, points === MINOR_FOUL ? 'minorFouls' : 'majorFouls');
  };

  const fuelFouls = (sim: SimWorld): void => {
    const { pieces } = sim;
    sim.robots.forEach((_, i) => (fuelFoulWait[i] = Math.max(0, (fuelFoulWait[i] ?? 0) - SIM_DT)));
    const charge = (robot: SimWorld['robots'][number]): void => {
      if (fuelFoulWait[robot.index] > 0) return;
      foul(sim, robot.alliance, MINOR_FOUL);
      fuelFoulWait[robot.index] = FUEL_FOUL_INTERVAL;
    };
    for (const i of [...leavingHub]) {
      const holder = pieces.heldBy[i];
      const k = i * 3;
      const grounded = pieces.cur[k + 1] <= pieces.radii[i] + 0.02;
      if (holder >= 0) charge(sim.robots[holder]);
      if (holder !== -1 || grounded) {
        leavingHub.delete(i);
        continue;
      }
      const toucher = sim.robots.find(
        (robot) =>
          containsPoint(footprintOf(robot), pieces.cur[k], pieces.cur[k + 2], pieces.radii[i] + 0.02) &&
          pieces.cur[k + 1] < robot.position().y + 0.9,
      );
      if (toucher) {
        charge(toucher);
        leavingHub.delete(i);
      }
    }
  };

  const atTower = (sim: SimWorld, robot: SimWorld['robots'][number]): boolean => {
    if (robot.climbing) return true;
    const position = robot.position();
    return (sim.game.towers ?? []).some(
      (tower) =>
        tower.alliance === robot.alliance &&
        Math.abs(position.x - tower.x) < TOWER_REACH &&
        Math.abs(position.z - tower.z) < TOWER_REACH,
    );
  };

  const contactFouls = (sim: SimWorld): void => {
    const phaseId = sim.match!.phase.id;
    for (const offender of sim.robots) {
      for (const other of sim.robots) {
        if (offender.alliance === other.alliance) continue;
        const key = `${offender.index}>${other.index}`;
        const state = contacts.get(key) ?? { touching: false, pinned: 0, pinFouls: 0 };
        contacts.set(key, state);
        const touching = overlap(footprintOf(offender, 0.03), footprintOf(other, 0.03));

        if (touching && !state.touching) {
          // Completely over the centre line: every corner is on the other alliance's half.
          const e = end(offender.alliance);
          const across = cornersOf(footprintOf(offender)).every(([x]) => e * x < 0);
          if (phaseId === 'auto' && across) foul(sim, offender.alliance, MAJOR_FOUL);
          if (phaseId === 'endgame' && atTower(sim, other)) foul(sim, offender.alliance, MAJOR_FOUL);
        }
        state.touching = touching;

        // Pinning: holding a stopped opponent against the field while free oneself.
        const pinning = touching && other.speed() < 0.3 && againstField(sim, other) && !againstField(sim, offender);
        if (!pinning) {
          state.pinned = 0;
          state.pinFouls = 0;
          continue;
        }
        state.pinned += SIM_DT;
        if (state.pinned >= PIN_SECONDS * (state.pinFouls + 1)) {
          foul(sim, offender.alliance, state.pinFouls === 0 ? MINOR_FOUL : MAJOR_FOUL);
          state.pinFouls++;
        }
      }
    }
  };

  /** The alliance whose hub goes dark in shifts 1 and 3. Decided once auto's last shots are counted. */
  let firstInactive: Alliance | null = null;
  /** Fuel each human player is holding, and the time until their next throw. */
  const humanPlayer: Record<Alliance, { fuel: number[]; wait: number }> = {
    blue: { fuel: [], wait: 0 },
    red: { fuel: [], wait: 0 },
  };

  /** Fuel inside each hub, on its way through. */
  let inHub: { piece: number; goal: Goal; wait: number }[] = [];

  const activeIn = (phaseId: string, alliance: Alliance): boolean => {
    if (!phaseId.startsWith('shift') || firstInactive === null) return true;
    const shift = Number(phaseId.slice('shift'.length));
    const inactive = shift % 2 === 1 ? firstInactive : otherAlliance(firstInactive);
    return alliance !== inactive;
  };

  const hubActive = (sim: SimWorld, alliance: Alliance): boolean => activeIn(sim.match?.phase.id ?? '', alliance);

  const hubLight = (sim: SimWorld, alliance: Alliance): GoalLight => {
    const match = sim.match;
    if (!match || match.mode !== 'match') return 'on';
    if (match.finished) return 'off';
    if (match.phase.extra) return 'white';
    if (!hubActive(sim, alliance)) return 'off';
    const next = match.phases[match.phaseIndex + 1];
    const goingDark = !next || next.extra || !activeIn(next.id, alliance);
    if (goingDark && match.phaseRemaining <= WARNING_SECONDS) return 'pulse';
    if (match.phase.id === 'transition' && alliance === firstInactive) return 'chase';
    return 'on';
  };

  /** Takes in fuel pushed into an outpost and has its human player throw it at the hub. */
  const runOutpost = (sim: SimWorld, alliance: Alliance, skill: HumanPlayer): void => {
    const { pieces } = sim;
    const e = end(alliance);
    const z = -e * OUTPOST.z;
    const player = humanPlayer[alliance];

    for (let i = 0; i < pieces.count; i++) {
      if (pieces.heldBy[i] !== -1) continue;
      const k = i * 3;
      if (e * pieces.cur[k] < HALF_LENGTH - OUTPOST_DEPTH) continue;
      if (pieces.cur[k + 1] > OUTPOST.height || Math.abs(pieces.cur[k + 2] - z) > OUTPOST.width / 2) continue;
      pieces.hold(i, OFF_FIELD);
      // What the human player throws in is nobody's own score.
      pieces.lastRobot[i] = -1;
      player.fuel.push(i);
    }

    player.wait = Math.max(0, player.wait - SIM_DT);
    const playing = !sim.match || (!sim.match.finished && !sim.match.phase.extra);
    if (player.wait > 0 || player.fuel.length === 0 || !playing || !hubActive(sim, alliance)) return;

    // A lob from behind the wall toward the top of the hub. A good throw is on
    // target; a bad one is off to one side and too long or too short.
    const good = sim.random() < skill.accuracy;
    const miss = ([least, most]: number[]): number =>
      good ? 0 : (sim.random() < 0.5 ? -1 : 1) * (least + sim.random() * (most - least));
    const from = v3(e * (HALF_LENGTH - 0.25), THROW.height, z);
    const dx = hubX(alliance) - from.x;
    const dz = -from.z;
    const distance = Math.hypot(dx, dz);
    const rise = HUB_HEIGHT + 0.25 - from.y;
    const speed =
      Math.sqrt((9.81 * distance ** 2) / (2 * Math.cos(THROW.pitch) ** 2 * (distance * Math.tan(THROW.pitch) - rise))) *
      (1 + miss(THROW.missSpeed));
    const bearing = Math.atan2(dz, dx) + miss(THROW.missAim);
    const flat = speed * Math.cos(THROW.pitch);
    pieces.release(
      player.fuel.shift()!,
      from,
      v3(Math.cos(bearing) * flat, speed * Math.sin(THROW.pitch), Math.sin(bearing) * flat),
    );
    player.wait = 1 / skill.perSecond;
  };

  return {
    phases: PHASES,

    step(sim) {
      const match = sim.match!;
      const phase = scoringPhase(match);

      // Auto's fuel is compared once its last shots have landed.
      const autoCounted = match.phaseIndex > 1 || (match.phaseIndex === 1 && match.phaseElapsed >= GRACE_SECONDS);
      if (firstInactive === null && autoCounted) {
        const blue = match.counted('blue', 'autoFuel');
        const red = match.counted('red', 'autoFuel');
        // On a tie the field picks at random.
        firstInactive = blue > red ? 'blue' : red > blue ? 'red' : sim.random() < 0.5 ? 'blue' : 'red';
      }

      // Fuel that drops into a hub is out of sight for a moment, then counted as it rolls out.
      const released: number[] = [];
      for (const goal of sim.game.goals ?? []) {
        for (const piece of takeGoalPieces(sim, goal)) {
          inHub.push({ piece, goal, wait: HUB_SECONDS[0] + sim.random() * (HUB_SECONDS[1] - HUB_SECONDS[0]) });
        }
      }
      for (const entry of inHub) entry.wait -= SIM_DT;
      for (const goal of sim.game.goals ?? []) {
        const leaving = inHub.filter((entry) => entry.goal === goal && entry.wait <= 0);
        const scored = leaving.length;
        if (scored === 0) continue;
        const active = activeIn(phase.id, goal.alliance);
        for (const { piece } of leaving) {
          // A point goes to the robot that shot the fuel, if it shot at its own hub.
          const shooter = sim.robots[sim.pieces.lastRobot[piece]];
          if (active && shooter?.alliance === goal.alliance) match.addSolo(shooter.index, 1);
          sim.pieces.lastRobot[piece] = -1;
          expelGoalPiece(sim, goal, piece);
          released.push(piece);
        }
        inHub = inHub.filter((entry) => entry.wait > 0 || entry.goal !== goal);
        const inAuto = phase.id === 'auto';
        if (inAuto) match.count(goal.alliance, 'autoFuel', scored);
        if (activeIn(phase.id, goal.alliance)) {
          match.count(goal.alliance, 'activeFuel', scored);
          match.addPoints(goal.alliance, inAuto ? 'Auto fuel' : 'Teleop fuel', scored);
        } else {
          match.count(goal.alliance, 'inactiveFuel', scored);
        }
      }

      if (setup.fouls) {
        for (const piece of released) leavingHub.add(piece);
        fuelFouls(sim);
        contactFouls(sim);
      }

      if (setup.humanPlayer) {
        for (const alliance of ALLIANCES) runOutpost(sim, alliance, setup.humanPlayer);
      }
    },

    phaseEnded(sim, phase) {
      const match = sim.match!;
      if (phase.id === 'auto') {
        const climbed: Record<Alliance, number> = { blue: 0, red: 0 };
        for (const robot of sim.robots) {
          if (robot.climbLevel() >= 1 && climbed[robot.alliance] < AUTO_TOWER_ROBOTS) {
            climbed[robot.alliance]++;
            match.addPoints(robot.alliance, 'Auto tower', AUTO_TOWER_POINTS);
            match.addSolo(robot.index, AUTO_TOWER_POINTS);
          }
        }
      }
      if (match.finished) {
        for (const robot of sim.robots) {
          const points = TELEOP_TOWER_POINTS[robot.climbLevel()] ?? 0;
          if (points > 0) {
            match.addPoints(robot.alliance, 'Teleop tower', points);
            match.addSolo(robot.index, points);
          }
        }
      }
    },

    status(sim, alliance): StatusInfo {
      const goalActive = hubActive(sim, alliance);
      const match = sim.match;
      const fuel = match?.counted(alliance, 'activeFuel') ?? 0;
      // Teleop is counted in parts: the transition, the four shifts and the end game.
      const teleop = PHASES.filter((phase) => !phase.extra && phase.id !== 'auto');
      const part = match?.mode === 'match' ? teleop.findIndex((phase) => phase.id === match.phase.id) : -1;
      return {
        goalActive,
        label: goalActive ? 'Hub active' : 'Hub inactive',
        light: hubLight(sim, alliance),
        progress: { value: fuel, goal: fuel < ENERGIZED_FUEL ? ENERGIZED_FUEL : SUPERCHARGED_FUEL },
        stage: part >= 0 ? { index: part + 1, total: teleop.length } : undefined,
      };
    },

    driving(sim) {
      return !sim.match?.phase.extra;
    },

    bonuses(sim, alliance): Bonus[] {
      const match = sim.match!;
      const fuel = match.counted(alliance, 'activeFuel');
      const towerPoints =
        (match.points[alliance]['Auto tower'] ?? 0) + (match.points[alliance]['Teleop tower'] ?? 0);
      return [
        { label: 'Energized', achieved: fuel >= ENERGIZED_FUEL, detail: `${fuel} / ${ENERGIZED_FUEL} fuel` },
        { label: 'Supercharged', achieved: fuel >= SUPERCHARGED_FUEL, detail: `${fuel} / ${SUPERCHARGED_FUEL} fuel` },
        {
          label: 'Traversal',
          achieved: towerPoints >= TRAVERSAL_POINTS,
          detail: `${towerPoints} / ${TRAVERSAL_POINTS} tower points`,
        },
      ];
    },
  };
}
