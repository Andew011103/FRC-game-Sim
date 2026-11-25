import { bumperOutline, cornerCuts, frameOutline, hasShapedCorners, type Point } from '../robots/outline';
import * as THREE from 'three';
import type { Alliance, BoxElement, GoalLight } from '../games/types';
import { bumpersOf } from '../robots/chassis';
import type { PieceSet } from '../sim/pieces';
import { PieceEffects } from './pieceEffects';
import type { RobotDefinition } from '../robots/types';
import { FUEL } from '../games/rebuilt-2026/field';

const FUEL_RADIUS = FUEL.radius;
const FUEL_COLOR = FUEL.color;
/** How long the ball in an effect window takes to cross it. */
const EFFECT_FLIGHT_SECONDS = 1.4;

interface EffectWindow {
  elementId: string;
  group: THREE.Group;
  mesh: THREE.InstancedMesh;
  effects: PieceEffects;
  pieces: PieceSet;
  shooter: SimRobot;
  phase: number;
  time: number;
}
import type { SimRobot } from '../sim/robot';
import type { PartView } from '../sim/subsystems/types';
import type { SimWorld } from '../sim/world';

/** How far the angled camera sits from the robot, in meters, along the way it looks. */
const ANGLED_DISTANCE = 4.8;

export type CameraMode = 'driver' | 'follow' | 'angled' | 'top' | 'orbit' | 'inspect';

interface RobotView {
  robot: SimRobot;
  group: THREE.Group;
  steerGroups: THREE.Group[];
  parts: { part: PartView; mesh: THREE.Mesh; color: string }[];
  /** A ring of light on the floor around the robot while its power-up is on. */
  aura: THREE.Mesh | null;
}

export type Quality = 'low' | 'medium' | 'high';

const QUALITY_SETTINGS: Record<Quality, { shadowMapSize: number; pieceShadows: boolean; maxPixelRatio: number }> = {
  low: { shadowMapSize: 0, pieceShadows: false, maxPixelRatio: 1 },
  medium: { shadowMapSize: 1024, pieceShadows: false, maxPixelRatio: 1.5 },
  high: { shadowMapSize: 2048, pieceShadows: true, maxPixelRatio: 2 },
};

const ALLIANCE_COLORS = { blue: 0x2f6fed, red: 0xe5484d };
const FOV = 55;

const BACKGROUND = new THREE.Color(0x0b0d12);
/** Color of a light bar that is switched off. */
const UNLIT = '#111827';

