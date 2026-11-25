import type { RobotDefinition, SubsystemDef } from '../robots/types';
import type { PlayerStats } from '../stats';
import data from './drive-pass.json';
import shopData from './shop.json';
import { cleanEffect, type PieceEffect } from './effects';
import { cleanPowerUp, type PowerUp } from './powerups';
import type { NameStyleFields } from './nameStyle';

// The Drive Pass: a road of rewards, each unlocked once a player has earned
// enough Ranking Points (RP) by playing. Rewards are cosmetic only. The road
// itself is a file in the project (drive-pass.json), edited on the Drive Pass
// screen while developing.
//
// The pass runs in seasons. Only matches played since the current season
// started count toward its RP, so a new season starts everyone from zero.
// Rewards a player unlocked in earlier seasons stay theirs (they are kept in
// their saved choices), all but name badges, which belong to their season.
// Past seasons' rewards are kept in the file so they still work.

/** A color palette for the interface, in the same form as the built-in ones. */
export interface ThemeColors {
  bg: string;
  panel: string;
  raised: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentStrong: string;
  onAccent: string;
  good: string;
  warn: string;
  bad: string;
}

export type Reward =
  /**
   * A robot dressed up, made in the robot builder: its frame color, new
   * colors for any of its mechanisms (by their place in its list, null for
   * none), and see-through structures and LED strips added on.
   */
  | {
      type: 'skin';
      id: string;
      name: string;
      robotId: string;
      color?: string;
      recolors: (Record<string, string> | null)[];
      extras: SubsystemDef[];
      /** How fuel the robot shoots looks while wearing this skin. */
      pieceEffect?: PieceEffect;
    }
  /** The player's name shown in a color, or a gradient, with an edge or an animation if it has them. */
  | ({ type: 'nameColor'; id: string; name: string } & NameStyleFields)
  /** A short mark shown beside the player's name: a few letters or an emoji, or a small picture. */
  | { type: 'badge'; id: string; name: string; badge: string; image?: string }
  /** How fuel looks in the air after the player shoots it, on any robot. */
  | { type: 'pieceEffect'; id: string; name: string; effect: PieceEffect }
  /** A lighting pattern for LED strips in the robot builder. */
  | { type: 'led'; id: string; name: string; pattern: string }
  /** A color theme for the interface. */
  | { type: 'theme'; id: string; name: string; colors: ThemeColors }
  /** Rivets, the Shop's currency, added to the player's balance once reached. */
  | { type: 'rivets'; id: string; name: string; amount: number }
  /** An ability that boosts the player's own robot for a few seconds when switched on in a match. */
  | { type: 'powerUp'; id: string; name: string; powerUp: PowerUp };

export type RewardType = Reward['type'];

export interface Tier {
  /** Ranking Points needed. */
  rp: number;
  reward: Reward;
}

/** A season that has ended: its rewards, kept for the players who earned them. */
export interface PastSeason {
  id: string;
  name: string;
  /** When it started; seasons saved before this was kept have none. */
  startedAt?: string;
  tiers: Tier[];
}

export interface DrivePass {
  /** Identifies the season; a new season has a new id. */
  id: string;
  name: string;
  /** When the season started (an ISO date): only matches since then count toward its RP. */
  startedAt: string;
  /** When the season is due to end (an ISO date), for the countdown. A new season is started by hand in the editor. */
  endsAt: string;
  tiers: Tier[];
  past: PastSeason[];
  /**
   * Champion skins: each worn only by whoever is first on its robot's
   * leaderboard this season, for as long as they stay first.
   */
  champions: Extract<Reward, { type: 'skin' }>[];
}

/** How long a season normally runs. */
export const SEASON_DAYS = 30;

export const REWARD_TYPES: { type: RewardType; label: string }[] = [
  { type: 'skin', label: 'Robot skin' },
  { type: 'nameColor', label: 'Name color' },
  { type: 'badge', label: 'Name badge' },
  { type: 'led', label: 'LED effect' },
  { type: 'pieceEffect', label: 'Game piece effect' },
  { type: 'theme', label: 'Color theme' },
  { type: 'rivets', label: 'Rivets' },
  { type: 'powerUp', label: 'Power-up' },
];

