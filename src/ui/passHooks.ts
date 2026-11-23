import { allRewardIds, availableIds, championSkinFor, rankingPoints } from '../pass/pass';
import { useGame } from './store';

/** This player's Ranking Points this season, from their record (their account's when signed in). */
export function useRankingPoints(): number {
  const award = useGame((state) => state.awardRp);
  return rankingPoints(useGame((state) => state.seasonRecord)) + award;
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
