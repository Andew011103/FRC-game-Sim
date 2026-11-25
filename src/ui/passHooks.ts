import { allRewardIds, availableIds, championSkinFor, rankingPoints, rivetBalance } from '../pass/pass';
import { useGame } from './store';

/** This player's Ranking Points this season, from their record (their account's when signed in). */
export function useRankingPoints(): number {
  const award = useGame((state) => state.awardRp);
  return rankingPoints(useGame((state) => state.seasonRecord)) + award;
}

/** This player's Rivets to spend in the Shop. */
export function useRivets(): number {
  const rp = useRankingPoints();
  const owned = useGame((state) => state.settings.owned);
  return rivetBalance(rp, owned);
}

/** Outside the screens: whether this player really has a reward right now (or is trying every reward out, while developing). */
export function hasRewardNow(id: string): boolean {
  if (!id) return false;
  const state = useGame.getState();
  if (state.passPreviewAll) return true;
  return availableIds(rankingPoints(state.seasonRecord) + state.awardRp, state.settings.owned).has(id);
}

/**
 * The rewards this player has unlocked. While developing, the pass screen can
 * treat every reward as unlocked, to try them out.
 */
export function useUnlocked(): Set<string> {
  const rp = useRankingPoints();
  const all = useGame((state) => state.passPreviewAll);
  const owned = useGame((state) => state.settings.owned);
  const champions = useGame((state) => state.champions);
  if (all) return allRewardIds();
  const ids = availableIds(rp, owned);
  // A champion skin is there for as long as its player stays first on that robot's board.
  for (const robot of champions) {
    const skin = championSkinFor(robot);
    if (skin) ids.add(skin.id);
  }
  return ids;
}
