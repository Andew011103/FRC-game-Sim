import type { Alliance, Bonus, StatusInfo } from '../games/types';
import type { SimWorld } from '../sim/world';

// A snapshot is the host's field at one instant, packed small enough to send
// to every other player many times a second. Robots and loose props are sent
// whole. Game pieces and mechanism parts are sent only when they have changed
// since the last snapshot, so the connection must deliver snapshots in order
// and without loss.

/** Game piece positions are sent in whole millimetres. */
const MM = 1000;
const QUAT = 32767;
const ANGLE = 32767 / Math.PI;
const PART_FLOATS = 8;

/** What the snapshot says about a robot beyond where it is. */
export interface RobotExtras {
  capacity: number;
  climbLevel: number;
}

/** The clock, the score and the goal lights, sent a few times a second. */
export interface MatchState {
  phaseIndex: number;
  phaseElapsed: number;
  elapsed: number;
  finished: boolean;
  points: Record<Alliance, Record<string, number>>;
  counts: Record<Alliance, Record<string, number>>;
  /** Points each robot scored itself. */
  solo: number[];
  status: Record<Alliance, StatusInfo>;
  bonuses: Record<Alliance, Bonus[]>;
}

const partsOf = (sim: SimWorld, robot: number) => sim.robots[robot].subsystems.flatMap((subsystem) => subsystem.parts);

/** Packs the host's field into snapshots, remembering what the players already have. */
export class SnapshotWriter {
  private full = true;
  private pieceSent = new Int16Array(0);
  private heldSent = new Int8Array(0);
  private partSent: Float32Array[] = [];
  private scratch = new DataView(new ArrayBuffer(0));

  /** Makes the next snapshot carry everything, for a player who has nothing yet. */
  requestFull(): void {
    this.full = true;
  }

  write(sim: SimWorld, tick: number): ArrayBuffer {
    const { pieces, robots, props } = sim;
    const parts = robots.map((_, i) => partsOf(sim, i));
    if (this.pieceSent.length !== pieces.count * 3 || this.partSent.length !== robots.length) {
      this.pieceSent = new Int16Array(pieces.count * 3);
      this.heldSent = new Int8Array(pieces.count);
      this.partSent = parts.map((list) => new Float32Array(list.length * (PART_FLOATS + 1)));
      this.full = true;
      const most =
        16 +
        robots.reduce((sum, robot, i) => sum + 32 + robot.wheels.length * 2 + parts[i].length * 34, 0) +
        props.length * 20 +
        pieces.count * 9;
      this.scratch = new DataView(new ArrayBuffer(most));
    }

    const view = this.scratch;
    let at = 0;
    const u8 = (value: number) => (view.setUint8(at, value), (at += 1));
    const u16 = (value: number) => (view.setUint16(at, value, true), (at += 2));
    const i16 = (value: number) => (view.setInt16(at, Math.round(value), true), (at += 2));
    const f32 = (value: number) => (view.setFloat32(at, value, true), (at += 4));
    const pose = (t: { x: number; y: number; z: number }, r: { x: number; y: number; z: number; w: number }) => {
      f32(t.x), f32(t.y), f32(t.z);
      i16(r.x * QUAT), i16(r.y * QUAT), i16(r.z * QUAT), i16(r.w * QUAT);
    };

    view.setUint32(at, tick, true);
    at += 4;
    u8(this.full ? 1 : 0);

    u8(robots.length);
    robots.forEach((robot, index) => {
      pose(robot.body.translation(), robot.body.rotation());
      u8(robot.climbing ? 1 : 0);
      u8(robot.climbLevel());
      u16(robot.capacity());
      u8(robot.wheels.length);
      for (const wheel of robot.wheels) i16(Math.atan2(Math.sin(wheel.steer), Math.cos(wheel.steer)) * ANGLE);

      const sent = this.partSent[index];
      const countAt = at;
      let changed = 0;
      u8(0);
      parts[index].forEach((part, p) => {
        const values = [
          part.visible ? 1 : 0,
          part.position.x,
          part.position.y,
          part.position.z,
          part.yaw,
          part.pitch,
          part.size[0],
          part.size[1],
          part.size[2],
        ];
        const base = p * values.length;
        if (!this.full && values.every((value, k) => Math.fround(value) === sent[base + k])) return;
        values.forEach((value, k) => (sent[base + k] = value));
        changed++;
        u8(p), u8(values[0]);
        for (let k = 1; k < values.length; k++) f32(values[k]);
      });
      view.setUint8(countAt, changed);
    });

    u8(props.length);
    for (const prop of props) pose(prop.body.translation(), prop.body.rotation());

    const countAt = at;
    let changed = 0;
    u16(0);
    for (let i = 0; i < pieces.count; i++) {
      const k = i * 3;
      const x = Math.round(pieces.cur[k] * MM);
      const y = Math.round(pieces.cur[k + 1] * MM);
      const z = Math.round(pieces.cur[k + 2] * MM);
      const held = pieces.heldBy[i];
      const same =
        held === this.heldSent[i] &&
        // Where a piece inside a robot was last seen does not matter.
        (held !== -1 || (x === this.pieceSent[k] && y === this.pieceSent[k + 1] && z === this.pieceSent[k + 2]));
      if (same && !this.full) continue;
      this.heldSent[i] = held;
      this.pieceSent[k] = x;
      this.pieceSent[k + 1] = y;
      this.pieceSent[k + 2] = z;
      changed++;
      u16(i);
      view.setInt8(at, held);
      at += 1;
      i16(x), i16(y), i16(z);
    }
    view.setUint16(countAt, changed, true);

    this.full = false;
    return view.buffer.slice(0, at);
  }
}

