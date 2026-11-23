import RAPIER from '@dimforge/rapier3d-compat';
import { frameTop } from '../../robots/chassis';
import type { SubsystemDef } from '../../robots/types';
import { add, clamp, dot, quatFromYaw, rotate, scale, sub, v3, wrapAngle, type Vec3 } from '../math';
import {
  numberOr,
  resolveSettings,
  shapeCenter,
  shapeFields,
  shapePart,
  type PartView,
  type Shape,
  type Side,
  type Subsystem,
  type SubsystemContext,
  type SubsystemEnv,
  type SubsystemSpec,
} from './types';

interface ShooterSettings extends Shape {
  face: Side;
  yaw: number;
  pitch: number;
  speed: number;
  rate: number;
  lanes: number;
  spread: number;
  timingJitter: number;
  moveAccuracy: number;
  turret: boolean;
  turretSpeed: number;
  autoRange: boolean;
  slowInAuto: boolean;
  autoRate: number;
  tiltCorrection: boolean;
  /** Seconds the shooter waits once it is lined up before the first shot. */
  aimDelay: number;
}

const GRAVITY = 9.81;
const DEG = Math.PI / 180;
/** Direction each face of the robot points, in degrees counter-clockwise from the front. */
const FACE_ANGLE: Record<Side, number> = { front: 0, left: 90, back: 180, right: -90 };
/** How hard a fixed shooter's robot turns toward its target: turn rate per radian of error. */
const TURN_GAIN = 8;
/** A fixed shooter holds its fire until the robot points this close to the target. */
const FIRE_WINDOW = 3 * DEG;
/** A piece leaves this far along the launch direction from the top of the box. */
const RELEASE_OFFSET = 0.12;
/** The share of its speed a shot keeps when it is blocked the moment it leaves. */
const BLOCKED_BOUNCE = 0.2;
/** A shooter that adjusts its launch angle never goes flatter than this. */
const MIN_PITCH = 10 * DEG;

/**
 * The launch angle and speed that carry a piece from the top of the shooter
 * to a point `distance` away and `rise` higher. The shooter's own angle is
 * the steepest it can launch at. It is used whenever the shot can reach;
 * a shot too far for the top speed at that angle is launched flatter, by as
 * little as it takes.
 */
export function launchFor(distance: number, rise: number, maxPitch: number, topSpeed: number): { pitch: number; speed: number } {
  // The speed whose arc at this angle passes through the point, measured from where the piece is let go.
  const speedAt = (pitch: number): number => {
    const d = distance - RELEASE_OFFSET * Math.cos(pitch);
    const h = rise - RELEASE_OFFSET * Math.sin(pitch);
    const denominator = 2 * Math.cos(pitch) ** 2 * (d * Math.tan(pitch) - h);
    return denominator > 0 && d > 0 ? Math.sqrt((GRAVITY * d ** 2) / denominator) : Infinity;
  };
  const steepest = speedAt(maxPitch);
  if (steepest <= topSpeed) return { pitch: maxPitch, speed: steepest };

  // At top speed, the steepest angle that still reaches. If none does, the angle that carries furthest.
  const v2 = topSpeed ** 2;
  const reach = v2 ** 2 - GRAVITY * (GRAVITY * distance ** 2 + 2 * rise * v2);
  const tangent = (v2 + Math.sqrt(Math.max(0, reach))) / (GRAVITY * Math.max(distance, 0.01));
  let pitch = clamp(Math.atan(tangent), Math.min(MIN_PITCH, maxPitch), maxPitch);
  // The piece is let go a little way along the launch direction, which the formula above leaves out.
  for (let i = 0; i < 4 && reach > 0; i++) {
    const needed = speedAt(pitch);
    if (needed <= topSpeed) break;
    pitch = Math.max(Math.min(MIN_PITCH, maxPitch), pitch - 0.5 * DEG);
  }
  return { pitch, speed: Math.min(topSpeed, speedAt(pitch)) };
}

interface Aim {
  /** Where the middle of the shooter's top is, in the world. */
  muzzle: Vec3;
  /** World direction to launch in, counter-clockwise from +X. Null when there is nothing to aim at. */
  bearing: number | null;
  speed: number;
  /** Launch angle above level, in radians. */
  pitch: number;
}

/**
 * Launches held game pieces from the top of its box. A fixed shooter fires out
 * of one face of the robot, and the robot turns that face toward the target
 * while shooting. A turret turns its own box instead.
 */
class Shooter implements Subsystem {
  readonly type = 'shooter';
  readonly parts: PartView[];
  /** Time until each lane can fire again. Lanes run on their own clocks, so shots come out staggered. */
  private readonly cooldowns: number[];
  private firing = false;
  private aimingToPass = false;

