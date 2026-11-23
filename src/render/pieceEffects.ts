import * as THREE from 'three';
import { ALLIANCE_COLOR, effectScales } from '../pass/effects';
import type { PieceSet } from '../sim/pieces';
import type { SimRobot } from '../sim/robot';

// Game piece effects: glows and trails drawn on fuel in the air after a robot
// with an effect shoots it. Everything is soft, additive points of light, drawn
// as one batch: a halo (and two orbiting lights) for each piece, and a pool of
// short-lived sparks for trails.

const ALLIANCE_HEX = { blue: '#2f6fed', red: '#e5484d' };
/** How many trail sparks can be alive at once; the oldest are reused first. */
const MAX_SPARKS = 2400;
/** Points per piece: its halo and two orbiting lights. */
const PER_PIECE = 3;

const VERTEX = /* glsl */ `
  attribute float size;
  attribute vec3 tint;
  uniform float scale;
  varying vec3 vTint;
  void main() {
    vTint = tint;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / max(0.05, -view.z);
    gl_Position = projectionMatrix * view;
  }
`;
const FRAGMENT = /* glsl */ `
  varying vec3 vTint;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = 1.0 - d;
    gl_FragColor = vec4(vTint, a * a);
  }
`;

type SparkStyle = 'fade' | 'flame' | 'twinkle';

const scratch = new THREE.Color();
const scratchB = new THREE.Color();
const scratchC = new THREE.Color();
const WARM = new THREE.Color('#fff2c0');
const WHITE = new THREE.Color('#ffffff');

export class PieceEffects {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly tints: Float32Array;
  private readonly sizes: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  private readonly haloCount: number;
  /** Which pieces were last drawn in an effect colour, to put them back. */
  private readonly tinted: Uint8Array;
  private readonly baseColors: THREE.Color[];
  private readonly lastPos: Float32Array;
  private readonly wasLaunched: Int16Array;
  // The spark pool.
  private readonly spark = {
    pos: new Float32Array(MAX_SPARKS * 3),
    vel: new Float32Array(MAX_SPARKS * 3),
    color: new Float32Array(MAX_SPARKS * 3),
    age: new Float32Array(MAX_SPARKS),
    life: new Float32Array(MAX_SPARKS),
    size: new Float32Array(MAX_SPARKS * 2),
    style: new Array<SparkStyle>(MAX_SPARKS).fill('fade'),
    gain: new Float32Array(MAX_SPARKS),
  };
  /** The intensity of the effect being drawn, set for each piece before its sparks are made. */
  private strength = 1;
  private nextSpark = 0;
  private time = 0;