/** Draws a SimWorld. Reads simulation state and never changes it. */
export class SceneView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 200);
  private content = new THREE.Group();
  /** The floor and everything fixed to it; hidden when a robot is shown by itself. */
  private fieldGroup = new THREE.Group();
  /** Robots drawn by themselves in boxes on the page, outside the field's own content. */
  private windowGroup = new THREE.Group();
  private windows: { elementId: string; view: RobotView; spin: boolean }[] = [];
  /** Windows showing one fuel ball flying with a game piece effect, to show what an effect looks like. */
  private effectWindows: EffectWindow[] = [];
  private readonly windowCamera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 50);
  /** Background of screens that show no field. */
  private readonly plainColor = new THREE.Color(0x0b0d12);
  private inspecting = false;
  private robotViews: RobotView[] = [];
  private playerIndex = 0;
  private propViews: THREE.Mesh[] = [];
  private pieceMesh: THREE.InstancedMesh | null = null;
  private pieceEffects: PieceEffects | null = null;
  private readonly bufferSize = new THREE.Vector2();
  /** Whether game piece effects are drawn at all, a player's own choice. */
  private showPieceEffects = true;
  private readonly tagged = new Map<string, { material: THREE.MeshStandardMaterial; color: string }[]>();
  private field ={ length: 16.54, width: 8.07 };
  private readonly sun = new THREE.DirectionalLight(0xffffff, 1.6);
  private quality: Quality | null = null;
  private driverStationZ = 0;
  /** Which driver station the driver camera stands at: 1 to 3, from the driver's left. */
  private driverStation = 1;
  private lastTime = 0;
  private followReady = false;
  private readonly followPos = new THREE.Vector3();
  private readonly followLook = new THREE.Vector3();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = BACKGROUND;
    this.scene.fog = new THREE.Fog(0x0b0d12, 30, 70);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1c22, 1.1));

    const sun = this.sun;
    sun.position.set(-6, 14, 5);
    const shadowCam = sun.shadow.camera;
    shadowCam.left = -11;
    shadowCam.right = 11;
    shadowCam.top = 7;
    shadowCam.bottom = -7;
    shadowCam.near = 1;
    shadowCam.far = 40;
    this.scene.add(sun);

    this.scene.add(this.content);
    this.setQuality('high');
  }

  /** Trades looks for speed. Shadows and screen resolution are the two big costs. */
  setQuality(quality: Quality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    const settings = QUALITY_SETTINGS[quality];

    this.sun.castShadow = settings.shadowMapSize > 0;
    if (settings.shadowMapSize > 0 && this.sun.shadow.mapSize.x !== settings.shadowMapSize) {
      this.sun.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
      // The shadow texture is rebuilt at the new size on the next frame.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (this.pieceMesh) this.pieceMesh.castShadow = settings.pieceShadows;

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.maxPixelRatio));
    this.resize();
  }

  /** Rebuilds every mesh for a newly created world. */
  setWorld(sim: SimWorld): void {
    this.pieceEffects?.dispose();
    this.pieceEffects = null;
    disposeGroup(this.content);
    this.scene.remove(this.content);
    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.field = sim.game.field;
    this.driverStationZ = sim.game.field.driverStationZ ?? 0;
    this.followReady = false;

    this.fieldGroup = new THREE.Group();
    this.content.add(this.fieldGroup);
    this.fieldGroup.add(buildFloor(this.field.length, this.field.width, sim.game.field.zoneDepth ?? 3));
    this.tagged.clear();
    for (const element of sim.statics) {
      const mesh = boxMesh(element);
      this.fieldGroup.add(mesh);
      if (element.tag) {
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.emissive.set(element.color);
        const list = this.tagged.get(element.tag) ?? [];
        list.push({ material, color: element.color });
        this.tagged.set(element.tag, list);
      }
    }

    this.propViews = sim.props.map((prop) => {
      const mesh = boxMesh(prop.def);
      this.content.add(mesh);
      return mesh;
    });

    this.robotViews = sim.robots.map((robot) => {
      const view = buildRobotView(robot);
      this.content.add(view.group);
      return view;
    });

    this.pieceMesh = buildPieceMesh(sim.pieces);
    if (this.pieceMesh) {
      this.pieceMesh.castShadow = QUALITY_SETTINGS[this.quality ?? 'high'].pieceShadows;
      this.content.add(this.pieceMesh);
      this.pieceEffects = new PieceEffects(sim.pieces);
      this.content.add(this.pieceEffects.points);
    }
  }

  /**
   * Sets how the light bars carrying a tag look: steady in their own color,
   * pulsing, their own color with a white light running along them, or dark.
   */
  setTagLight(tag: string, light: GoalLight, time: number): void {
    const bars = this.tagged.get(tag) ?? [];
    const pulse = 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(time * Math.PI * 4));
    const runner = Math.floor(time * 12) % Math.max(1, bars.length);
    bars.forEach(({ material, color }, i) => {
      material.color.set(light === 'off' ? UNLIT : light === 'white' ? '#ffffff' : color);
      // The running white light is two bars long.
      const white = light === 'white' || (light === 'chase' && (i === runner || i === (runner + 1) % bars.length));
      material.emissive.set(white ? '#ffffff' : color);
      material.emissiveIntensity = light === 'off' ? 0 : light === 'pulse' ? pulse : 1;
    });
  }

  /** Draws one frame. alpha blends between the last two simulation steps. */
  update(sim: SimWorld, alpha: number, mode: CameraMode, time: number): void {
    const frameDt = Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;

    this.robotViews.forEach((view) => poseRobotView(view, alpha));

    if (this.pieceMesh) updatePieceMesh(this.pieceMesh, sim.pieces, alpha);
    if (this.pieceEffects) {
      this.pieceEffects.setScale(this.renderer.getDrawingBufferSize(this.bufferSize).y, this.camera.fov);
      this.pieceEffects.update(sim.pieces, sim.robots, this.pieceMesh, alpha, frameDt, this.showPieceEffects);
    }

    sim.props.forEach((prop, i) => {
      blendPose(this.propViews[i], prop.prevPos, prop.prevRot, prop.body.translation(), prop.body.rotation(), alpha);
    });

    this.frameView(mode);
    this.placeCamera(mode, time, frameDt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Turns every game piece effect on or off, the player's own and everyone else's. */
  setPieceEffects(on: boolean): void {
    this.showPieceEffects = on;
  }

  setPlainColor(color: string): void {
    this.plainColor.set(color);
  }

  /** Sets the robots drawn by themselves in boxes on the page. */
  setWindows(items: { elementId: string; robot: SimRobot; spin: boolean }[]): void {
    disposeGroup(this.windowGroup);
    this.scene.remove(this.windowGroup);
    this.windowGroup = new THREE.Group();
    this.windowGroup.visible = false;
    this.scene.add(this.windowGroup);
    this.windows = items.map((item) => {
      const view = buildRobotView(item.robot);
      poseRobotView(view, 1);
      this.windowGroup.add(view.group);
      return { elementId: item.elementId, view, spin: item.spin };
    });
  }

  /** Sets the windows that show a fuel ball flying with a game piece effect. */
  setEffectWindows(items: { elementId: string; effect: NonNullable<RobotDefinition['pieceEffect']>; alliance: Alliance }[]): void {
    for (const old of this.effectWindows) {
      this.scene.remove(old.group);
      old.effects.dispose();
      disposeGroup(old.group);
    }
    this.effectWindows = items.map((item) => {
      // A stand-in for a field's pieces: one ball, always in the air from a shot by robot 0.
      const pieces = {
        count: 1,
        prev: new Float32Array(3),
        cur: new Float32Array(3),
        heldBy: [-1],
        launchedBy: [0],
        radii: [FUEL_RADIUS],
        colors: [FUEL_COLOR],
      } as unknown as PieceSet;
      const shooter = { def: { pieceEffect: item.effect }, alliance: item.alliance } as unknown as SimRobot;
      const group = new THREE.Group();
      group.visible = false;
      const mesh = buildPieceMesh(pieces)!;
      mesh.castShadow = false;
      const effects = new PieceEffects(pieces);
      group.add(mesh, effects.points);
      this.scene.add(group);
      return { elementId: item.elementId, group, mesh, effects, pieces, shooter, phase: 0, time: -1 };
    });
  }

  /**
   * Draws a screen that has no field: the plain background everywhere, and
   * each window's robot over its box on the page. A box inside a scrolling
   * list is cut off where the list is.
   */
  drawWindows(time: number): void {
    const { renderer, scene } = this;
    const canvas = this.canvas.getBoundingClientRect();
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    scene.background = null;
    renderer.setClearColor(this.plainColor, 1);
    renderer.clear();

    this.content.visible = false;
    this.windowGroup.visible = true;
    renderer.setClearColor(0x000000, 1);
    renderer.setScissorTest(true);
    const camera = this.windowCamera;
    for (const { elementId, view, spin } of this.windows) {
      const element = document.getElementById(elementId);
      const box = element?.getBoundingClientRect();
      if (!element || !box || box.width < 2 || box.height < 2) continue;
      // The part of the box that is actually on show.
      const clip = element.closest('[data-clip]')?.getBoundingClientRect() ?? canvas;
      const left = Math.max(box.left, clip.left, canvas.left);
      const right = Math.min(box.right, clip.right, canvas.right);
      const top = Math.max(box.top, clip.top, canvas.top);
      const bottom = Math.min(box.bottom, clip.bottom, canvas.bottom);
      if (right - left < 1 || bottom - top < 1) continue;

      for (const other of this.windows) other.view.group.visible = other.view === view;
      // WebGL measures up from the bottom of the canvas.
      renderer.setViewport(box.left - canvas.left, canvas.bottom - box.bottom, box.width, box.height);
      renderer.setScissor(left - canvas.left, canvas.bottom - bottom, right - left, bottom - top);
      const angle = spin ? time * 0.35 : 0.9;
      const focus = view.group.position.clone().setY(0.35);
      camera.aspect = box.width / box.height;
      camera.updateProjectionMatrix();
      camera.position.set(focus.x + Math.cos(angle) * 1.75, focus.y + 1.0, focus.z + Math.sin(angle) * 1.75);
      camera.lookAt(focus);
      renderer.render(scene, camera);
    }

    this.windowGroup.visible = false;
    for (const window of this.effectWindows) {
      const element = document.getElementById(window.elementId);
      const box = element?.getBoundingClientRect();
      if (!element || !box || box.width < 2 || box.height < 2) continue;
      const clip = element.closest('[data-clip]')?.getBoundingClientRect() ?? canvas;
      const left = Math.max(box.left, clip.left, canvas.left);
      const right = Math.min(box.right, clip.right, canvas.right);
      const top = Math.max(box.top, clip.top, canvas.top);
      const bottom = Math.min(box.bottom, clip.bottom, canvas.bottom);
      if (right - left < 1 || bottom - top < 1) continue;

      // The ball flies across the window in a gentle arc, over and over, as if just shot.
      const dt = window.time < 0 ? 0 : Math.min(0.1, Math.max(0, time - window.time));
      window.time = time;
      const span = 0.9 * (box.width / box.height);
      const before = window.phase;
      window.phase = (window.phase + dt / EFFECT_FLIGHT_SECONDS) % 1;
      const { cur, prev } = window.pieces;
      cur[0] = -span / 2 - 0.2 + (span + 0.4) * window.phase;
      cur[1] = 0.12 * Math.sin(window.phase * Math.PI);
      cur[2] = 0;
      prev.set(cur);
      // Starting again from the left is a new shot, so no trail is drawn across the window.
      window.pieces.launchedBy[0] = window.phase < before ? -1 : 0;
      window.effects.setScale(box.height * renderer.getPixelRatio(), camera.fov);
      window.effects.update(window.pieces, [window.shooter], window.mesh, 1, dt);
      updatePieceMesh(window.mesh, window.pieces, 1);

      window.group.visible = true;
      renderer.setViewport(box.left - canvas.left, canvas.bottom - box.bottom, box.width, box.height);
      renderer.setScissor(left - canvas.left, canvas.bottom - bottom, right - left, bottom - top);
      camera.aspect = box.width / box.height;
      camera.updateProjectionMatrix();
      camera.position.set(0, 0.05, 0.62);
      camera.lookAt(0, 0.05, 0);
      renderer.render(scene, camera);
      window.group.visible = false;
    }

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    scene.background = BACKGROUND;
    this.content.visible = true;
    this.windowGroup.visible = false;
    // The next field picture must set its own shape again.
    this.inspecting = true;
  }

  /**
   * Normally the picture fills the canvas. In the builder the robot is drawn
   * alone, with no field, inside the page's small preview box on plain black.
   */
  private frameView(mode: CameraMode): void {
    const inspecting = mode === 'inspect';
    this.fieldGroup.visible = !inspecting;
    if (this.pieceMesh) this.pieceMesh.visible = !inspecting;
    if (this.pieceEffects) this.pieceEffects.points.visible = !inspecting;
    if (!inspecting) {
      if (this.inspecting) {
        this.inspecting = false;
        this.renderer.setScissorTest(false);
        this.scene.background = BACKGROUND;
        this.resize();
      }
      return;
    }
    this.inspecting = true;

    const renderer = this.renderer;
    const canvas = this.canvas.getBoundingClientRect();
    this.scene.background = null;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();

    const box = document.getElementById('robot-preview')?.getBoundingClientRect();
    const width = Math.max(1, box?.width ?? 0);
    const height = Math.max(1, box?.height ?? 0);
    // WebGL measures up from the bottom of the canvas.
    const left = (box?.left ?? 0) - canvas.left;
    const bottom = canvas.bottom - (box?.bottom ?? 0);
    renderer.setViewport(left, bottom, width, height);
    renderer.setScissor(left, bottom, width, height);
    renderer.setScissorTest(true);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.renderer.setViewport(0, 0, width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    disposeGroup(this.content);
    disposeGroup(this.windowGroup);
    this.renderer.dispose();
  }

  /** Which robot the cameras follow: the one this player drives. */
  setPlayer(index: number): void {
    this.playerIndex = index;
  }

  setDriverStation(station: number): void {
    this.driverStation = station;
  }

  /** How steeply the angled camera looks down at the robot, in degrees. */
  private angledPitch = 35;
  setAngledPitch(degrees: number): void {
    this.angledPitch = degrees;
  }

  private placeCamera(mode: CameraMode, time: number, frameDt: number): void {
    const { length, width } = this.field;
    const camera = this.camera;
    const target = this.robotViews[this.playerIndex]?.group;
    // Which end of the field the driver stands at: -1 for blue, +1 for red.
    const side = this.robotViews[this.playerIndex]?.robot.alliance === 'red' ? 1 : -1;
    if (mode !== 'follow' && mode !== 'angled') this.followReady = false;
    camera.up.set(0, 1, 0);

    if (mode === 'inspect' && target) {
      // Circles the robot up close.
      const angle = time * 0.35;
      const offset = new THREE.Vector3(Math.cos(angle) * 1.75, 1.0, Math.sin(angle) * 1.75);
      const focus = target.position.clone().setY(0.35);
      camera.position.copy(focus).add(offset);
      camera.lookAt(focus);
    } else if (mode === 'orbit' || !target) {
      const angle = time * 0.08;
      camera.position.set(Math.cos(angle) * 13, 6.5, Math.sin(angle) * 13);
      camera.lookAt(0, 0, 0);
    } else if (mode === 'driver') {
      // Standing behind the driver's own alliance wall.
      // The driver stands still and turns to keep the robot in the middle of the view.
      // Station 1's place is the game's; 2 is the middle of the wall and 3 mirrors 1.
      const z = -side * this.driverStationZ * (2 - this.driverStation);
      camera.position.set(side * (length / 2 + 1.8), 2.3, z);
      camera.lookAt(target.position.x, 0.3, target.position.z);
    } else if (mode === 'angled') {
      // Above the robot on the driver's side, looking down at the angle the
      // player set. It slides along with the robot but never turns, so the field
      // always stretches away from the driver as it does from the driver station.
      const look = target.position.clone().setY(0.3);
      const pitch = THREE.MathUtils.degToRad(this.angledPitch);
      const back = Math.cos(pitch) * ANGLED_DISTANCE;
      const wantPos = look.clone().add(new THREE.Vector3(side * back, Math.sin(pitch) * ANGLED_DISTANCE, 0));
      const blend = this.followReady ? 1 - Math.exp(-8 * frameDt) : 1;
      this.followPos.lerp(wantPos, blend);
      this.followReady = true;
      camera.position.copy(this.followPos);
      camera.lookAt(this.followPos.x - side * back, look.y, this.followPos.z);
    } else if (mode === 'top') {
      // Away-from-driver is up the screen, so field-centric controls stay intuitive.
      const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      const height = Math.max((length / 2 + 0.8) / tan, (width / 2 + 0.8) / (tan * camera.aspect));
      camera.position.set(0, height, 0);
      camera.up.set(-side, 0, 0);
      camera.lookAt(0, 0, 0);
    } else {
      const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(target.quaternion).setY(0).normalize();
      const wantPos = target.position.clone().addScaledVector(forward, -2.6).setY(1.6);
      const wantLook = target.position.clone().addScaledVector(forward, 1.2).setY(0.2);
      const blend = this.followReady ? 1 - Math.exp(-7 * frameDt) : 1;
      this.followPos.lerp(wantPos, blend);
      this.followLook.lerp(wantLook, blend);
      this.followReady = true;
      camera.position.copy(this.followPos);
      camera.lookAt(this.followLook);
    }
  }
}

/** Moves a robot's meshes to where the simulation has it and its parts. */
function poseRobotView(view: RobotView, alpha: number): void {
  const { robot, group } = view;
  blendPose(group, robot.prevPos, robot.prevRot, robot.position(), robot.rotation(), alpha);
  view.steerGroups.forEach((steer, i) => {
    steer.rotation.y = robot.wheels[i].steer;
  });
  if (view.aura) {
    const on = robot.power.active > 0;
    view.aura.visible = on;
    if (on) {
      // It pulses, and fades out over its last second.
      const time = performance.now() / 1000;
      const material = view.aura.material as THREE.MeshBasicMaterial;
      material.opacity = (0.55 + 0.25 * Math.sin(time * 9)) * Math.min(1, robot.power.active);
      const grow = 1 + 0.06 * Math.sin(time * 9);
      view.aura.scale.set(grow, grow, 1);
    }
  }
  for (const entry of view.parts) {
    const { part, mesh } = entry;
    if (part.color !== entry.color) {
      entry.color = part.color;
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.color.set(part.color);
      if (part.glow) material.emissive.set(part.color);
    }
    mesh.visible = part.visible;
    mesh.position.set(part.position.x, part.position.y, part.position.z);
    mesh.rotation.set(part.roll ?? 0, part.yaw, part.pitch);
    // Every part is a unit shape stretched to its current size, so parts can grow and shrink.
    mesh.scale.set(part.size[0], part.size[1], part.size[2]);
  }
}

type PoseVec = { x: number; y: number; z: number };
type PoseQuat = PoseVec & { w: number };

const scratchA = new THREE.Quaternion();
const scratchB = new THREE.Quaternion();

function blendPose(
  object: THREE.Object3D,
  prevPos: PoseVec,
  prevRot: PoseQuat,
  pos: PoseVec,
  rot: PoseQuat,
  alpha: number,
): void {
  object.position.set(
    prevPos.x + (pos.x - prevPos.x) * alpha,
    prevPos.y + (pos.y - prevPos.y) * alpha,
    prevPos.z + (pos.z - prevPos.z) * alpha,
  );
  scratchA.set(prevRot.x, prevRot.y, prevRot.z, prevRot.w);
  scratchB.set(rot.x, rot.y, rot.z, rot.w);
  object.quaternion.slerpQuaternions(scratchA, scratchB, alpha);
}

function boxMesh(element: BoxElement): THREE.Mesh {
  const opacity = element.opacity ?? 1;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...element.size),
    new THREE.MeshStandardMaterial({
      color: element.color,
      transparent: opacity < 1,
      opacity,
      flatShading: true,
      roughness: 0.8,
    }),
  );
  mesh.position.set(...element.position);
  if (element.rotation) mesh.rotation.set(...element.rotation);
  mesh.castShadow = opacity >= 1;
  mesh.receiveShadow = true;
  return mesh;
}

