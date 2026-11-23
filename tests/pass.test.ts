import { beforeAll, describe, expect, it } from 'vitest';
import { loopback } from '../src/net/protocol';
import { ClientSession, HostSession } from '../src/net/session';
import { PASS, allowedLedPatterns, applySkin, rankingPoints, skinsFor, unlockedIds } from '../src/pass/pass';
import { findRobot } from '../src/robots';
import { sanitizeRobot } from '../src/robots/custom';
import { patternColor } from '../src/sim/subsystems/led';
import { SimWorld, initPhysics } from '../src/sim/world';
import { EMPTY_STATS } from '../src/stats';
import { input, run, testField, testRobot } from './helpers';

describe('Drive Pass', () => {
  it('earns Ranking Points from the record and unlocks rewards in order', () => {
    const stats = { ...EMPTY_STATS, matches: 4, wins: 2, ties: 1, singleMatches: 3, soloTotal: 52, bonusRp: 4 };
    // 3 a win, 1 a tie, 1 a bonus, 1 a timed singleplayer match.
    expect(rankingPoints(stats)).toBe(2 * 3 + 1 + 4 + 3);
    const first = PASS.tiers[0];
    expect(unlockedIds(first.rp - 1).has(first.reward.id)).toBe(false);
    expect(unlockedIds(first.rp).has(first.reward.id)).toBe(true);
    // Rewards are listed by the points they need.
    expect(PASS.tiers.map((tier) => tier.rp)).toEqual([...PASS.tiers.map((tier) => tier.rp)].sort((a, b) => a - b));
    expect(new Set(PASS.tiers.map((tier) => tier.reward.id)).size).toBe(PASS.tiers.length);
  });

  it('a skin only repaints its own robot', () => {
    // Whichever skin the pass has.
    const skin = PASS.tiers.map((tier) => tier.reward).find((reward) => reward.type === 'skin')!;
    expect(skin).toBeDefined();
    const robot = findRobot(skin.robotId);
    expect(skinsFor(robot.id).some((other) => other.id === skin.id)).toBe(true);
    const worn = applySkin(robot, skin.id);
    expect(worn.color).toBe(skin.color);
    // The robot's own parts change only in colour; anything added is a see-through structure or a light. A game piece effect is only drawn.
    const colorless = (part: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(part).filter(([key]) => !(key === 'color' || key.endsWith('Color') || key.endsWith('Accent'))));
    const strip = (r: typeof robot, parts: number) =>
      JSON.stringify({ ...r, color: undefined, pieceEffect: undefined, subsystems: r.subsystems.slice(0, parts).map(colorless) });
    expect(strip(worn, robot.subsystems.length)).toBe(strip(robot, robot.subsystems.length));
    for (const added of worn.subsystems.slice(robot.subsystems.length)) {
      expect(['structure', 'led']).toContain(added.type);
      if (added.type === 'structure') expect(added.solid).toBe(false);
    }
    const other = findRobot(skin.robotId === 'simbotics' ? 'cheesy-poofs' : 'simbotics');
    expect(applySkin(other, skin.id)).toBe(other);
    expect(applySkin(robot, 'no-such-skin')).toBe(robot);
  });

  it('LED effects are only usable once unlocked', () => {
    const led = PASS.tiers.find((tier) => tier.reward.type === 'led')!;
    expect(allowedLedPatterns(new Set()).size).toBe(0);
    expect(allowedLedPatterns(new Set([led.reward.id])).size).toBe(1);
  });
});