/** Reward kinds only the Drive Pass gives, and kinds only the Shop sells. */
export const PASS_ONLY_TYPES: RewardType[] = ['rivets'];
export const SHOP_ONLY_TYPES: RewardType[] = ['powerUp'];

/** Something for sale in the Shop, and its price in Rivets. */
export interface ShopItem {
  price: number;
  reward: Reward;
}

/** The Shop as the game ships it (src/pass/shop.json), cheapest first. Its items are never in the Drive Pass. */
export const SHOP: { items: ShopItem[] } = {
  items: (Array.isArray((shopData as { items?: unknown }).items) ? (shopData as { items: ShopItem[] }).items : [])
    .filter((item) => typeof item.price === 'number' && typeof item.reward?.id === 'string' && item.reward.type !== 'rivets')
    .sort((a, b) => a.price - b.price),
};

/** What is saved against a Shop item a player bought: that it came from the Shop, and what it cost. */
export const SHOP_MARK = 'shop';
export const boughtMark = (price: number): string => `${SHOP_MARK}:${Math.max(0, Math.round(price))}`;

/** The pass as the game ships it, in order of the points needed. */
const file = data as Partial<DrivePass> & { tiers: Tier[] };
export const PASS: DrivePass = {
  id: typeof file.id === 'string' && file.id ? file.id : 'season-1',
  name: String(file.name ?? 'Drive Pass'),
  // The first season counts every match ever played.
  startedAt: typeof file.startedAt === 'string' ? file.startedAt : '2000-01-01T00:00:00.000Z',
  endsAt:
    typeof file.endsAt === 'string'
      ? file.endsAt
      : new Date(new Date(typeof file.startedAt === 'string' ? file.startedAt : Date.now()).getTime() + SEASON_DAYS * 86400000).toISOString(),
  tiers: [...file.tiers].sort((a, b) => a.rp - b.rp),
  past: Array.isArray(file.past) ? file.past : [],
  champions: Array.isArray(file.champions) ? file.champions : [],
};

/** The champion skin for a robot, if one has been made. */
export const championSkinFor = (robotId: string) => PASS.champions.find((skin) => skin.robotId === robotId) ?? null;

/** Whether a skin is a champion skin, worn only while first on its robot's leaderboard. */
export const isChampionSkin = (id: string | null | undefined): boolean => !!id && PASS.champions.some((skin) => skin.id === id);

/**
 * The skin a player wears on a robot: the one they picked, unless it is a
 * champion skin and they are no longer first on that robot's leaderboard.
 */
export function wornSkin(robotId: string, skins: Record<string, string>, champions: string[]): string | undefined {
  const picked = skins[robotId];
  if (isChampionSkin(picked) && !champions.includes(robotId)) return undefined;
  return picked;
}

/**
 * What is saved against a reward a player reaches in a season: the season and
 * when it started. Moving a season's start changes it, so rewards reached under
 * the old start no longer count as owned.
 */
export function seasonMark(season: { id: string; startedAt?: string }): string {
  if (!season.startedAt || new Date(season.startedAt).getFullYear() <= 2000) return season.id;
  return `${season.id}@${season.startedAt}`;
}

/** Whether a player owns a reward: saved with its season's mark (or bought in the Shop), or with anything for an old season saved without a start. */
function owns(owned: Record<string, string>, id: string, mark: string | null): boolean {
  const saved = owned[id];
  if (!saved) return false;
  if (mark === SHOP_MARK) return saved === SHOP_MARK || saved.startsWith(`${SHOP_MARK}:`);
  return mark === null || saved === mark;
}

/** Every reward there has ever been, with the season it belongs to and that season's mark; the current season first. */
const ALL_REWARDS: { reward: Reward; season: string; mark: string | null }[] = [
  ...PASS.tiers.map((tier) => ({ reward: tier.reward, season: PASS.id, mark: seasonMark(PASS) })),
  ...PASS.champions.map((reward) => ({ reward: reward as Reward, season: PASS.id, mark: seasonMark(PASS) })),
  ...PASS.past.flatMap((season) =>
    season.tiers.map((tier) => ({ reward: tier.reward, season: season.id, mark: season.startedAt ? seasonMark(season) : null })),
  ),
  ...SHOP.items.map((item) => ({ reward: item.reward, season: SHOP_MARK, mark: SHOP_MARK as string | null })),
];

