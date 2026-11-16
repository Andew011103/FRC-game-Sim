import { beforeAll, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { rebuilt2026 } from '../src/games/rebuilt-2026';
import { hubX, HUB_HEIGHT } from '../src/games/rebuilt-2026/field';
import { sanitizeRobot } from '../src/robots/custom';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input } from './helpers';
beforeAll(() => initPhysics());
it('probe', () => {
  const out: string[] = [];
  for (const pitch of [50, 60, 75]) for (const [x, z] of [[-5.2, 0], [-6.5, 0], [-7.6, 0], [-5.5, 2.5], [-4.2, 2.2], [-7.5, 3.3]]) {
    const game = { ...rebuilt2026, spawns: [{ x, z, yaw: Math.atan2(-(0 - z), hubX('blue') - x), alliance: 'blue' as const }] };
    const sim = new SimWorld(game);
    const robot = sim.addRobot(sanitizeRobot({ chassis: {}, drivetrain: { type: 'swerve' }, subsystems: [{ type: 'hopper', capacity: 10 }, { type: 'shooter', autoRange: true, speed: 9, spread: 0, pitch, rate: 2, timingJitter: 0 }] })!);
    const held = [...robot.held];
    const seen = new Map<number, number[]>();
    let score = 0;
    for (let t = 0; t < 420; t++) {
      sim.step([input({ shoot: t < 200 })]);
      for (const i of held) {
        if (sim.pieces.heldBy[i] !== -1 || seen.has(i)) continue;
        const k = i * 3; const y0 = sim.pieces.prev[k + 1], y1 = sim.pieces.cur[k + 1];
        if (y0 > HUB_HEIGHT && y1 <= HUB_HEIGHT) {
          const px = sim.pieces.cur[k] - hubX('blue'), pz = sim.pieces.cur[k + 2];
          const dx = hubX('blue') - x, dz = -z, d = Math.hypot(dx, dz);
          seen.set(i, [(px * dx + pz * dz) / d, (px * -dz + pz * dx) / d]);
        }
      }
    }
    score = sim.match ? sim.match.score('blue') : -1;
    const along = [...seen.values()].map((v) => v[0]);
    const mean = along.reduce((a, b) => a + b, 0) / (along.length || 1);
    out.push(`pitch ${pitch} from (${x},${z}) d=${Math.hypot(hubX('blue') - x, z).toFixed(2)}: shots ${seen.size} along ${mean.toFixed(3)} score ${score}`);
    sim.dispose();
  }
  writeFileSync('zz-probe.txt', out.join('\n'));
}, 120000);
