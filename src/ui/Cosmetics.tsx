import { useState } from 'react';
import type { RobotWindow } from '../game';
import { allRewards, isChampionSkin, type Reward, type RewardType } from '../pass/pass';
import { useSkinWindows } from './skinWindows';
import { findRobot } from '../robots';
import { RewardCard } from './DrivePass';
import { useUnlocked } from './passHooks';

/** The kinds of reward a player puts on, in the order shown. */
const SECTIONS: { type: RewardType; title: string; empty: string }[] = [
  { type: 'skin', title: 'Robot skins', empty: 'No skins yet. Unlock them in the Drive Pass.' },
  { type: 'pieceEffect', title: 'Game piece effects', empty: 'No game piece effects yet. Unlock them in the Drive Pass.' },
  { type: 'nameColor', title: 'Name colors', empty: 'No name colors yet. Unlock them in the Drive Pass.' },
  { type: 'badge', title: 'Name badges', empty: 'No badges this season yet. Unlock them in the Drive Pass.' },
  { type: 'powerUp', title: 'Power-ups', empty: 'No power-ups yet. Buy them in the Shop with Rivets.' },
];

/**
 * Everything the player owns to wear, in one place, to put on or take off,
 * one tab for each kind. Shown on their own player page.
 */
export function CosmeticsSections({ onWindows }: { onWindows: (windows: RobotWindow[]) => void }) {
  const unlocked = useUnlocked();
  const owned = allRewards().filter((reward) => unlocked.has(reward.id));
  const [tab, setTab] = useState<RewardType>('skin');
  const section = SECTIONS.find((entry) => entry.type === tab) ?? SECTIONS[0];
  const rewards = sorted(owned.filter((reward) => reward.type === section.type));
  useSkinWindows(rewards, onWindows);
  return (
    <div className="cosmetics">
      <div className="toggle-pair screen-tabs" role="tablist" aria-label="Kinds of cosmetics">
        {SECTIONS.map(({ type, title }) => (
          <button key={type} role="tab" aria-selected={tab === type} className={tab === type ? 'selected' : ''} onClick={() => setTab(type)}>
            {title} ({owned.filter((reward) => reward.type === type).length})
          </button>
        ))}
      </div>
      {rewards.length === 0 ? (
        <p className="hint">{section.empty}</p>
      ) : (
        <div className="pass-road cosmetics-grid" data-clip>
          {rewards.map((reward) => (
            <RewardCard key={reward.id} tier={{ rp: -1, reward }} state="claimed" label={labelFor(reward)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Skins grouped by robot; everything else by name. */
function sorted(rewards: Reward[]): Reward[] {
  const key = (reward: Reward) => (reward.type === 'skin' ? `${findRobot(reward.robotId).name} ${reward.name}` : reward.name);
  return [...rewards].sort((a, b) => key(a).localeCompare(key(b)));
}

function labelFor(reward: Reward): string {
  if (reward.type === 'skin') return isChampionSkin(reward.id) ? 'Champion' : findRobot(reward.robotId).name;
  return 'Owned';
}