  constructor(pieces: PieceSet) {
    this.haloCount = pieces.count * PER_PIECE;
    const total = this.haloCount + MAX_SPARKS;
    this.positions = new Float32Array(total * 3);
    this.tints = new Float32Array(total * 3);
    this.sizes = new Float32Array(total);
    this.tinted = new Uint8Array(pieces.count);
    this.baseColors = pieces.colors.map((color) => new THREE.Color(color));
    this.lastPos = new Float32Array(pieces.count * 3);
    this.wasLaunched = new Int16Array(pieces.count).fill(-1);
    this.spark.life.fill(0);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('tint', new THREE.BufferAttribute(this.tints, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { scale: { value: 500 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /** Sets how many pixels one metre is at one metre away, from the screen height and the camera. */
  setScale(screenHeight: number, fovDegrees: number): void {
    this.material.uniforms.scale.value = screenHeight / (2 * Math.tan((fovDegrees * Math.PI) / 360));
  }

  /** `enabled` false draws no effects at all, for players who turn them off. */
  update(pieces: PieceSet, robots: SimRobot[], mesh: THREE.InstancedMesh | null, alpha: number, dt: number, enabled = true): void {
    this.time += dt;
    const t = this.time;
    const { prev, cur } = pieces;
    let recolored = false;

    for (let i = 0; i < pieces.count; i++) {
      const k = i * 3;
      const x = prev[k] + (cur[k] - prev[k]) * alpha;
      const y = prev[k + 1] + (cur[k + 1] - prev[k + 1]) * alpha;
      const z = prev[k + 2] + (cur[k + 2] - prev[k + 2]) * alpha;
      const shooter = pieces.heldBy[i] === -1 ? pieces.launchedBy[i] : -1;
      const robot = shooter >= 0 ? robots[shooter] : undefined;
      const effect = enabled ? robot?.def.pieceEffect : undefined;
      const r = pieces.radii[i];
      const h = i * PER_PIECE;
      for (let p = 0; p < PER_PIECE; p++) this.sizes[h + p] = 0;

      if (!effect || !robot) {
        if (this.tinted[i] && mesh) {
          mesh.setColorAt(i, this.baseColors[i]);
          this.tinted[i] = 0;
          recolored = true;
        }
        this.wasLaunched[i] = -1;
        continue;
      }

      // Trails start from where the piece is now, not from where it was last shot.
      if (this.wasLaunched[i] !== shooter) {
        this.lastPos[k] = x;
        this.lastPos[k + 1] = y;
        this.lastPos[k + 2] = z;
        this.wasLaunched[i] = shooter;
      }
      const base = effect.color === ALLIANCE_COLOR ? ALLIANCE_HEX[robot.alliance] : effect.color;
      const color = scratch.set(base);
      let ball: THREE.Color | null = scratchB.copy(color);
      let halo = 8 * r;
      let level = 1;
      // Three separate strengths: how much of the colour the fuel itself takes on, how bright and big
      // the glow around it is, and how strong the trail or sparks are.
      const scales = effectScales(effect);
      const power = scales.intensity;
      this.strength = power;
      const grow = 0.6 + 0.4 * power;
      const glow = scales.glow;
      const glowGrow = 0.5 + 0.5 * glow;

      switch (effect.kind) {
        case 'pulse':
          level = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * Math.PI * 4 + i));
          halo = r * (5 + 5 * level);
          ball = scratchB.copy(this.baseColors[i]).lerp(color, level);
          break;
        case 'blink': {
          const on = (t * 3 + i * 0.37) % 1 < 0.5;
          level = on ? 1 : 0;
          ball = on ? ball : scratchB.copy(this.baseColors[i]);
          break;
        }
        case 'rainbow':
          color.setHSL((t * 0.8 + i * 0.13) % 1, 1, 0.55);
          ball = scratchB.copy(color);
          break;
        case 'flame': {
          // Hot at the core, burning off in the effect's colour.
          ball = scratchB.copy(color).lerp(WARM, 0.55);
          halo = 4.5 * r;
          this.emitAlong(i, x, y, z, 40 * power * dt, r, color, 'flame', 0.22, 0.36, [2.2 * r * grow, 3.6 * r * grow], 0.4, 0.5);
          break;
        }
        case 'comet':
          halo = 4.5 * r;
          this.emitAlong(i, x, y, z, 60 * power * dt, r, color, 'fade', 0.18, 0.25, [2.4 * r * grow, 0.6 * r], 0, 0);
          break;
        case 'sparkle':
          halo = 5 * r;
          this.emitAlong(i, x, y, z, 80 * power * dt, r, color, 'twinkle', 0.5, 0.8, [2.4 * r * grow, 0.8 * r], 0.8, 0);
          break;
        case 'electric': {
          // A crackle: flickering brightness and sudden bursts of quick white and coloured sparks.
          level = 0.4 + 0.6 * Math.random();
          if (Math.random() < 0.35) ball = scratchB.set('#ffffff');
          halo = r * (5 + 5 * Math.random());
          if (Math.random() < 0.3 * Math.min(1.5, power)) {
            const burst = scratchC.copy(color).lerp(WHITE, Math.random());
            this.emitAlong(i, x, y, z, 8, r, burst, 'fade', 0.1, 0.2, [2 * r * grow, 0.4 * r], 3, 0);
          }
          break;
        }
        case 'orbit': {
          halo = 4.5 * r;
          level = 0.6;
          ball = null;
          for (let p = 1; p < PER_PIECE; p++) {
            const angle = t * 9 + i + ((p - 1) * Math.PI);
            const o = (h + p) * 3;
            this.positions[o] = x + Math.cos(angle) * r * 2.6;
            this.positions[o + 1] = y + Math.sin(angle * 0.5) * r * 1.2;
            this.positions[o + 2] = z + Math.sin(angle) * r * 2.6;
            this.tints[o] = color.r * glow;
            this.tints[o + 1] = color.g * glow;
            this.tints[o + 2] = color.b * glow;
            this.sizes[h + p] = glow > 0 ? 3.2 * r * glowGrow : 0;
          }
          break;
        }
        default:
          break;
      }

      // The fuel itself takes on only as much of the colour as its fuel colour setting says.
      if (ball) {
        const tint = scales.fuelColor;
        ball = scratchC.copy(this.baseColors[i]).lerp(ball, tint).multiplyScalar(1 + 0.3 * tint * level);
      }
      const o = h * 3;
      this.positions[o] = x;
      this.positions[o + 1] = y;
      this.positions[o + 2] = z;
      this.tints[o] = color.r * level * glow;
      this.tints[o + 1] = color.g * level * glow;
      this.tints[o + 2] = color.b * level * glow;
      this.sizes[h] = glow > 0 ? halo * glowGrow : 0;
      this.lastPos[k] = x;
      this.lastPos[k + 1] = y;
      this.lastPos[k + 2] = z;

      if (mesh) {
        mesh.setColorAt(i, ball ?? this.baseColors[i]);
        this.tinted[i] = 1;
        recolored = true;
      }
    }

    this.stepSparks(dt);
    if (recolored && mesh?.instanceColor) mesh.instanceColor.needsUpdate = true;
    const geometry = this.points.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.tint.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
  }

  /**
   * Leaves sparks along the path a piece took since the last frame, so trails
   * stay smooth however fast it flies. `spread` scatters them at random speeds;
   * `rise` drifts them upward, like flames.
   */
  private emitAlong(
    i: number,
    x: number,
    y: number,
    z: number,
    count: number,
    radius: number,
    color: THREE.Color,
    style: SparkStyle,
    lifeMin: number,
    lifeMax: number,
    sizes: [number, number],
    spread: number,
    rise: number,
  ): void {
    const k = i * 3;
    const whole = Math.floor(count) + (Math.random() < count % 1 ? 1 : 0);
    const s = this.spark;
    for (let n = 0; n < whole; n++) {
      const along = Math.random();
      const j = this.nextSpark;
      this.nextSpark = (this.nextSpark + 1) % MAX_SPARKS;
      const jitter = () => (Math.random() - 0.5) * radius * 0.8;
      s.pos[j * 3] = this.lastPos[k] + (x - this.lastPos[k]) * along + jitter();
      s.pos[j * 3 + 1] = this.lastPos[k + 1] + (y - this.lastPos[k + 1]) * along + jitter();
      s.pos[j * 3 + 2] = this.lastPos[k + 2] + (z - this.lastPos[k + 2]) * along + jitter();
      s.vel[j * 3] = (Math.random() - 0.5) * spread;
      s.vel[j * 3 + 1] = (Math.random() - 0.5) * spread + rise;
      s.vel[j * 3 + 2] = (Math.random() - 0.5) * spread;
      s.color[j * 3] = color.r;
      s.color[j * 3 + 1] = color.g;
      s.color[j * 3 + 2] = color.b;
      s.age[j] = 0;
      s.life[j] = lifeMin + Math.random() * (lifeMax - lifeMin);
      s.size[j * 2] = sizes[0];
      s.size[j * 2 + 1] = sizes[1];
      s.style[j] = style;
      s.gain[j] = Math.min(1.5, this.strength);
    }
  }

  private stepSparks(dt: number): void {
    const s = this.spark;
    for (let j = 0; j < MAX_SPARKS; j++) {
      const o = (this.haloCount + j) * 3;
      if (s.life[j] <= 0 || s.age[j] >= s.life[j]) {
        this.sizes[this.haloCount + j] = 0;
        continue;
      }
      s.age[j] += dt;
      const f = Math.min(1, s.age[j] / s.life[j]);
      for (let a = 0; a < 3; a++) {
        s.pos[j * 3 + a] += s.vel[j * 3 + a] * dt;
        this.positions[o + a] = s.pos[j * 3 + a];
      }
      let fade = 1 - f;
      let [r, g, b] = [s.color[j * 3], s.color[j * 3 + 1], s.color[j * 3 + 2]];
      if (s.style[j] === 'flame') {
        // Yellow-white at first, through the flame's colour, to nothing.
        const hot = Math.max(0, 1 - f * 2.5);
        r = r + (1 - r) * hot;
        g = g + (0.9 - g) * hot;
        b = b + (0.55 - b) * hot;
        fade = (1 - f) ** 1.5;
      } else if (s.style[j] === 'twinkle') {
        fade *= 0.4 + 0.6 * Math.abs(Math.sin(s.age[j] * 40 + j));
        const white = Math.random() < 0.3 ? 1 : 0;
        r = r + (1 - r) * white;
        g = g + (1 - g) * white;
        b = b + (1 - b) * white;
      }
      fade *= s.gain[j];
      this.tints[o] = r * fade;
      this.tints[o + 1] = g * fade;
      this.tints[o + 2] = b * fade;
      this.sizes[this.haloCount + j] = s.size[j * 2] + (s.size[j * 2 + 1] - s.size[j * 2]) * f;
    }
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