describe('LED strips', () => {
  beforeAll(() => initPhysics());

  it('show the colour and pattern for what the robot is doing', () => {
    expect(patternColor('solid', '#ff0000', 1.234)).toBe('#ff0000');
    expect(patternColor('flash', '#ff0000', 0.1)).toBe('#ff0000');
    expect(patternColor('flash', '#ff0000', 0.3)).toBe('#111111');
    expect(patternColor('rainbow', '#ff0000', 0)).not.toBe(patternColor('rainbow', '#ff0000', 0.5));

    const base = testRobot('swerve-shooter');
    const def = sanitizeRobot({
      ...base,
      subsystems: [
        ...base.subsystems,
        { type: 'led', idleColor: '#0000ff', idlePattern: 'solid', shootingColor: '#00ff00', shootingPattern: 'solid', movingColor: '#ffff00', movingPattern: 'solid' },
      ],
    })!;
    const pieces = [{ shape: 'ball' as const, radius: 0.075, mass: 0.2, color: '#fff', positions: [[4, 3]] as [number, number][] }];
    const sim = new SimWorld(testField({ pieces, targets: [{ alliance: 'blue', position: [-2, 1, 0] }] }));
    const robot = sim.addRobot(def);
    const light = robot.subsystems.find((subsystem) => subsystem.type === 'led')!.parts[0];
    run(sim, input(), 0.2);
    expect(light.color).toBe('#0000ff');
    expect(light.glow).toBe(true);
    for (let i = 0; i < 5; i++) robot.store(sim, 0);
    run(sim, input({ shoot: true }), 0.05);
    expect(light.color).toBe('#00ff00');
    sim.dispose();
  });
});

describe('cosmetics in multiplayer', () => {
  beforeAll(() => initPhysics());

  it('everyone sees a player’s skin, name colour and badge', () => {
    const host = new HostSession('Host', findRobot('simbotics'));
    const [hostEnd, clientEnd] = loopback();
    host.accept(hostEnd);
    const skin = PASS.tiers.map((tier) => tier.reward).find((reward) => reward.type === 'skin')!;
    const guest = new ClientSession(clientEnd, 'Guest', findRobot(skin.robotId));
    guest.request({ type: 'look', look: { skins: { [skin.robotId]: skin.id }, nameColor: 'name-gold', badge: 'badge-crown', pieceEffect: 'effect-flame' } });
    const seen = guest.room!.players.find((player) => player.id === guest.id)!;
    expect(seen.look).toEqual({ skins: { [skin.robotId]: skin.id }, nameColor: 'name-gold', badge: 'badge-crown', pieceEffect: 'effect-flame' });
    const sim = host.start('rebuilt-2026', {}, 'practice', 2);
    expect(sim.robots[host.robotOf(guest.id!)].def.color).toBe(skin.color);
    expect(guest.sim!.robots[guest.robotIndex].def.color).toBe(skin.color);
    host.close();
    sim.dispose();
    guest.sim!.dispose();
  });
});

describe('skins made in the builder', () => {
  beforeAll(() => initPhysics());

  it('keep only colours and see-through parts, so they cannot change how a robot plays', async () => {
    const { skinFrom } = await import('../src/pass/pass');
    const base = findRobot('simbotics');
    const clean = { ...sanitizeRobot({ ...base, id: undefined })!, id: base.id };
    const draft = {
      ...clean,
      color: '#123456',
      // A recolour, and a sneaky change to how fast it shoots, which must not survive.
      subsystems: [
        ...clean.subsystems.map((subsystem, i) => (i === 0 ? { ...subsystem, color: '#ff00ff', rate: 99 } : subsystem)),
        { type: 'structure', solid: true, sizeX: 0.2, sizeY: 0.5, sizeZ: 0.2, color: '#00ff00' },
        { type: 'led' },
        { type: 'shooter' },
      ],
    };
    const skin = skinFrom(draft, clean, { id: 'skin-test', name: 'Test' });
    expect(skin.recolors[0]).toEqual({ color: '#ff00ff' });
    expect(skin.recolors.slice(1).every((change) => change === null)).toBe(true);
    // Only structures and lights are added, and a structure is never solid.
    expect(skin.extras.map((extra) => extra.type)).toEqual(['structure', 'led']);
    expect(skin.extras[0].solid).toBe(false);
  });
});