function buildFloor(length: number, width: number, zone: number): THREE.Group {
  const group = new THREE.Group();

  const surround = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: 0x11141a, roughness: 1 }),
  );
  surround.rotation.x = -Math.PI / 2;
  surround.position.y = -0.005;
  surround.receiveShadow = true;
  group.add(surround);

  const carpet = new THREE.Mesh(
    new THREE.PlaneGeometry(length, width),
    new THREE.MeshStandardMaterial({ color: 0x3b3f46, roughness: 0.95 }),
  );
  carpet.rotation.x = -Math.PI / 2;
  carpet.receiveShadow = true;
  group.add(carpet);

  const marking = (sizeX: number, sizeZ: number, x: number, z: number, color: number, opacity = 1) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(sizeX, sizeZ),
      new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.003, z);
    group.add(mesh);
  };

  marking(zone, width, -(length / 2) + zone / 2, 0, ALLIANCE_COLORS.blue, 0.16);
  marking(zone, width, length / 2 - zone / 2, 0, ALLIANCE_COLORS.red, 0.16);
  marking(0.05, width, 0, 0, 0xffffff, 0.8);
  marking(0.05, width, -(length / 2) + zone, 0, ALLIANCE_COLORS.blue);
  marking(0.05, width, length / 2 - zone, 0, ALLIANCE_COLORS.red);

  return group;
}