  /** Whether it is firing right now. */
  get shooting(): boolean {
    return this.firing;
  }

  /** Whether it is aiming at a spot to pass to rather than its goal. */
  get passing(): boolean {
    return this.aimingToPass;
  }
  /** Seconds the shooter has been lined up with shoot held. */
  private linedUpFor = 0;
  /** Launch direction in the robot's own space. */
  private yaw: number;
  private readonly restYaw: number;
  /** Middle of the top of the box, in the robot's own space. */
  private readonly muzzle: Vec3;
  /** How far apart side-by-side shots leave the box. */
  private readonly laneSpacing: number;
  /** Target direction on the previous step, to tell how fast it is moving round. */
  private lastBearing: number | null = null;
  /** How fast the target direction is moving round the robot, in radians per second. */
  private sweep = 0;

  constructor(
    private readonly settings: ShooterSettings,
    env: SubsystemEnv,
  ) {
    const { robot } = env;
    this.restYaw = (FACE_ANGLE[settings.face] + settings.yaw) * DEG;
    this.yaw = this.restYaw;
    const center = shapeCenter(settings, robot);
    this.muzzle = v3(center.x, center.y + settings.sizeY / 2, center.z);
    // Lanes share the box's extent across the direction it shoots in.
    const across = Math.abs(Math.sin(this.restYaw)) * settings.sizeX + Math.abs(Math.cos(this.restYaw)) * settings.sizeZ;
    this.laneSpacing = across / settings.lanes;
    this.parts = [shapePart(settings, robot)];
    this.cooldowns = new Array<number>(settings.lanes).fill(0);
  }

  /**
   * Works out where to launch. "Shoot on the Move" is the share of the
   * robot's own motion that the aim cancels out: at 100% a shot fired while
   * driving still lands, at 0% it drifts with the robot.
   */
  private solve({ sim, robot }: SubsystemContext): Aim {
    const s = this.settings;
    const muzzle = add(robot.position(), rotate(robot.rotation(), this.muzzle));
    const aim = sim.aimFor(robot.alliance, muzzle, robot);
    this.aimingToPass = aim?.pass === true;
    const fixedPitch = s.pitch * DEG;
    if (!aim) return { muzzle, bearing: null, speed: s.speed, pitch: fixedPitch };
    const target = aim.point;
    // A pass is lobbed to a spot on the floor, so its speed always suits the distance.
    const ranging = s.autoRange || aim.pass;

    const launch = (point: Vec3): { pitch: number; speed: number } => {
      if (!ranging) return { pitch: fixedPitch, speed: s.speed };
      // Pick the launch whose arc passes through the point.
      const distance = Math.hypot(point.x - muzzle.x, point.z - muzzle.z);
      return launchFor(distance, point.y - muzzle.y, fixedPitch, s.speed);
    };

    // Aim at where the target appears to be once the robot's motion is taken off the shot.
    const share = s.moveAccuracy / 100;
    const drift = robot.pointVelocity(muzzle);
    let point = target;
    let shot = launch(point);
    for (let i = 0; i < 3 && share > 0; i++) {
      const distance = Math.hypot(point.x - muzzle.x, point.z - muzzle.z);
      const flightTime = distance / (shot.speed * Math.cos(shot.pitch));
      point = v3(target.x - drift.x * flightTime * share, target.y, target.z - drift.z * flightTime * share);
      shot = launch(point);
    }
    return { muzzle, bearing: Math.atan2(-(point.z - muzzle.z), point.x - muzzle.x), ...shot };
  }

  /** For a fixed shooter: how fast the robot should turn so its shooting face points at the target. */
  chassisTurn(ctx: SubsystemContext): number | null {
    if (this.settings.turret) return null;
    const { bearing } = this.solve(ctx);
    if (bearing === null) return null;
    const error = wrapAngle(bearing - ctx.robot.heading() - this.yaw);
    // Following a target that is moving round the robot takes "Shoot on the Move".
    // Smoothed, because the robot's speed (and with it the aim) jitters from step to step.
    const measured = this.lastBearing === null ? 0 : wrapAngle(bearing - this.lastBearing) / ctx.dt;
    this.sweep += (measured - this.sweep) * 0.2;
    this.lastBearing = bearing;
    return TURN_GAIN * error + (this.settings.moveAccuracy / 100) * this.sweep;
  }

