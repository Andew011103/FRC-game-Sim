import { allRewards, isChampionSkin, type Reward, type RewardType } from '../pass/pass';
import { findRobot } from '../robots';
import { RewardCard } from './DrivePass';
import { useUnlocked } from './passHooks';

/** The kinds of reward a player puts on, in the order shown. */
const SECTIONS: { type: RewardType; title: string; empty: string }[] = [
  { type: 'skin', title: 'Robot skins', empty: 'No skins yet. Unlock them in the Drive Pass.' },
  { type: 'pieceEffect', title: 'Game piece effects', empty: 'No game piece effects yet. Unlock them in the Drive Pass.' },
  { type: 'nameColor', title: 'Name colours', empty: 'No name colours yet. Unlock them in the Drive Pass.' },
  { type: 'badge', title: 'Name badges', empty: 'No badges this season yet. Unlock them in the Drive Pass.' },
];

/** Everything the player owns to wear, in one place, to put on or take off. Shown on their own record page. */
export function CosmeticsSections() {
  const unlocked = useUnlocked();
  const owned = allRewards().filter((reward) => unlocked.has(reward.id));
  return (
    <div className="cosmetics">
      <h2 className="cosmetics-title">Cosmetics</h2>
      <p className="hint">What you have unlocked in the Drive Pass, to equip or take off.</p>
      {SECTIONS.map(({ type, title, empty }) => {
        const rewards = owned.filter((reward) => reward.type === type);
        return (
          <section key={type}>
            <h3>{title}</h3>
            {rewards.length === 0 ? (
              <p className="hint">{empty}</p>
            ) : (
              <div className="pass-road" data-clip>
                {sorted(rewards).map((reward) => (
                  <RewardCard key={reward.id} tier={{ rp: -1, reward }} open reached label={labelFor(reward)} />
                ))}
              </div>
            )}
          </section>
        );
      })}
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