/** A solid of the given height whose outline seen from above is `points`, centred on its middle height. */
function outlineSolid(points: Point[], height: number): THREE.BufferGeometry {
  // A shape's (x, y) becomes the robot's (x, -z) once the solid is stood upright.
  const shape = new THREE.Shape(points.map((point) => new THREE.Vector2(point.x, -point.z)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -height / 2, 0);
  return geometry;
}

function buildRobotView(robot: SimRobot): RobotView {
  const { chassis, drivetrain } = robot.def;
  const group = new THREE.Group();
  const hy = chassis.height / 2;
  const bumpers = bumpersOf(chassis);

  const part = (geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, roughness = 0.7) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  if (chassis.round) {
    const radius = chassis.length / 2;
    part(new THREE.CylinderGeometry(radius, radius, chassis.height, 40), robot.def.color ?? '#9aa3af', 0.5);
    if (bumpers.front > 0) {
      const ring = part(new THREE.CylinderGeometry(radius + bumpers.front, radius + bumpers.front, bumpers.height, 40), ALLIANCE_COLORS[robot.alliance]);
      ring.position.y = -hy + bumpers.height / 2;
    }
    // The team number on the front and back of the ring.
    const label = robot.def.team ? numberTexture(robot.def.team) : null;
    if (label && bumpers.front > 0) {
      const material = new THREE.MeshBasicMaterial({ map: label.texture, transparent: true, depthWrite: false });
      const height = bumpers.height * 0.92;
      const width = Math.min(height * label.aspect, radius);
      for (const side of [1, -1]) {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / label.aspect), material);
        mesh.position.set(side * (radius + bumpers.front + 0.003), -hy + bumpers.height / 2, 0);
        mesh.rotation.y = (side * Math.PI) / 2;
        group.add(mesh);
      }
    }
  } else if (hasShapedCorners(chassis)) {
    // The frame and its bumpers drawn from their outlines, cut corners and all.
    part(outlineSolid(frameOutline(chassis), chassis.height), robot.def.color ?? '#9aa3af', 0.5);
    const band = part(outlineSolid(bumperOutline(chassis), bumpers.height), ALLIANCE_COLORS[robot.alliance]);
    band.position.y = -hy + bumpers.height / 2;
  } else {
    part(new THREE.BoxGeometry(chassis.length, chassis.height, chassis.width), robot.def.color ?? '#9aa3af', 0.5);
  }

  // One bumper slab per side. The front and back slabs also cover the corners.
  const bumper = (sizeX: number, sizeZ: number, x: number, z: number) => {
    // A round frame's bumper ring, and the bumpers of a frame with cut corners, are drawn above.
    if (chassis.round || hasShapedCorners(chassis) || sizeX <= 0 || sizeZ <= 0) return;
    const mesh = part(new THREE.BoxGeometry(sizeX, bumpers.height, sizeZ), ALLIANCE_COLORS[robot.alliance]);
    mesh.position.set(x, -hy + bumpers.height / 2, z);
  };
  const outerWidth = chassis.width + bumpers.left + bumpers.right;
  const midZ = (bumpers.right - bumpers.left) / 2;
  bumper(bumpers.front, outerWidth, chassis.length / 2 + bumpers.front / 2, midZ);
  bumper(bumpers.back, outerWidth, -chassis.length / 2 - bumpers.back / 2, midZ);
  bumper(chassis.length, bumpers.left, 0, -chassis.width / 2 - bumpers.left / 2);
  bumper(chassis.length, bumpers.right, 0, chassis.width / 2 + bumpers.right / 2);

  // The team number in white on every side that has a bumper.
  const label = !chassis.round && robot.def.team ? numberTexture(robot.def.team) : null;
  if (label) {
    const material = new THREE.MeshBasicMaterial({ map: label.texture, transparent: true, depthWrite: false });
    const height = bumpers.height * 0.92;
    const number = (thickness: number, x: number, z: number, turn: number, room: number) => {
      if (thickness <= 0) return;
      const width = Math.min(height * label.aspect, room * 0.9);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / label.aspect), material);
      mesh.position.set(x, -hy + bumpers.height / 2, z);
      mesh.rotation.y = turn;
      group.add(mesh);
    };
    const out = 0.003;
    // Numbers fit on the straight part of each side, between any cut corners.
    const cut = cornerCuts(chassis);
    const shaped = hasShapedCorners(chassis);
    const room = (full: number, a: number, b: number) => (shaped ? Math.max(0.05, full - a - b) : full);
    number(bumpers.front, chassis.length / 2 + bumpers.front + out, midZ, Math.PI / 2, room(outerWidth, cut.cornerFL, cut.cornerFR));
    number(bumpers.back, -chassis.length / 2 - bumpers.back - out, midZ, -Math.PI / 2, room(outerWidth, cut.cornerBL, cut.cornerBR));
    number(bumpers.right, 0, chassis.width / 2 + bumpers.right + out, 0, room(chassis.length, cut.cornerFR, cut.cornerBR));
    number(bumpers.left, 0, -chassis.width / 2 - bumpers.left - out, Math.PI, room(chassis.length, cut.cornerFL, cut.cornerBL));
  }

  const steerGroups = robot.wheels.map((wheel) => {
    const steer = new THREE.Group();
    steer.position.set(wheel.localPos.x, -robot.rig.rideHeight + drivetrain.wheelRadius, wheel.localPos.z);
    const tyre = new THREE.Mesh(
      new THREE.CylinderGeometry(drivetrain.wheelRadius, drivetrain.wheelRadius, 0.045, 10),
      new THREE.MeshStandardMaterial({ color: 0x15171c, flatShading: true }),
    );
    tyre.rotation.x = Math.PI / 2;
    steer.add(tyre);
    group.add(steer);
    return steer;
  });

  const parts = robot.subsystems.flatMap((subsystem) =>
    subsystem.parts.map((partView) => {
      const opacity = partView.opacity ?? 1;
      const round = partView.shape === 'cylinder';
      const mesh = new THREE.Mesh(
        round
          ? new THREE.CylinderGeometry(0.5, 0.5, 1, 28)
          : partView.outline
            ? outlineSolid(partView.outline, 1)
            : new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: partView.color,
          flatShading: !round,
          roughness: 0.6,
          transparent: opacity < 1,
          opacity,
          // See-through parts must not hide what is drawn behind or inside them.
          depthWrite: opacity >= 1,
        }),
      );
      mesh.scale.set(...partView.size);
      // Yaw first, then pitch about the part's own sideways axis.
      mesh.rotation.order = 'YZX';
      mesh.castShadow = opacity >= 1;
      group.add(mesh);
      return { part: partView, mesh, color: partView.color };
    }),
  );

  // A robot carrying a power-up gets a ring of light, shown while the power-up is on.
  let aura: THREE.Mesh | null = null;
  if (robot.powerUp) {
    const reach = Math.max(robot.half.x, robot.half.z);
    aura = new THREE.Mesh(
      new THREE.RingGeometry(reach * 0.95, reach * 1.35, 48),
      new THREE.MeshBasicMaterial({
        color: robot.powerUp.color,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = -robot.rig.rideHeight + 0.012;
    aura.visible = false;
    aura.renderOrder = 2;
    group.add(aura);
  }
  return { robot, group, steerGroups, parts, aura };
}

/** White digits on a clear background, and how wide the picture is for its height. */
function numberTexture(text: string): { texture: THREE.CanvasTexture; aspect: number } | null {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  const font = 'bold 160px "Arial Narrow", Arial, sans-serif';
  context.font = font;
  // The picture is cropped to the digits themselves, so they fill its whole height.
  const measured = context.measureText(text);
  const ascent = Math.ceil(measured.actualBoundingBoxAscent);
  const descent = Math.ceil(measured.actualBoundingBoxDescent);
  canvas.width = Math.ceil(measured.width) + 8;
  canvas.height = ascent + descent + 4;
  // Resizing a canvas clears its settings.
  context.font = font;
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.fillText(text, canvas.width / 2, ascent + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: canvas.width / canvas.height };
}

/** How much a game piece's drawn ball is grown so it looks its true size; see buildPieceMesh. */
const PIECE_GROW = 2 / (1 + 0.934);

/** All game pieces are drawn as one batch of plain low-detail spheres. */
function buildPieceMesh(pieces: PieceSet): THREE.InstancedMesh | null {
  if (pieces.count === 0) return null;
  // A low-detail ball's flat faces sit inside its corners (at 0.934 to 1 of the radius), so it looks
  // smaller than it is. Grown so its outline averages the true size: a 0.15 m fuel looks 0.15 m across.
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  geometry.scale(PIECE_GROW, PIECE_GROW, PIECE_GROW);
  const mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }),
    pieces.count,
  );
  const color = new THREE.Color();
  for (let i = 0; i < pieces.count; i++) mesh.setColorAt(i, color.set(pieces.colors[i]));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Instances are spread across the field, so the base sphere's bounds are no use for culling.
  mesh.frustumCulled = false;
  return mesh;
}

const pieceMatrix = new THREE.Matrix4();

function updatePieceMesh(mesh: THREE.InstancedMesh, pieces: PieceSet, alpha: number): void {
  const { prev, cur } = pieces;
  for (let i = 0; i < pieces.count; i++) {
    // Held pieces are inside a robot, so they are shrunk to nothing.
    const radius = pieces.heldBy[i] === -1 ? pieces.radii[i] : 0;
    const k = i * 3;
    pieceMatrix
      .makeScale(radius, radius, radius)
      .setPosition(
        prev[k] + (cur[k] - prev[k]) * alpha,
        prev[k + 1] + (cur[k + 1] - prev[k + 1]) * alpha,
        prev[k + 2] + (cur[k + 2] - prev[k + 2]) * alpha,
      );
    mesh.setMatrixAt(i, pieceMatrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function disposeGroup(group: THREE.Object3D): void {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material: THREE.Material) => {
        (material as THREE.MeshBasicMaterial).map?.dispose();
        material.dispose();
      });
    }
  });
}
