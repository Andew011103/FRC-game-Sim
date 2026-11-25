import { useState } from 'react';
import { REWARD_TYPES, SHOP, PASS_ONLY_TYPES, buy, type RewardType, type ShopItem } from '../pass/pass';
import { OFFICIAL_ROBOTS } from '../robots';
import { RewardPreview, TierEditor, blankReward, useEquip } from './DrivePass';
import { useRankingPoints, useRivets, useUnlocked } from './passHooks';
import { openSkinInBuilder } from './skins';
import { useGame } from './store';
import { Rivet } from './Rivet';
import type { RobotWindow } from '../game';
import { useSkinWindows } from './skinWindows';

const TYPE_LABELS = Object.fromEntries(REWARD_TYPES.map(({ type, label }) => [type, label])) as Record<RewardType, string>;

/** The ways the Shop can be ordered. */
const SHOP_ORDERS = [
  { id: 'category', label: 'Category' },
  { id: 'price', label: 'Price' },
  { id: 'affordable', label: 'Can buy now' },
] as const;
type ShopOrder = (typeof SHOP_ORDERS)[number]['id'];
const ORDER_KEY = 'drive-practice.shop-order';

/** The order this player last picked, if the browser kept it. */
function savedOrder(): ShopOrder {
  try {
    const saved = localStorage.getItem(ORDER_KEY);
    return SHOP_ORDERS.some(({ id }) => id === saved) ? (saved as ShopOrder) : 'category';
  } catch {
    return 'category';
  }
}

/** The order kinds come in when the Shop is ordered by category. Any other kind follows, in the usual order. */
const CATEGORY_ORDER: RewardType[] = ['nameColor', 'badge', 'skin', 'led', 'powerUp'];
const CATEGORY_LABELS: Partial<Record<RewardType, string>> = { skin: 'Robot skins' };
const categories = (): RewardType[] => [
  ...CATEGORY_ORDER,
  ...REWARD_TYPES.map(({ type }) => type).filter((type) => !CATEGORY_ORDER.includes(type)),
];

const byPrice = (a: ShopItem, b: ShopItem) => a.price - b.price || a.reward.name.localeCompare(b.reward.name);

/**
 * The Shop's items in groups to show: by kind (name colors, badges, skins,
 * LED effects, power-ups, then the rest), cheapest first in each; all by price; or what the player can buy
 * right now first, then what they cannot afford yet, then what they own.
 */
export function orderShop(
  items: ShopItem[],
  order: ShopOrder,
  have: (id: string) => boolean,
  rivets: number,
): { title: string | null; items: ShopItem[] }[] {
  if (order === 'price') return [{ title: null, items: [...items].sort(byPrice) }];
  if (order === 'affordable') {
    const groups = [
      { title: 'Can buy now', items: items.filter((item) => !have(item.reward.id) && item.price <= rivets) },
      { title: 'Needs more Rivets', items: items.filter((item) => !have(item.reward.id) && item.price > rivets) },
      { title: 'Owned', items: items.filter((item) => have(item.reward.id)) },
    ];
    return groups.filter((group) => group.items.length > 0).map((group) => ({ ...group, items: group.items.sort(byPrice) }));
  }
  return categories()
    .map((type) => ({
      title: CATEGORY_LABELS[type] ?? TYPE_LABELS[type],
      items: items.filter((item) => item.reward.type === type).sort(byPrice),
    }))
    .filter((group) => group.items.length > 0);
}

/** The player's Rivets, for screen headers. */
export function RivetCount() {
  const rivets = useRivets();
  return (
    <span className="rivet-count" title="Rivets: earn them in the Drive Pass, spend them in the Shop">
      <Rivet />
      {rivets.toLocaleString()} <span className="muted">Rivets</span>
    </span>
  );
}

/**
 * The Shop: skins, cosmetics and power-ups bought with Rivets, which come
 * from the Drive Pass. Nothing here is in the Drive Pass, and no real money is
 * ever involved. Items are a file in the project (src/pass/shop.json), edited
 * here while developing.
 */