/** Puts snapshots into a player's own copy of the field, which is drawn but never simulated. */
export class SnapshotReader {
  tick = -1;
  extras: RobotExtras[] = [];
  private started = false;

  apply(sim: SimWorld, buffer: ArrayBuffer): void {
    const { pieces, robots, props } = sim;
    const view = new DataView(buffer);
    let at = 0;
    const u8 = () => view.getUint8(at++);
    const u16 = () => ((at += 2), view.getUint16(at - 2, true));
    const i16 = () => ((at += 2), view.getInt16(at - 2, true));
    const f32 = () => ((at += 4), view.getFloat32(at - 4, true));
    const position = () => ({ x: f32(), y: f32(), z: f32() });
    const rotation = () => ({ x: i16() / QUAT, y: i16() / QUAT, z: i16() / QUAT, w: i16() / QUAT });

    const tick = view.getUint32(at, true);
    at += 4;
    const full = u8() === 1;
    // Changes cannot be applied on top of a field this copy has never been given whole.
    if (!this.started && !full) return;

    if (u8() !== robots.length) throw new Error('The snapshot is for a different set of robots.');
    this.extras = robots.map((robot, index) => {
      robot.prevPos = robot.position();
      robot.prevRot = robot.rotation();
      robot.body.setTranslation(position(), false);
      robot.body.setRotation(rotation(), false);
      robot.climbing = u8() === 1;
      const climbLevel = u8();
      const capacity = u16();
      const wheels = u8();
      for (let w = 0; w < wheels; w++) robot.wheels[w].steer = i16() / ANGLE;

      const parts = partsOf(sim, index);
      for (let changed = u8(); changed > 0; changed--) {
        const part = parts[u8()];
        part.visible = u8() === 1;
        part.position.x = f32();
        part.position.y = f32();
        part.position.z = f32();
        part.yaw = f32();
        part.pitch = f32();
        part.size[0] = f32();
        part.size[1] = f32();
        part.size[2] = f32();
      }
      if (!this.started) {
        robot.prevPos = robot.position();
        robot.prevRot = robot.rotation();
      }
      return { capacity, climbLevel };
    });

    if (u8() !== props.length) throw new Error('The snapshot is for a different field.');
    for (const prop of props) {
      const t = prop.body.translation();
      const r = prop.body.rotation();
      prop.prevPos = { x: t.x, y: t.y, z: t.z };
      prop.prevRot = { x: r.x, y: r.y, z: r.z, w: r.w };
      const to = position();
      const turned = rotation();
      prop.body.setTranslation(to, false);
      prop.body.setRotation(turned, false);
      if (!this.started) {
        prop.prevPos = to;
        prop.prevRot = turned;
      }
    }

    pieces.prev.set(pieces.cur);
    let heldChanged = false;
    for (let changed = u16(); changed > 0; changed--) {
      const i = u16();
      if (i >= pieces.count) throw new Error('The snapshot is for a different field.');
      const held = view.getInt8(at++);
      const moved = held !== pieces.heldBy[i];
      if (moved) heldChanged = true;
      pieces.heldBy[i] = held;
      pieces.cur[i * 3] = i16() / MM;
      pieces.cur[i * 3 + 1] = i16() / MM;
      pieces.cur[i * 3 + 2] = i16() / MM;
      // A piece that has just come out of a robot or a goal appears where it is, not sliding in from where it went in.
      if (!this.started || moved) pieces.prev.set(pieces.cur.subarray(i * 3, i * 3 + 3), i * 3);
    }
    if (heldChanged || !this.started) {
      for (const robot of robots) robot.held.length = 0;
      for (let i = 0; i < pieces.count; i++) {
        if (pieces.heldBy[i] >= 0) robots[pieces.heldBy[i]]?.held.push(i);
      }
    }

    this.tick = tick;
    this.started = true;
  }
}

/** The host's clock, score and goal lights. */
export function matchState(sim: SimWorld): MatchState | null {
  const { match, rules } = sim;
  if (!match || !rules) return null;
  return {
    phaseIndex: match.phaseIndex,
    phaseElapsed: match.phaseElapsed,
    elapsed: match.elapsed,
    finished: match.finished,
    points: match.points,
    counts: match.counts,
    solo: sim.robots.map((_, i) => match.solo[i] ?? 0),
    status: { blue: rules.status(sim, 'blue'), red: rules.status(sim, 'red') },
    bonuses: { blue: rules.bonuses(sim, 'blue'), red: rules.bonuses(sim, 'red') },
  };
}

/** Sets a player's copy of the match to what the host says. */
export function applyMatchState(sim: SimWorld, state: MatchState): void {
  const { match } = sim;
  if (!match) return;
  match.phaseIndex = Math.min(Math.max(0, Math.floor(state.phaseIndex)), match.phases.length - 1);
  match.phaseElapsed = state.phaseElapsed;
  match.elapsed = state.elapsed;
  match.finished = state.finished;
  match.solo.length = 0;
  for (const points of Array.isArray(state.solo) ? state.solo : []) match.solo.push(Number(points) || 0);
  for (const alliance of ['blue', 'red'] as const) {
    for (const [from, to] of [
      [state.points, match.points],
      [state.counts, match.counts],
    ]) {
      for (const key of Object.keys(to[alliance])) delete to[alliance][key];
      Object.assign(to[alliance], from[alliance]);
    }
  }
}