/** Whether a match played at this moment counts toward the current season. */
export const inSeason = (playedAt: string | number | Date): boolean => new Date(playedAt).getTime() >= new Date(PASS.startedAt).getTime();

/** How Ranking Points are earned, for the pass screen to explain. */
export const RP_RULES = [
  { label: 'Each multiplayer win', points: 3 },
  { label: 'Each multiplayer tie', points: 1 },
  { label: 'Energized: your alliance scores 630 fuel in a multiplayer match', points: 1 },
  { label: 'Supercharged: your alliance scores 1000 fuel in a multiplayer match', points: 1 },
  { label: 'Traversal: your alliance earns 50 tower points in a multiplayer match', points: 1 },
  { label: 'Each timed singleplayer match', points: 1 },
  { label: 'First top-3 place on the Season Overall leaderboard (15, 12 or 10)', points: 15 },
];

/** A player's Ranking Points, worked out from their record, so they follow the account. */
export function rankingPoints(stats: PlayerStats): number {
  return stats.wins * 3 + stats.ties + (stats.bonusRp ?? 0) + stats.singleMatches;
}

/** The Ranking Points one multiplayer match earns: 3 for a win, 1 for a tie, and 1 for each bonus achieved. */
export function matchRankingPoints(own: number, other: number, bonusesAchieved: number): number {
  return (own > other ? 3 : own === other ? 1 : 0) + bonusesAchieved;
}

/** The ids of every reward a player with this many points has unlocked. */
export function unlockedIds(rp: number, pass: DrivePass = PASS): Set<string> {
  return new Set(pass.tiers.filter((tier) => rp >= tier.rp).map((tier) => tier.reward.id));
}

/**
 * A reward by its id, from this season or an earlier one. Name badges belong
 * to their season: once it is over, nobody shows them.
 */
export function findReward<T extends RewardType>(id: string | null | undefined, type: T): Extract<Reward, { type: T }> | null {
  if (!id) return null;
  const found = ALL_REWARDS.find((entry) => entry.reward.id === id);
  if (!found || found.reward.type !== type) return null;
  if (type === 'badge' && found.season !== PASS.id) return null;
  return found.reward as Extract<Reward, { type: T }>;
}

/**
 * The rewards a player has: this season's that they have claimed, ones kept
 * from earlier seasons (but not badges), and Shop items bought. A reward
 * reached but not yet claimed is not theirs to use. `rp` is kept for callers
 * that pass it; owning is decided by what has been claimed.
 */
export function availableIds(_rp: number, owned: Record<string, string>, pass: DrivePass = PASS): Set<string> {
  const ids = new Set<string>();
  const rewards = [
    ...pass.tiers.map((tier) => ({ reward: tier.reward, season: pass.id, mark: seasonMark(pass) as string | null })),
    ...pass.past.flatMap((season) =>
      season.tiers.map((tier) => ({ reward: tier.reward, season: season.id, mark: season.startedAt ? seasonMark(season) : null })),
    ),
  ];
  for (const { reward, season, mark } of rewards) {
    if (owns(owned, reward.id, mark) && (reward.type !== 'badge' || season === pass.id)) ids.add(reward.id);
  }
  // Shop items bought stay for good, badges included.
  for (const item of SHOP.items) if (owns(owned, item.reward.id, SHOP_MARK)) ids.add(item.reward.id);
  return ids;
}

/** Every reward there is, once each: this season's, champion skins and earlier seasons'. */
export const allRewards = (): Reward[] => {
  const seen = new Set<string>();
  return ALL_REWARDS.map((entry) => entry.reward).filter((reward) => !seen.has(reward.id) && !!seen.add(reward.id));
};

/** Every reward id, for trying them all out while developing. */
export const allRewardIds = (): Set<string> => new Set(ALL_REWARDS.map((entry) => entry.reward.id));