  step(ctx: SubsystemContext): void {
    const { sim, robot, input, dt } = ctx;
    const s = this.settings;
    const aim = this.solve(ctx);
    const share = s.moveAccuracy / 100;
    if (!input.shoot) {
      this.lastBearing = null;
      this.sweep = 0;
    }

    let error = 0;
    if (aim.bearing !== null) {
      // A good turret also allows for how far the robot will have turned by the next step.
      const heading = robot.heading() + (s.turret ? share * robot.body.angvel().y * dt : 0);
      error = wrapAngle(aim.bearing - heading - this.yaw);
      if (s.turret) {
        const maxStep = s.turretSpeed * DEG * dt;
        const turn = clamp(error, -maxStep, maxStep);
        this.yaw = wrapAngle(this.yaw + turn);
        error -= turn;
      }
    }
    // The box turns with the turret, so it faces what it is aiming at.
    this.parts[0].yaw = this.yaw - this.restYaw;

    for (let lane = 0; lane < s.lanes; lane++) this.cooldowns[lane] = Math.max(0, this.cooldowns[lane] - dt);
    // A fixed shooter waits for the robot to come round to the target (unless the
    // driver has taken over the aiming). A robot that
    // cannot keep up with a moving aim fires anyway, as far behind as it normally trails.
    const trailing = (1.5 * (1 - share) * Math.abs(this.sweep)) / TURN_GAIN;
    // Some robots are set to fire at a different rate while they drive themselves.
    const rate = s.slowInAuto && sim.match?.phase.id === 'auto' ? s.autoRate : s.rate;
    const wasFiring = this.firing;
    // A turret normally fires while it is still turning. Given an aim delay, it lines up first, like a fixed shooter.
    const lined = !robot.autoAim || Math.abs(error) <= FIRE_WINDOW + trailing || (s.turret && s.aimDelay <= 0);
    // Once lined up, it waits out its aim delay before the first shot, and again whenever it loses the target.
    this.linedUpFor = input.shoot && lined ? this.linedUpFor + dt : 0;
    this.firing = input.shoot && lined && this.linedUpFor >= s.aimDelay - 1e-9;
    if (!this.firing) return;

    if (!wasFiring) {
      // Lanes start one after another in a random order, not all together.
      const order = this.cooldowns.map((_, lane) => lane);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(sim.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      order.forEach((lane, turn) => {
        this.cooldowns[lane] = Math.max(this.cooldowns[lane], turn / (s.lanes * rate));
      });
    }

    const rot = robot.rotation();
    // A shooter that corrects for tilt launches as if the robot stood level, however it is leaning.
    const launchRot = s.tiltCorrection ? quatFromYaw(robot.heading()) : rot;
    const pitch = aim.pitch;
    const wobble = () => (sim.random() - 0.5) * 2 * s.spread * DEG;
    for (let lane = 0; lane < s.lanes; lane++) {
      if (this.cooldowns[lane] > 0) continue;
      const piece = robot.takePiece();
      if (piece === undefined) break;
      const shotYaw = this.yaw + wobble();
      const shotPitch = pitch + wobble();
      const dir = rotate(
        launchRot,
        v3(Math.cos(shotPitch) * Math.cos(shotYaw), Math.sin(shotPitch), -Math.cos(shotPitch) * Math.sin(shotYaw)),
      );
      // Side-by-side shots leave in a row across the launch direction.
      const offset = (lane - (s.lanes - 1) / 2) * this.laneSpacing;
      const from = add(aim.muzzle, rotate(rot, v3(Math.sin(this.yaw) * offset, 0, Math.cos(this.yaw) * offset)));
      // The piece inherits the robot's own motion, so shooting on the move drifts.
      const own = robot.pointVelocity(from);
      const velocity = add(own, scale(dir, aim.speed));
      const radius = sim.pieces.radii[piece];
      // The piece appears a little way out from the shooter. Anything solid in that gap, such as
      // another robot's shot blocker held right against the shooter, stops it there instead.
      const hit = sim.world.castRayAndGetNormal(
        new RAPIER.Ray(from, dir),
        RELEASE_OFFSET + radius,
        true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        robot.body,
        (collider) => {
          const body = collider.parent();
          return !body || body.isFixed() || sim.robots.some((other) => other !== robot && other.body === body);
        },
      );
      if (hit) {
        // Knocked back off what it hit, with most of its speed lost.
        const normal = v3(hit.normal.x, hit.normal.y, hit.normal.z);
        const shot = scale(dir, aim.speed);
        const bounced = sub(shot, scale(normal, 2 * dot(shot, normal)));
        const at = add(from, scale(dir, Math.max(0, hit.timeOfImpact - radius)));
        sim.pieces.release(piece, at, add(own, scale(bounced, BLOCKED_BOUNCE)));
      } else {
        sim.pieces.release(piece, add(from, scale(dir, RELEASE_OFFSET)), velocity);
        sim.pieces.launch(piece, robot.index);
      }
      // Uneven gaps keep the lanes from falling back into step. The average rate is unchanged.
      this.cooldowns[lane] = (1 + (sim.random() - 0.5) * 2 * (s.timingJitter / 100)) / rate;
    }
  }

  reset(): void {
    this.linedUpFor = 0;
    this.cooldowns.fill(0);
    this.firing = false;
    this.yaw = this.restYaw;
    this.lastBearing = null;
    this.sweep = 0;
    this.parts[0].yaw = 0;
  }
}

export const shooterSpec: SubsystemSpec = {
  type: 'shooter',
  label: 'Shooter',
  description:
    'Fires held game pieces from the top of this box while the shoot button is held. The robot turns the chosen face toward the target; a turret turns its own box instead. Outside its own zone it passes pieces back there.',
  fields: [
    ...shapeFields('#f97316'),
    {
      key: 'face',
      label: 'Face that aims at the target',
      kind: 'choice',
      default: 'front',
      options: [
        { value: 'front', label: 'Front' },
        { value: 'back', label: 'Back' },
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
      ],
    },
    { key: 'yaw', label: 'Angle off that face', kind: 'number', default: 0, min: -45, max: 45, unit: '°' },
    { key: 'pitch', label: 'Steepest launch angle', kind: 'number', default: 60, min: 10, max: 85, unit: '°' },
    { key: 'speed', label: 'Top launch speed', kind: 'number', default: 9, min: 1, max: 18, unit: 'm/s' },
    { key: 'lanes', label: 'Pieces wide', kind: 'number', default: 1, min: 1, max: 6, step: 1, unit: 'lanes' },
    { key: 'rate', label: 'Fire rate, each lane', kind: 'number', default: 6, min: 0.5, max: 32, unit: 'pieces/s' },
    { key: 'spread', label: 'Inaccuracy', kind: 'number', default: 1.5, min: 0, max: 15, unit: '°' },
    { key: 'timingJitter', label: 'Uneven shot timing', kind: 'number', default: 30, min: 0, max: 90, step: 1, unit: '%' },
    { key: 'aimDelay', label: 'Aim delay: wait once lined up before shooting', kind: 'number', default: 0, min: 0, max: 3, step: 0.05, unit: 's' },
    { key: 'moveAccuracy', label: 'Shoot on the Move', kind: 'number', default: 50, min: 0, max: 100, step: 1, unit: '%' },
    { key: 'turret', label: 'Turret', kind: 'boolean', default: false },
    { key: 'turretSpeed', label: 'Turret turn speed', kind: 'number', default: 360, min: 30, max: 1080, step: 10, unit: '°/s', showIf: 'turret' },
    { key: 'autoRange', label: 'Adjusts speed and angle for distance', kind: 'boolean', default: false },
    { key: 'slowInAuto', label: 'Different fire rate in auto', kind: 'boolean', default: false },
    { key: 'autoRate', label: 'Fire rate in auto, each lane', kind: 'number', default: 3, min: 0.5, max: 32, unit: 'pieces/s', showIf: 'slowInAuto' },
    { key: 'tiltCorrection', label: 'Corrects for the robot leaning (on the bump or on fuel)', kind: 'boolean', default: false },
  ],
  upgrade: (def, chassis) => {
    // Older files gave a position and a release height; the box's top is the release point.
    const bottom = frameTop(chassis);
    const upgraded: SubsystemDef = {
      x: numberOr(def.offsetX, 0),
      z: numberOr(def.offsetZ, 0),
      bottom,
      sizeX: 0.28,
      sizeZ: 0.28,
      sizeY: Math.max(0.05, numberOr(def.height, 0.6) - bottom),
      ...def,
    };
    // Older files gave one aim direction; it becomes the nearest face plus the angle left over.
    if (def.face === undefined) {
      const yaw = numberOr(def.yaw, 0);
      const face = (Object.keys(FACE_ANGLE) as Side[]).reduce((best, side) =>
        Math.abs(wrapAngle((yaw - FACE_ANGLE[side]) * DEG)) < Math.abs(wrapAngle((yaw - FACE_ANGLE[best]) * DEG)) ? side : best,
      );
      upgraded.face = face;
      upgraded.yaw = wrapAngle((yaw - FACE_ANGLE[face]) * DEG) / DEG;
    }
    return upgraded;
  },
  create: (def: SubsystemDef, env) =>
    new Shooter(resolveSettings<ShooterSettings>(shooterSpec, def, env.robot.def.chassis), env),
};
