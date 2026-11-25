import { useEffect } from 'react';
import type { RobotWindow } from '../game';
import { applySkin, type Reward } from '../pass/pass';
import { findRobot } from '../robots';
import { useGame } from './store';

/** The id of the box a skin's robot is drawn over. */
export const skinWindowId = (rewardId: string) => `skin-window-${rewardId}`;

/**
 * Draws each skin among these rewards as its robot in 3D, turning, over the
 * box its card shows. Rewards that are not skins are left alone.
 */
export function useSkinWindows(rewards: Reward[], onWindows: (windows: RobotWindow[]) => void): void {
  const ready = useGame((state) => state.ready);
  const alliance = useGame((state) => state.alliance);
  const skins = rewards.filter((reward): reward is Extract<Reward, { type: 'skin' }> => reward.type === 'skin');
  // Only a change in which skins are shown builds the windows again.
  const key = skins.map((skin) => skin.id).join(' ');
  useEffect(() => {
    if (!ready) return;
    onWindows(
      skins.map((skin) => ({
        elementId: skinWindowId(skin.id),
        robot: applySkin(findRobot(skin.robotId), skin.id),
        alliance,
        spin: true,
      })),
    );
    return () => onWindows([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, alliance, onWindows]);
}