describe('LED effects', () => {
  it('chase runs a head with a fading tail, bounce moves a blip end to end, and blink flashes twice then stays dark', () => {
    const colors = (pattern: string, time: number) => Array.from({ length: 8 }, (_, i) => patternColor(pattern, '#0000ff', time, '#ffffff', i, 8));
    const chase = colors('chase', 0.3);
    expect(chase.filter((c) => c === '#ffffff')).toHaveLength(1);
    const head = chase.indexOf('#ffffff');
    expect(chase[(head + 7) % 8]).not.toBe('#0000ff');
    expect(chase[(head + 6) % 8]).not.toBe(chase[(head + 7) % 8]);
    expect(colors('chase', 0.9).indexOf('#ffffff')).not.toBe(head);
    const start = colors('bounce', 0).indexOf('#ffffff');
    const end = colors('bounce', 0.8).indexOf('#ffffff');
    expect([start, end].sort()).toEqual([0, 7]);
    expect(patternColor('blink', '#ff0000', 0.04)).toBe('#ff0000');
    expect(patternColor('blink', '#ff0000', 0.12)).toBe('#111111');
    expect(patternColor('blink', '#ff0000', 0.2)).toBe('#ff0000');
    expect(patternColor('blink', '#ff0000', 1.5)).toBe('#111111');
  });
});

describe('Drive Pass seasons', () => {
  it('a new season starts from zero, and keeps what was unlocked before, but not badges', async () => {
    const { availableIds } = await import('../src/pass/pass');
    const old = [
      { rp: 5, reward: { type: 'nameColor' as const, id: 'old-name', name: 'Old name', color: '#ff0000' } },
      { rp: 10, reward: { type: 'badge' as const, id: 'old-badge', name: 'Old badge', badge: 'X' } },
      { rp: 900, reward: { type: 'theme' as const, id: 'old-never', name: 'Never reached', colors: {} as never } },
    ];
    const pass = {
      id: 'season-2',
      name: 'Season 2',
      startedAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      champions: [],
      tiers: [{ rp: 3, reward: { type: 'badge' as const, id: 'new-badge', name: 'New badge', badge: 'Y' } }],
      past: [{ id: 'season-1', name: 'Season 1', tiers: old }],
    };
    // Last season this player unlocked the name colour and the badge.
    const owned = { 'old-name': 'season-1', 'old-badge': 'season-1' };
    const now = availableIds(0, owned, pass);
    expect(now.has('old-name')).toBe(true);
    expect(now.has('old-badge')).toBe(false);
    expect(now.has('old-never')).toBe(false);
    expect(now.has('new-badge')).toBe(false);
    expect(availableIds(3, owned, pass).has('new-badge')).toBe(true);
  });

  it("this browser's season record starts again in a new season", async () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    };
    const { loadSeasonStats, recordSeasonMatch } = await import('../src/stats');
    const match = { alliance: 'blue' as const, blue: 10, red: 5, robot: 'X', single: false, solo: 1, bonusRp: 1 };
    recordSeasonMatch(match, 'season-1');
    recordSeasonMatch(match, 'season-1');
    expect(loadSeasonStats('season-1').wins).toBe(2);
    expect(loadSeasonStats('season-2').wins).toBe(0);
    recordSeasonMatch(match, 'season-2');
    expect(loadSeasonStats('season-2').wins).toBe(1);
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});

describe('leaderboards', () => {
  it('count down to the season end, rank only standard rules, and drop a champion skin once first place is lost', async () => {
    const { countdown, standardRules } = await import('../src/account/leaderboard');
    const now = Date.UTC(2026, 10, 20, 0, 0, 0);
    expect(countdown(new Date(now + ((7 * 24 + 17) * 3600 + 2 * 60 + 39) * 1000).toISOString(), now)).toBe('7d 17:02:39');
    expect(countdown(new Date(now - 1000).toISOString(), now)).toBe('0d 00:00:00');
    expect(standardRules('rebuilt-2026', {})).toBe(true);
    expect(standardRules('rebuilt-2026', { fuel: 'default', depot: true })).toBe(true);
    expect(standardRules('rebuilt-2026', { fuel: 'double' })).toBe(false);
    expect(standardRules('rebuilt-2026', { humanPlayer: 'fourth' })).toBe(false);

    const { wornSkin } = await import('../src/pass/pass');
    // An ordinary skin is worn whatever the leaderboard says.
    expect(wornSkin('x', { x: 'some-skin' }, [])).toBe('some-skin');
    expect(wornSkin('x', {}, ['x'])).toBeUndefined();
  });
});
