import type { Reward } from '../pass/pass';

/** A name badge: its picture if it has one, otherwise its letters or emoji. */
export function BadgeMark({ reward }: { reward: Extract<Reward, { type: 'badge' }> }) {
  if (reward.image && reward.image.startsWith('data:image/')) {
    return <img className="badge-image" src={reward.image} alt={reward.name} />;
  }
  return <span aria-label={reward.name}>{reward.badge}</span>;
}