/** Rewards kept from earlier seasons that a player owns, to show on the pass screen. Badges are not kept. */
export const keptRewards = (owned: Record<string, string>): Reward[] =>
  ALL_REWARDS.filter((entry) => entry.season !== PASS.id && entry.season !== SHOP_MARK && owns(owned, entry.reward.id, entry.mark) && entry.reward.type !== 'badge').map(
    (entry) => entry.reward,
  );

/** The skins made for a robot, in any season. */
export const skinsFor = (robotId: string) =>
  ALL_REWARDS.map((entry) => entry.reward).filter(
    (reward): reward is Extract<Reward, { type: 'skin' }> => reward.type === 'skin' && reward.robotId === robotId,
  );

/** The kinds of part a skin may add: ones that change how the robot looks and nothing else. */
export const SKIN_EXTRA_TYPES = ['structure', 'led'];

const hex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
/** A setting a skin may change on a mechanism: only colors. */
const colorKey = (key: string) => key === 'color' || key.endsWith('Color') || key.endsWith('Accent');

/** A part a skin adds, made harmless: a structure can never be solid, and nothing but looks is kept. */
export function skinExtra(def: SubsystemDef): SubsystemDef | null {
  if (!SKIN_EXTRA_TYPES.includes(def.type)) return null;
  return def.type === 'structure' ? { ...def, solid: false } : { ...def };
}

/**
 * A robot wearing a skin: the same robot, recolored, with see-through
 * structures and lights added. Its frame, drivetrain and mechanisms are
 * untouched, so a skin can never make a robot better or worse. A skin for
 * another robot, or one that does not exist, leaves the robot as it is.
 */
export function applySkin(robot: RobotDefinition, skinId: string | null | undefined): RobotDefinition {
  const skin = findReward(skinId, 'skin');
  if (!skin || skin.robotId !== robot.id) return robot;
  const recolors = skin.recolors ?? [];
  const pieceEffect = cleanEffect(skin.pieceEffect);
  return {
    ...robot,
    ...(pieceEffect ? { pieceEffect } : {}),
    color: hex(skin.color) ? skin.color : robot.color,
    subsystems: [
      ...robot.subsystems.map((subsystem, i) => {
        const changes = Object.entries(recolors[i] ?? {}).filter(([key, value]) => colorKey(key) && hex(value));
        return changes.length > 0 ? { ...subsystem, ...Object.fromEntries(changes) } : subsystem;
      }),
      ...(skin.extras ?? []).map(skinExtra).filter((extra): extra is SubsystemDef => extra !== null),
    ],
  };
}

/**
 * The skin a robot made in the builder amounts to: its colors wherever they
 * differ from the robot it dresses up, and the parts it adds. `base` is that
 * robot, and the builder's copy keeps its mechanisms first, in the same order.
 */
export function skinFrom(
  draft: RobotDefinition,
  base: RobotDefinition,
  reward: { id: string; name: string },
): Extract<Reward, { type: 'skin' }> {
  const recolors = base.subsystems.map((original, i) => {
    const now = draft.subsystems[i] ?? {};
    const changes = Object.entries(now).filter(([key, value]) => colorKey(key) && hex(value) && value !== original[key]);
    return changes.length > 0 ? (Object.fromEntries(changes) as Record<string, string>) : null;
  });
  return {
    type: 'skin',
    id: reward.id,
    name: reward.name,
    robotId: base.id,
    color: draft.color,
    recolors,
    extras: draft.subsystems.slice(base.subsystems.length).map(skinExtra).filter((extra): extra is SubsystemDef => extra !== null),
    ...(cleanEffect(draft.pieceEffect) ? { pieceEffect: cleanEffect(draft.pieceEffect) } : {}),
  };
}

/**
 * A robot as a player brings it to a match: wearing its skin, and with a game
 * piece effect. A skin's own effect comes first; otherwise the one the player equipped.
 */
