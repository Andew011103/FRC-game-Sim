import { PASS, SHOP, applySkin, skinFrom, type Tier } from '../pass/pass';
import { findRobot } from '../robots';
import { sanitizeRobot } from '../robots/custom';
import type { RobotDefinition } from '../robots/types';
import { useGame } from './store';

// Drive Pass skins are made in the robot builder, while developing: a copy of
// an official robot whose mechanisms can only be recolored, with see-through
// structures and LED strips added on. Saving turns the copy back into a skin.

/**
 * Opens the builder on a skin for an official robot: a new one, or one already
 * in the pass or the Shop. For the Shop, `rp` is its price in Rivets.
 */
export function openSkinInBuilder(robotId: string, existing?: { id: string; name: string; rp: number }, champion = false, shop = false): void {
  const base = findRobot(robotId);
  const dressed = existing ? applySkin(base, existing.id) : base;
  const rewardId = existing?.id ?? `${champion ? 'champion' : shop ? 'shop-skin' : 'skin'}-${robotId}-${Date.now().toString(36)}`;
  const rp = existing?.rp ?? (shop ? 100 : (PASS.tiers.at(-1)?.rp ?? 0) + 100);
  const draft = sanitizeRobot({
    ...dressed,
    id: undefined,
    name: existing?.name ?? `${base.name} ${champion ? 'Champion' : 'skin'}`,
    skinOf: { robotId: base.id, rewardId, rp, ...(champion ? { champion: true } : {}), ...(shop ? { shop: true } : {}) },
  });
  if (!draft) return;
  const state = useGame.getState();
  state.saveRobot(draft);
  state.setBuilderFocus(draft.id);
  state.setScreen('builder');
}

/** The skin a builder copy amounts to, ready to go in the pass. */
export function skinOfDraft(draft: RobotDefinition): Tier | null {
  if (!draft.skinOf) return null;
  const base = findRobot(draft.skinOf.robotId);
  if (base.id !== draft.skinOf.robotId) return null;
  // Compared with the robot as the builder sees it, so only real changes count.
  const clean = sanitizeRobot({ ...base, id: undefined });
  if (!clean) return null;
  const reward = skinFrom(draft, { ...clean, id: base.id }, { id: draft.skinOf.rewardId, name: draft.name });
  return { rp: draft.skinOf.rp, reward };
}

/** Saves a skin made in the builder into the Drive Pass file. Returns what happened, for the player. */
export async function saveSkinToPass(draft: RobotDefinition): Promise<string> {
  const tier = skinOfDraft(draft);
  if (!tier) return 'This robot is not a skin for an official robot.';
  const skin = tier.reward as (typeof PASS.champions)[number];
  // A Shop skin goes in the Shop, at its price in Rivets.
  if (draft.skinOf?.shop) {
    const items = [...SHOP.items.filter((item) => item.reward.id !== skin.id), { price: tier.rp, reward: skin }].sort((a, b) => a.price - b.price);
    try {
      const reply = await fetch('/__shop', { method: 'POST', body: JSON.stringify({ items }) });
      if (!reply.ok) throw new Error();
      return `Saved "${skin.name}" to the Shop for ${tier.rp} Rivets. The page reloads with it.`;
    } catch {
      return 'Could not save. This only works while running the game locally.';
    }
  }
  // A champion skin goes in the champions list (one per robot), any other on the road of rewards.
  const next = draft.skinOf?.champion
    ? { ...PASS, champions: [...PASS.champions.filter((other) => other.robotId !== skin.robotId && other.id !== skin.id), skin] }
    : { ...PASS, tiers: [...PASS.tiers.filter((other) => other.reward.id !== tier.reward.id), tier].sort((a, b) => a.rp - b.rp) };
  try {
    const reply = await fetch('/__drive-pass', { method: 'POST', body: JSON.stringify(next) });
    if (!reply.ok) throw new Error();
    return draft.skinOf?.champion
      ? `Saved "${skin.name}" as the champion skin for its robot. The page reloads with it.`
      : `Saved "${tier.reward.name}" to the Drive Pass at ${tier.rp} RP. The page reloads with it.`;
  } catch {
    return 'Could not save. This only works while running the game locally.';
  }
}