export function ShopScreen({ onWindows }: { onWindows: (windows: RobotWindow[]) => void }) {
  const setScreen = useGame((state) => state.setScreen);
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState<ShopOrder>(savedOrder);
  const unlocked = useUnlocked();
  const rivets = useRivets();
  const groups = orderShop(SHOP.items, order, (id) => unlocked.has(id), rivets);
  const pick = (next: ShopOrder) => {
    setOrder(next);
    try {
      localStorage.setItem(ORDER_KEY, next);
    } catch {
      // Not kept for next time; it still applies now.
    }
  };
  useSkinWindows(editing ? [] : groups.flatMap((group) => group.items.map((item) => item.reward)), onWindows);
  return (
    <div className="screen">
      <header className="screen-head">
        <button className="small" onClick={() => setScreen('home')}>
          Back
        </button>
        <h1>Shop</h1>
        <RivetCount />
        {import.meta.env.DEV && (
          <button className="small" onClick={() => setEditing(!editing)} title="Only while developing">
            {editing ? 'Close the editor' : 'Edit the shop'}
          </button>
        )}
      </header>
      <div className="screen-body pass-body">
        {editing ? (
          <ShopEditor onDone={() => setEditing(false)} />
        ) : (
          <>
            <p className="hint">
              Spend Rivets from the Drive Pass on items you can only get here. Power-ups boost your robot for a few seconds when you
              press <ShopKey />; equip one and it comes to every match.
            </p>
            {SHOP.items.length === 0 ? (
              <p className="hint">Nothing for sale yet.</p>
            ) : (
              <>
                <div className="shop-order">
                  <span className="muted">Order by</span>
                  <div className="toggle-pair" role="radiogroup" aria-label="Order the Shop by">
                    {SHOP_ORDERS.map(({ id, label }) => (
                      <button key={id} role="radio" aria-checked={order === id} className={order === id ? 'selected' : ''} onClick={() => pick(id)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {order === 'category' ? (
                  // One run of cards, each kind's name above its first card.
                  <div className="pass-road shop-grid shop-linear" data-clip>
                    {groups.flatMap((group) =>
                      group.items.map((item, i) => (
                        <div className="shop-slot" key={item.reward.id}>
                          <span className={`shop-slot-label${i === 0 ? '' : ' empty'}`} aria-hidden={i !== 0}>
                            {i === 0 ? group.title : '\u00a0'}
                          </span>
                          <ShopCard item={item} />
                        </div>
                      )),
                    )}
                  </div>
                ) : groups.map((group) => (
                  <section key={group.title ?? 'all'} className="shop-group">
                    {group.title && (
                      <h2 className="shop-group-title">
                        {group.title} <span className="muted">({group.items.length})</span>
                      </h2>
                    )}
                    <div className="pass-road shop-grid" data-clip>
                      {group.items.map((item) => (
                        <ShopCard key={item.reward.id} item={item} />
                      ))}
                    </div>
                  </section>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The key that switches a power-up on, as the player has it set. */
function ShopKey() {
  const key = useGame((state) => state.settings.keys.powerUp);
  return <kbd>{key.replace(/^Key|^Digit/, '')}</kbd>;
}

/** One item for sale: what it is, its price, and buying it, or equipping it once bought. */
function ShopCard({ item }: { item: ShopItem }) {
  const { reward, price } = item;
  const unlocked = useUnlocked();
  const rp = useRankingPoints();
  const rivets = useRivets();
  const updateSettings = useGame((state) => state.updateSettings);
  const owned = useGame((state) => state.settings.owned);
  const previewAll = useGame((state) => state.passPreviewAll);
  const { equipped, equip } = useEquip(reward);
  const [error, setError] = useState<string | null>(null);
  const have = unlocked.has(reward.id);

  const purchase = () => {
    const result = buy(reward.id, rp, owned);
    if ('error' in result) setError(result.error);
    else updateSettings({ owned: result.owned });
  };

  return (
    <article className={`card pass-card shop-card${have ? ' open' : ''}${equipped ? ' equipped' : ''}`}>
      <span className="pass-card-rp">
        <Rivet /> {price.toLocaleString()}
      </span>
      <span className="muted pass-card-type">{TYPE_LABELS[reward.type]}</span>
      <RewardPreview reward={reward} />
      <strong>{reward.name}</strong>
      {have && equip ? (
        <button className={equipped ? 'secondary' : 'primary'} onClick={equip}>
          {equipped ? 'Equipped: take off' : 'Equip'}
        </button>
      ) : have ? (
        <span className="muted">Owned</span>
      ) : (
        <button className="primary shop-buy" disabled={rivets < price} onClick={purchase}>
          {rivets < price ? `${(price - rivets).toLocaleString()} more Rivets needed` : `Buy for ${price.toLocaleString()} Rivets`}
        </button>
      )}
      {have && previewAll && !owned[reward.id] && <span className="muted pass-card-preview">Previewing</span>}
      {error && <span className="hint lobby-error">{error}</span>}
    </article>
  );
}

/**
 * Development only: changes what the Shop sells and saves it into the project
 * (src/pass/shop.json), where the published game reads it.
 */
function ShopEditor({ onDone }: { onDone: () => void }) {
  const [items, setItems] = useState<ShopItem[]>(() => JSON.parse(JSON.stringify(SHOP.items)));
  const [adding, setAdding] = useState<RewardType>('powerUp');
  const [skinRobot, setSkinRobot] = useState(OFFICIAL_ROBOTS[0]?.id ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const ids = items.map((item) => item.reward.id);
  const repeated = ids.find((id, i) => ids.indexOf(id) !== i);

  const save = async () => {
    try {
      const reply = await fetch('/__shop', { method: 'POST', body: JSON.stringify({ items: [...items].sort((a, b) => a.price - b.price) }) });
      if (!reply.ok) throw new Error();
      setMessage('Saved to src/pass/shop.json. The page reloads with the new shop.');
    } catch {
      setMessage('Could not save. This only works while running the game locally.');
    }
  };

  return (
    <section className="card pass-editor">
      <h2>Edit the Shop</h2>
      <p className="hint">
        Only on your computer. Saving writes src/pass/shop.json; commit it to publish. Prices are in Rivets. Each id must be unique
        (also apart from the Drive Pass) and should not change once players have bought the item. A price change leaves what earlier
        buyers paid alone.
      </p>
      {items.map((item, index) => (
        <TierEditor
          key={index}
          cost="Price (Rivets)"
          tier={{ rp: item.price, reward: item.reward }}
          onChange={(tier) => setItems(items.map((other, i) => (i === index ? { price: tier.rp, reward: tier.reward } : other)))}
          onRemove={() => setItems(items.filter((_, i) => i !== index))}
          onEditSkin={
            item.reward.type === 'skin'
              ? () => openSkinInBuilder((item.reward as { robotId: string }).robotId, { id: item.reward.id, name: item.reward.name, rp: item.price }, false, true)
              : undefined
          }
        />
      ))}
      <div className="button-row">
        <select value={adding} onChange={(event) => setAdding(event.target.value as RewardType)} aria-label="Kind of item to add">
          {REWARD_TYPES.filter(({ type }) => !PASS_ONLY_TYPES.includes(type)).map(({ type, label }) => (
            <option key={type} value={type}>
              {label}
            </option>
          ))}
        </select>
        <button
          className="secondary"
          onClick={() =>
            adding === 'skin'
              ? openSkinInBuilder(skinRobot, undefined, false, true)
              : setItems([...items, { price: 100, reward: blankReward(adding) }])
          }
        >
          {adding === 'skin' ? 'Make the skin in the robot builder' : 'Add item'}
        </button>
        {adding === 'skin' && (
          <select value={skinRobot} onChange={(event) => setSkinRobot(event.target.value)} aria-label="Robot to make a skin for">
            {OFFICIAL_ROBOTS.map((robot) => (
              <option key={robot.id} value={robot.id}>
                for {robot.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {adding === 'skin' && <p className="hint">Save any other changes here first: opening the builder leaves this editor.</p>}
      {repeated && <p className="hint lobby-error">Two items share the id "{repeated}". Give each its own.</p>}
      <div className="button-row">
        <button className="primary" disabled={!!repeated} onClick={() => void save()}>
          Save the shop
        </button>
        <button className="secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
      {message && <p className="hint">{message}</p>}
    </section>
  );
}
