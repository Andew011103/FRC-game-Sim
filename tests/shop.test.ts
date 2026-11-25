import { beforeAll, describe, expect, it } from 'vitest';
import { SHOP, boughtMark, buy, claim, claimableIds, dressRobot, rivetBalance, rivetsEarned, rivetsSpent, availableIds, PASS } from '../src/pass/pass';
import { cleanPowerUp, describePowerUp, type PowerUp } from '../src/pass/powerups';
import { decodeInput, encodeInput } from '../src/net/protocol';
import { SnapshotReader, SnapshotWriter } from '../src/net/snapshot';
import { sanitizeRobot } from '../src/robots/custom';
import { SimWorld, initPhysics } from '../src/sim/world';
import { input, run, testField } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

const TURBO: PowerUp = { icon: '⚡', color: '#38bdf8', duration: 2, cooldown: 5, uses: 2, boosts: { driveSpeed: 1.5, acceleration: 2 } };

const plainRobot = () => sanitizeRobot({ chassis: {}, drivetrain: { type: 'swerve' }, subsystems: [] })!;

describe('Rivets and the Shop', () => {
  const rivetTiers = PASS.tiers.filter((tier) => tier.reward.type === 'rivets');

  it('Rivets come from Drive Pass rewards reached, and buying spends them', () => {
    expect(rivetTiers.length).toBeGreaterThan(0);
    const item = SHOP.items[0];
    expect(item).toBeDefined();
    const enough = rivetTiers.find((_, i) => rivetsEarned(new Set(rivetTiers.slice(0, i + 1).map((tier) => tier.reward.id))) >= item.price)!;
    expect(enough).toBeDefined();
    expect(rivetBalance(0, {})).toBe(0);
    // Rivets reached count once claimed.
    expect(rivetBalance(enough.rp, {})).toBe(0);
    const claimed = claim(claimableIds(enough.rp, {}), enough.rp, {});
    const earned = rivetBalance(enough.rp, claimed);
    expect(earned).toBeGreaterThanOrEqual(item.price);

    // Not enough before claiming.
    expect(buy(item.reward.id, enough.rp, {})).toEqual({ error: 'Not enough Rivets.' });
    const bought = buy(item.reward.id, enough.rp, claimed);
    if ('error' in bought) throw new Error(bought.error);
    expect(rivetBalance(enough.rp, bought.owned)).toBe(earned - item.price);
    expect(availableIds(0, bought.owned).has(item.reward.id)).toBe(true);
    expect(buy(item.reward.id, enough.rp, bought.owned)).toEqual({ error: 'You already have it.' });
  });

  it('what an item cost is kept with it, so a later price change leaves the balance alone', () => {
    expect(rivetsSpent({ a: boughtMark(120), b: boughtMark(30), c: PASS.id })).toBe(150);
    expect(rivetsSpent({ a: 'shop:nonsense' })).toBe(0);
  });

  it('Shop items are never kept as rewards from an earlier season, and Rivets cannot be sold', () => {
    expect(SHOP.items.every((item) => item.reward.type !== 'rivets')).toBe(true);
    expect(PASS.tiers.every((tier) => tier.reward.type !== 'powerUp')).toBe(true);
  });
});

describe('Power-ups', () => {
  it('keeps every number within its limits', () => {
    const wild = cleanPowerUp({ icon: '', color: 'red', duration: 99, cooldown: 0, uses: 2.6, boosts: { driveSpeed: 9, fireRate: 0.5, made: 3 } })!;
    expect(wild.duration).toBe(15);
    expect(wild.cooldown).toBe(5);
    expect(wild.uses).toBe(3);
    expect(wild.boosts).toEqual({ driveSpeed: 1.6 });
    expect(wild.color).toBe('#38bdf8');
    expect(describePowerUp(TURBO)).toContain('Top speed ×1.5');
    expect(cleanPowerUp(null)).toBeUndefined();
  });

  it('only comes from the one equipped, never from a robot file', () => {
    const robot = { ...plainRobot(), powerUp: TURBO };
    expect(dressRobot(robot, null, null).powerUp).toBeUndefined();
    const item = SHOP.items.find((entry) => entry.reward.type === 'powerUp');
    if (item) expect(dressRobot(plainRobot(), null, null, item.reward.id).powerUp).toBeDefined();
  });

  it('switches on with a press, boosts the robot, then recharges, a set number of times a match', () => {
    const sim = new SimWorld(testField());
    const robot = sim.addRobot({ ...plainRobot(), powerUp: TURBO });
    const plain = new SimWorld(testField());
    const other = plain.addRobot(plainRobot());

    // Held down for the whole run, it switches on once, not again and again.
    let top = 0;
    run(sim, input({ driveY: 1, powerUp: true }), 1.5, () => (top = Math.max(top, robot.speed())));
    let plainTop = 0;
    run(plain, input({ driveY: 1 }), 1.5, () => (plainTop = Math.max(plainTop, other.speed())));
    expect(robot.power.usesLeft).toBe(1);
    expect(robot.power.active).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(plainTop * 1.15);

    run(sim, input(), 0.6);
    expect(robot.power.active).toBe(0);
    expect(robot.power.cooldown).toBeGreaterThan(4);
    expect(robot.boost.driveSpeed).toBe(1);
    // Pressed while recharging, nothing happens.
    run(sim, input({ powerUp: true }), 0.1);
    run(sim, input(), 0.1);
    expect(robot.power.usesLeft).toBe(1);

    run(sim, input(), 5);
    run(sim, input({ powerUp: true }), 0.1);
    expect(robot.power.usesLeft).toBe(0);
    run(sim, input(), 8);
    run(sim, input({ powerUp: true }), 0.1);
    expect(robot.power.active).toBe(0);

    robot.reset();
    expect(robot.power.usesLeft).toBe(2);
    sim.dispose();
    plain.dispose();
  });

  it('the press and where it stands reach the host and the other players', () => {
    expect(decodeInput(encodeInput(input({ powerUp: true }))).input.powerUp).toBe(true);
    expect(decodeInput(encodeInput(input({ shoot: true }))).input.powerUp).toBe(false);

    const def = { ...plainRobot(), powerUp: TURBO };
    const host = new SimWorld(testField());
    const copy = new SimWorld(testField());
    const robot = host.addRobot(def);
    const mirror = copy.addRobot(def);
    const writer = new SnapshotWriter();
    const reader = new SnapshotReader();
    run(host, input({ powerUp: true }), 0.5);
    reader.apply(copy, writer.write(host, 1));
    expect(Math.abs(mirror.power.active - robot.power.active)).toBeLessThanOrEqual(0.1);
    expect(mirror.power.usesLeft).toBe(1);
    run(host, input(), 2);
    reader.apply(copy, writer.write(host, 2));
    expect(mirror.power.active).toBe(0);
    expect(mirror.power.cooldown).toBeCloseTo(robot.power.cooldown, 0);
    host.dispose();
    copy.dispose();
  });
});