export function dressRobot(
  robot: RobotDefinition,
  skinId: string | null | undefined,
  effectId: string | null | undefined,
  powerUpId?: string | null,
): RobotDefinition {
  // A power-up only ever comes from the one the player equipped, never from the robot's own file.
  const { powerUp: _ignored, ...plain } = robot;
  const powerUp = cleanPowerUp(findReward(powerUpId, 'powerUp')?.powerUp);
  // A robot already in the player's own looks keeps them.
  const dressed: RobotDefinition = { ...(robot.customSkin ? plain : applySkin(plain, skinId)), ...(powerUp ? { powerUp } : {}) };
  if (dressed.pieceEffect) return dressed;
  const effect = cleanEffect(findReward(effectId, 'pieceEffect')?.effect);
  return effect ? { ...dressed, pieceEffect: effect } : dressed;
}

/** This season's rewards a player has the points for but has not claimed yet. */
export function claimableIds(rp: number, owned: Record<string, string>, pass: DrivePass = PASS): string[] {
  const mark = seasonMark(pass);
  return pass.tiers.filter((tier) => rp >= tier.rp && owned[tier.reward.id] !== mark).map((tier) => tier.reward.id);
}

/** What claiming some of this season's rewards leaves a player owning. Only rewards they have the points for are claimed. */
export function claim(ids: string[], rp: number, owned: Record<string, string>, pass: DrivePass = PASS): Record<string, string> {
  const ready = new Set(claimableIds(rp, owned, pass));
  const mark = seasonMark(pass);
  const claimed = ids.filter((id) => ready.has(id));
  return claimed.length === 0 ? owned : { ...owned, ...Object.fromEntries(claimed.map((id) => [id, mark])) };
}

/** Rivets a player has earned: from every Rivets reward they have claimed or kept. */
export function rivetsEarned(available: Set<string>): number {
  const seen = new Set<string>();
  let total = 0;
  for (const { reward } of ALL_REWARDS) {
    if (reward.type !== 'rivets' || !available.has(reward.id) || seen.has(reward.id)) continue;
    seen.add(reward.id);
    total += Math.max(0, Number(reward.amount) || 0);
  }
  return total;
}

/** Rivets a player has spent: what each Shop item they bought cost at the time. */
export function rivetsSpent(owned: Record<string, string>): number {
  return Object.values(owned).reduce((total, saved) => {
    const price = saved.startsWith(`${SHOP_MARK}:`) ? Number(saved.slice(SHOP_MARK.length + 1)) : 0;
    return total + (Number.isFinite(price) ? Math.max(0, price) : 0);
  }, 0);
}

/** A player's Rivets to spend: earned less spent, never below zero. */
export function rivetBalance(rp: number, owned: Record<string, string>): number {
  return Math.max(0, rivetsEarned(availableIds(rp, owned)) - rivetsSpent(owned));
}

/**
 * What buying a Shop item leaves a player owning, or why it cannot be bought.
 * The price paid is saved with it, so a later change of price leaves the balance alone.
 */
export function buy(itemId: string, rp: number, owned: Record<string, string>): { owned: Record<string, string> } | { error: string } {
  const item = SHOP.items.find((entry) => entry.reward.id === itemId);
  if (!item) return { error: 'That is not for sale.' };
  if (owns(owned, itemId, SHOP_MARK)) return { error: 'You already have it.' };
  if (rivetBalance(rp, owned) < item.price) return { error: 'Not enough Rivets.' };
  return { owned: { ...owned, [itemId]: boughtMark(item.price) } };
}

/** LED patterns a player may use: the free ones, and those they have unlocked. */
export function allowedLedPatterns(unlocked: Set<string>): Set<string> {
  return new Set(
    ALL_REWARDS.map((entry) => entry.reward)
      .filter((reward): reward is Extract<Reward, { type: 'led' }> => reward.type === 'led' && unlocked.has(reward.id))
      .map((reward) => reward.pattern),
  );
}

/** Themes that are rewards in the pass, by id. */
export const passThemes = (): Record<string, { name: string; colors: ThemeColors }> =>
  Object.fromEntries(
    ALL_REWARDS.map((entry) => entry.reward)
      .filter((reward): reward is Extract<Reward, { type: 'theme' }> => reward.type === 'theme')
      .map((reward) => [reward.id, { name: reward.name, colors: reward.colors }]),
  );
