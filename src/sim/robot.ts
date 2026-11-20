import RAPIER, { type RigidBody, type World } from '@dimforge/rapier3d-compat';
import type { Alliance, Spawn } from '../games/types';
import type { DriverInput } from '../input/types';
import { bumpersOf, outlineOf } from '../robots/chassis';
import type { RobotDefinition } from '../robots/types';
import { swerveCommands } from './drivetrain/swerve';
import { tankCommands } from './drivetrain/tank';
import { applyWheelForces, buildRig, type WheelRig, type WheelState } from './drivetrain/wheels';
import { add, clamp, cross, quatFromYaw, sub, v3, yawOf, type Quat, type Vec3 } from './math';
import { createSubsystems } from './subsystems';
import type { Subsystem } from './subsystems/types';
import { FIELD_ONLY_GROUPS, LOOSE_ONLY_GROUPS, LOW_BAR_ONLY_GROUPS, MOVING_GROUPS, underLowBars } from './groups';
import type { SimWorld } from './world';

/** How far above the carpet the skirt under the frame stops. */
const SKIRT_GAP = 0.015;

/** How tall a robot labelled as a bump robot counts as, for low bars only. */
const BUMP_ROBOT_HEIGHT = 1.0;

export class SimRobot {
  readonly body: RigidBody;
  readonly rig: WheelRig;
  readonly wheels: WheelState[];
  readonly alliance: Alliance;
  /** Half the outside size of the robot, bumpers included. */
  readonly half: Vec3;
  readonly subsystems: Subsystem[];
  /** Indices of the game pieces currently inside the robot. */
  readonly held: number[] = [];
  fieldCentric = true;
  /** Whether a fixed shooter may turn the robot toward its target while shooting. */
  autoAim = true;
  /** Collision groups for this robot's solid parts, and for parts only the field can feel. */
  readonly movingGroups: number;
  readonly fieldOnlyGroups: number;
  /** True while a climber is holding the robot on a tower; the wheels do nothing. */
  climbing = false;

  /** Pose before the latest step, so the renderer can blend between steps. */
  prevPos: Vec3;
  prevRot: Quat;

  private readonly lastDirs: Vec3[];

  constructor(
    world: World,
    readonly def: RobotDefinition,
    private readonly spawn: Spawn,
    private readonly dt: number,
    /** Position of this robot in the world's robot list. */
    readonly index: number,
  ) {
    const { chassis } = def;
    this.alliance = spawn.alliance;
    this.rig = buildRig(def, dt);
    this.wheels = this.rig.mounts.map((localPos) => ({ localPos, steer: 0, grounded: false }));
    this.lastDirs = this.rig.mounts.map(() => v3(1, 0, 0));

    const outline = outlineOf(chassis);
    const bumpers = bumpersOf(chassis);
    const hx = (outline.front + outline.back) / 2;
    const hy = chassis.height / 2;
    const hz = (outline.left + outline.right) / 2;
    this.half = v3(hx, hy, hz);
    const comHeight = chassis.comHeight ?? this.rig.rideHeight - hy * 0.5;
    const m = chassis.mass / 12;
    const inertia = v3(
      m * (4 * hy * hy + 4 * hz * hz),
      m * (4 * hx * hx + 4 * hz * hz),
      m * (4 * hx * hx + 4 * hy * hy),
    );

    // A robot labelled as a trench robot ignores low bars altogether.
    const underBars = def.traversal === 'trench';
    this.movingGroups = underBars ? underLowBars(MOVING_GROUPS) : MOVING_GROUPS;
    this.fieldOnlyGroups = underBars ? underLowBars(FIELD_ONLY_GROUPS) : FIELD_ONLY_GROUPS;

    const start = this.startPose();
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(start.pos.x, start.pos.y, start.pos.z)
        .setRotation(start.rot)
        .setCanSleep(false)
        .setAdditionalMassProperties(
          chassis.mass,
          v3(0, comHeight - this.rig.rideHeight, 0),
          inertia,
          { x: 0, y: 0, z: 0, w: 1 },
        ),
    );
    // Mass comes from the definition, not from the collider's volume.
    const solid = (halfX: number, halfY: number, halfZ: number) =>
      RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
        .setDensity(0)
        .setFriction(0.25)
        .setRestitution(0.05)
        .setCollisionGroups(this.movingGroups);
    const round = chassis.round === true;
    // A round frame is a disc; its bumper is a wider disc around the bottom of it.
    const disc = (radius: number, halfY: number) =>
      RAPIER.ColliderDesc.cylinder(halfY, radius)
        .setDensity(0)
        .setFriction(0.25)
        .setRestitution(0.05)
        .setCollisionGroups(this.movingGroups);
    if (round) {
      world.createCollider(disc(chassis.length / 2, hy), this.body);
      if (hx > chassis.length / 2) {
        world.createCollider(disc(hx, bumpers.height / 2).setTranslation(0, -hy + bumpers.height / 2, 0), this.body);
      }
    } else {
      world.createCollider(solid(chassis.length / 2, hy, chassis.width / 2), this.body);
    }
    // The bumpers are a band around the bottom of the frame, and can differ on each side.
    if (!round && (hx > chassis.length / 2 || hz > chassis.width / 2)) {
      world.createCollider(
        solid(hx, bumpers.height / 2, hz).setTranslation(
          (outline.front - outline.back) / 2,
          -hy + bumpers.height / 2,
          (outline.right - outline.left) / 2,
        ),
        this.body,
      );
    }