describe('Power-up pictures and the power-ups switch', () => {
  it('keeps a small picture of its own, and nothing that loads from elsewhere', () => {
    const picture = 'data:image/png;base64,iVBORw0KGgo=';
    expect(cleanPowerUp({ ...TURBO, image: picture })!.image).toBe(picture);
    expect(cleanPowerUp({ ...TURBO, image: 'https://example.com/a.png' })!.image).toBeUndefined();
    expect(cleanPowerUp({ ...TURBO, image: 'data:text/html;base64,PGI+' })!.image).toBeUndefined();
  });

  it('a room with power-ups off leaves every robot without one', async () => {
    const { buildNetWorld } = await import('../src/net/protocol');
    const item = SHOP.items.find((entry) => entry.reward.type === 'powerUp');
    if (!item) return;
    const players = [{ id: 0, name: 'A', robot: plainRobot(), seat: { alliance: 'blue' as const, station: 1 }, pose: null, look: { skins: {}, nameColor: '', badge: '', powerUp: item.reward.id } }];
    const on = buildNetWorld({ gameId: 'rebuilt-2026', options: {}, mode: 'match', powerUps: true, seed: 1, players });
    const off = buildNetWorld({ gameId: 'rebuilt-2026', options: {}, mode: 'match', powerUps: false, seed: 1, players });
    expect(on.robots[0].powerUp).not.toBeNull();
    expect(off.robots[0].powerUp).toBeNull();
    on.dispose();
    off.dispose();
  });

  it('a singleplayer match with power-ups allowed stays off the leaderboards, used or not', async () => {
    const { rankable } = await import('../src/account/leaderboard');
    const robot = { ...plainRobot(), official: true };
    expect(rankable(robot, true, true)).toMatch(/power-ups/);
    expect(rankable(robot, true, false) ?? '').not.toMatch(/power-ups/);
  });
});

describe('shop order', () => {
  const item = (id: string, type: 'skin' | 'powerUp' | 'nameColor', price: number) =>
    ({ price, reward: { type, id, name: id } }) as unknown as import('../src/pass/pass').ShopItem;
  const items = [item('boost', 'powerUp', 100), item('gold', 'nameColor', 40), item('red', 'nameColor', 20), item('wrap', 'skin', 300)];
  const ids = (groups: { items: { reward: { id: string } }[] }[]) => groups.map((group) => group.items.map((entry) => entry.reward.id));

  it('groups by category: name colors, badges, skins, LED effects, power-ups; cheapest first in each', async () => {
    const { orderShop } = await import('../src/ui/Shop');
    const groups = orderShop(items, 'category', () => false, 0);
    expect(groups.map((group) => group.title)).toEqual(['Name color', 'Robot skins', 'Power-up']);
    expect(ids(groups)).toEqual([['red', 'gold'], ['wrap'], ['boost']]);
  });

  it('lists everything by price', async () => {
    const { orderShop } = await import('../src/ui/Shop');
    expect(ids(orderShop(items, 'price', () => false, 0))).toEqual([['red', 'gold', 'boost', 'wrap']]);
  });

  it('puts what can be bought now first, then what needs more Rivets, then what is owned', async () => {
    const { orderShop } = await import('../src/ui/Shop');
    const groups = orderShop(items, 'affordable', (id) => id === 'red', 120);
    expect(groups.map((group) => group.title)).toEqual(['Can buy now', 'Needs more Rivets', 'Owned']);
    expect(ids(groups)).toEqual([['gold', 'boost'], ['wrap'], ['red']]);
  });
});