    // A robot labelled as a bump robot is stopped by low bars even if it is short enough.
    if (def.traversal === 'bump') {
      const tall = BUMP_ROBOT_HEIGHT - chassis.groundClearance;
      world.createCollider(
        (round ? RAPIER.ColliderDesc.cylinder(tall / 2, chassis.length / 2) : RAPIER.ColliderDesc.cuboid(chassis.length / 2, tall / 2, chassis.width / 2))
          .setTranslation(0, -hy + tall / 2, 0)
          .setDensity(0)
          .setCollisionGroups(LOW_BAR_ONLY_GROUPS),
        this.body,
      );
    }

    // A skirt from the frame down to just above the carpet, which only loose
    // objects can touch. Without it a ball can wedge under a bare frame edge
    // and jack the robot off its wheels.
    const skirtHeight = Math.max(0, chassis.groundClearance - SKIRT_GAP);
    if (skirtHeight > 0.005) {
      world.createCollider(
        (round ? RAPIER.ColliderDesc.cylinder(skirtHeight / 2, hx) : RAPIER.ColliderDesc.cuboid(hx, skirtHeight / 2, hz))
          .setTranslation((outline.front - outline.back) / 2, -hy - skirtHeight / 2, (outline.right - outline.left) / 2)
          .setDensity(0)
          .setFriction(0.1)
          .setCollisionGroups(LOOSE_ONLY_GROUPS),
        this.body,
      );
    }

    this.prevPos = start.pos;
    this.prevRot = start.rot;
    this.subsystems = createSubsystems(def.subsystems, { world, robot: this });
  }

  /** Remembers the current pose, then applies this step's drive forces and runs the subsystems. */
  step(sim: SimWorld, input: DriverInput): void {
    this.prevPos = this.position();
    this.prevRot = this.rotation();

    const rot = this.rotation();
    const drivetrain = this.def.drivetrain;
    const drive = this.aimedInput(sim, input);
    const commands =
      drivetrain.type === 'swerve'
        ? swerveCommands(drivetrain, drive, {
            rot,
            mounts: this.rig.mounts,
            fieldCentric: this.fieldCentric,
            driverSign: this.alliance === 'blue' ? 1 : -1,
            lastDirs: this.lastDirs,
          })
        : tankCommands(drivetrain, drive, rot, this.rig.mounts);
    if (!this.climbing) applyWheelForces(sim.world, this.body, this.rig, commands, this.wheels, this.dt);

    for (const subsystem of this.subsystems) subsystem.step({ sim, robot: this, input, dt: this.dt });
  }

  /**
   * While the shoot button is held, a fixed shooter steers the robot toward
   * its target in place of the driver's turn stick. Driving is unchanged.
   */
  private aimedInput(sim: SimWorld, input: DriverInput): DriverInput {
    if (!input.shoot || this.climbing || !this.autoAim) return input;
    for (const subsystem of this.subsystems) {
      const rate = subsystem.chassisTurn?.({ sim, robot: this, input, dt: this.dt });
      if (rate === null || rate === undefined) continue;
      const drivetrain = this.def.drivetrain;
      if (drivetrain.type === 'swerve') {
        return { ...input, turn: clamp(-rate / drivetrain.maxAngularSpeed, -1, 1) };
      }
      // A tank drive turns by running its sides at different speeds.
      const fastest = (2 * (drivetrain.turnScale ?? 0.6) * drivetrain.maxSpeed) / drivetrain.trackWidth;
      return { ...input, driveX: 0, turn: clamp(-rate / fastest, -1, 1) };
    }
    return input;
  }

  /** Puts the robot back on its starting spot, upright and stopped. Held pieces stay held. */
  reset(): void {
    for (const subsystem of this.subsystems) subsystem.reset();
    const start = this.startPose();
    this.body.setTranslation(start.pos, true);
    this.body.setRotation(start.rot, true);
    this.body.setLinvel(v3(), true);
    this.body.setAngvel(v3(), true);
    this.prevPos = start.pos;
    this.prevRot = start.rot;
  }

  /** The highest tower level any of this robot's climbers has reached (0 when on the floor). */
  climbLevel(): number {
    return Math.max(0, ...this.subsystems.map((subsystem) => subsystem.climbLevel ?? 0));
  }

  /** How many game pieces the robot can hold right now. */
  capacity(): number {
    return this.subsystems.reduce((total, subsystem) => total + (subsystem.capacity?.() ?? 0), 0);
  }

  /** Takes a loose piece into the robot. Returns false when it is full. */
  store(sim: SimWorld, piece: number): boolean {
    if (this.held.length >= this.capacity()) return false;
    sim.pieces.hold(piece, this.index);
    this.held.push(piece);
    return true;
  }

  /** Removes one held piece so a subsystem can release it. */
  takePiece(): number | undefined {
    return this.held.pop();
  }

  position(): Vec3 {
    const t = this.body.translation();
    return v3(t.x, t.y, t.z);
  }

  rotation(): Quat {
    const r = this.body.rotation();
    return { x: r.x, y: r.y, z: r.z, w: r.w };
  }

  /** Velocity of a point that moves with the robot, given in world space. */
  pointVelocity(worldPoint: Vec3): Vec3 {
    return add(this.body.linvel(), cross(this.body.angvel(), sub(worldPoint, this.body.worldCom())));
  }

  /** Ground speed in metres per second. */
  speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.z);
  }

  /** Heading in radians, counter-clockwise from +X. */
  heading(): number {
    return yawOf(this.rotation());
  }

  private startPose(): { pos: Vec3; rot: Quat } {
    return {
      pos: v3(this.spawn.x, this.rig.rideHeight + 0.01, this.spawn.z),
      rot: quatFromYaw(this.spawn.yaw),
    };
  }
}
