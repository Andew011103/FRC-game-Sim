import { useState } from 'react';
import {
  PASS,
  REWARD_TYPES,
  RP_RULES,
  SEASON_DAYS,
  SHOP_ONLY_TYPES,
  availableIds,
  claim,
  claimableIds,
  keptRewards,
  type DrivePass,
  type Reward,
  type RewardType,
  type ThemeColors,
  type Tier,
} from '../pass/pass';
import { BOOST_STATS, POWER_TIMINGS, describePowerUp, type PowerUp } from '../pass/powerups';
import { RivetCount } from './Shop';
import { Rivet } from './Rivet';
import type { RobotWindow } from '../game';
import { skinWindowId, useSkinWindows } from './skinWindows';
import { OFFICIAL_ROBOTS, findRobot } from '../robots';
import { LED_PATTERNS } from '../sim/subsystems/led';
import { THEMES } from '../settings';
import { useRankingPoints, useUnlocked } from './passHooks';
import { useGame } from './store';
import { BadgeMark } from './BadgeMark';
import { SeasonCountdown } from './Leaderboard';
import { openSkinInBuilder } from './skins';
import { EffectPicker, EffectPreview } from './EffectPicker';
import { StyledName } from './StyledName';
import { MAX_GRADIENT, NAME_EDGES, NAME_EFFECTS, NAME_SPEED, cleanNameStyle, describeNameStyle, type NameStyleFields } from '../pass/nameStyle';
import { ALLIANCE_COLOR, PIECE_EFFECTS } from '../pass/effects';

const TYPE_LABELS = Object.fromEntries(REWARD_TYPES.map(({ type, label }) => [type, label])) as Record<RewardType, string>;

/** The Drive Pass: Ranking Points earned, and the road of rewards they unlock. */
export function DrivePassScreen({ onWindows }: { onWindows: (windows: RobotWindow[]) => void }) {
  const setScreen = useGame((state) => state.setScreen);
  const rp = useRankingPoints();
  const unlocked = useUnlocked();
  const previewAll = useGame((state) => state.passPreviewAll);
  const updateSettings = useGame((state) => state.updateSettings);
  const setPreviewAll = useGame((state) => state.setPassPreviewAll);
  const [editing, setEditing] = useState(false);
  const owned = useGame((state) => state.settings.owned);
  const kept = keptRewards(owned);
  // What the player has really claimed, apart from trying rewards out while developing.
  const claimed = availableIds(rp, owned);
  const claimable = claimableIds(rp, owned);
  const claimAll = () => updateSettings({ owned: claim(claimable, rp, owned) });
  useSkinWindows(editing ? [] : [...PASS.tiers.map((tier) => tier.reward), ...kept], onWindows);
  const next = PASS.tiers.find((tier) => tier.rp > rp);
  const previous = [...PASS.tiers].reverse().find((tier) => tier.rp <= rp)?.rp ?? 0;
  const progress = next ? (rp - previous) / Math.max(1, next.rp - previous) : 1;

  return (
    <div className="screen">
      <header className="screen-head">
        <button className="small" onClick={() => setScreen('home')}>
          Back
        </button>
        <h1>Drive Pass</h1>
        <span className="muted">
          {PASS.name} · ends in <SeasonCountdown />
        </span>
        <RivetCount />
        {import.meta.env.DEV && (
          <button className="small" onClick={() => setEditing(!editing)} title="Only while developing">
            {editing ? 'Close the editor' : 'Edit rewards'}
          </button>
        )}
      </header>

      <div className="screen-body pass-body">
        {editing ? (
          <PassEditor onDone={() => setEditing(false)} />
        ) : (
          <>
            <section className="card pass-summary">
              <div>
                <h2>Ranking Points this season</h2>
                <p className="pass-rp">{rp.toLocaleString()} RP</p>
                {claimable.length > 0 && (
                  <button className="primary pass-claim-all" onClick={claimAll}>
                    Claim {claimable.length === 1 ? 'your reward' : `all ${claimable.length} rewards`}
                  </button>
                )}
                {next ? (
                  <>
                    <div className="pass-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                      <div style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                    <p className="hint">
                      {next.rp - rp} RP to {next.reward.name}
                    </p>
                  </>
                ) : (
                  <p className="hint">Every reward unlocked. Well driven.</p>
                )}
              </div>
              <div>
                <h2>Earning RP</h2>
                <ul className="pass-rules">
                  {RP_RULES.map((rule) => (
                    <li key={rule.label}>
                      <span>{rule.label}</span>
                      <strong>+{rule.points}</strong>
                    </li>
                  ))}
                </ul>
                <p className="hint">
                  Points come from matches played this season, so they follow your account when you are signed in. Each new season
                  starts from zero; rewards you unlocked stay yours, except name badges, which belong to their season.
                </p>
              </div>
            </section>
            {import.meta.env.DEV && (
              <label className="check pass-dev">
                <input type="checkbox" checked={previewAll} onChange={(event) => setPreviewAll(event.target.checked)} />
                Treat every reward as unlocked, to try them out (only while developing)
              </label>
            )}
            {PASS.tiers.length === 0 && <p className="hint">No rewards yet.</p>}
            <div className="pass-road pass-track" data-clip>
              {PASS.tiers.map((tier, i) => {
                // Each reward's marker is in the middle of its stretch of rail: the left half fills from the
                // reward before, the right half on toward the next one.
                const from = i === 0 ? 0 : PASS.tiers[i - 1].rp;
                const to = PASS.tiers[i + 1]?.rp ?? tier.rp;
                const part = (value: number, start: number, end: number) => Math.min(1, Math.max(0, (value - start) / Math.max(1, end - start)));
                const fill = rp < tier.rp ? 0.5 * part(rp, from, tier.rp) : to > tier.rp ? 0.5 + 0.5 * part(rp, tier.rp, to) : 1;
                const reached = rp >= tier.rp;
                const state = claimed.has(tier.reward.id) ? 'claimed' : reached ? 'claimable' : 'locked';
                return (
                  <div className={`pass-step ${state}`} key={tier.reward.id}>
                    <RewardCard
                      tier={tier}
                      state={state}
                      preview={state !== 'claimed' && unlocked.has(tier.reward.id)}
                      onClaim={() => updateSettings({ owned: claim([tier.reward.id], rp, owned) })}
                    />
                    <div className="pass-rail" aria-hidden>
                      <div className="pass-rail-fill" style={{ width: `${Math.round(fill * 100)}%` }} />
                      <span className={`pass-node${reached ? ' lit' : ''}`}>{tier.rp}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {kept.length > 0 && (
              <>
                <h2>Kept from earlier seasons</h2>
                <div className="pass-road" data-clip>
                  {kept.map((reward) => (
                    <RewardCard key={reward.id} tier={{ rp: -1, reward }} state="claimed" />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Whether a reward is on, and how to put it on or take it off; or a note for rewards that are not worn. */
export function useEquip(reward: Reward): { equipped: boolean; equip: (() => void) | null; note: string | null } {
  const settings = useGame((state) => state.settings);
  const updateSettings = useGame((state) => state.updateSettings);
  let equipped = false;
  let equip: (() => void) | null = null;
  let note: string | null = null;
  if (reward.type === 'skin') {
    equipped = settings.skins[reward.robotId] === reward.id;
    equip = () => {
      const skins = { ...settings.skins };
      if (equipped) delete skins[reward.robotId];
      else skins[reward.robotId] = reward.id;
      updateSettings({ skins });
    };
  } else if (reward.type === 'nameColor') {
    equipped = settings.nameColor === reward.id;
    equip = () => updateSettings({ nameColor: equipped ? '' : reward.id });
  } else if (reward.type === 'badge') {
    equipped = settings.badge === reward.id;
    equip = () => updateSettings({ badge: equipped ? '' : reward.id });
  } else if (reward.type === 'pieceEffect') {
    equipped = settings.pieceEffect === reward.id;
    equip = () => updateSettings({ pieceEffect: equipped ? '' : reward.id });
  } else if (reward.type === 'theme') {
    equipped = settings.theme === reward.id;
    equip = () => updateSettings({ theme: equipped ? 'srpp' : reward.id });
  } else if (reward.type === 'powerUp') {
    equipped = settings.powerUp === reward.id;
    equip = () => updateSettings({ powerUp: equipped ? '' : reward.id });
  } else if (reward.type === 'rivets') {
    note = 'Added to your Rivets, to spend in the Shop.';
  } else {
    note = 'Use it on LED strips in the robot builder.';
  }
  return { equipped, equip, note };
}

/**
 * One reward: what it is and what it needs. Once reached it lights up to be
 * claimed, and only once claimed can it be equipped. With `preview`, a reward
 * not yet the player's can be tried on, while developing.
 */
export function RewardCard({
  tier,
  state,
  preview = false,
  onClaim,
  label,
}: {
  tier: Tier;
  state: 'claimed' | 'claimable' | 'locked';
  preview?: boolean;
  onClaim?: () => void;
  label?: string;
}) {
  const { reward } = tier;
  const { equipped, equip, note } = useEquip(reward);
  const open = state === 'claimed' || preview;

  return (
    <article className={`card pass-card ${state}${open ? ' open' : ''}${equipped ? ' equipped' : ''}`}>
      <span className="pass-card-rp">{label ?? (tier.rp >= 0 ? `${tier.rp} RP` : 'Kept')}</span>
      <span className="muted pass-card-type">{TYPE_LABELS[reward.type]}</span>
      <RewardPreview reward={reward} />
      <strong>{reward.name}</strong>
      {state === 'claimable' && onClaim ? (
        <button className="primary pass-claim" onClick={onClaim}>
          Claim
        </button>
      ) : !open ? (
        <span className="muted">🔒 Locked</span>
      ) : equip ? (
        <button className={equipped ? 'secondary' : 'primary'} onClick={equip}>
          {equipped ? 'Equipped: take off' : 'Equip'}
        </button>
      ) : (
        <span className="hint">{note}</span>
      )}
      {preview && state !== 'claimed' && <span className="muted pass-card-preview">Previewing</span>}
    </article>
  );
}

export function RewardPreview({ reward }: { reward: Reward }) {
  const name = useGame((state) => state.settings.displayName);
  if (reward.type === 'rivets') {
    return (
      <span className="pass-preview pass-rivets">
        <Rivet /> +{reward.amount}
      </span>
    );
  }
  if (reward.type === 'powerUp') return <PowerUpPreview power={reward.powerUp} />;
  if (reward.type === 'nameColor') {
    return (
      <span className="pass-preview pass-name">
        <StyledName text={name} style={reward} />
      </span>
    );
  }
  if (reward.type === 'badge') {
    return (
      <span className="pass-preview pass-badge">
        <BadgeMark reward={reward} />
      </span>
    );
  }
  if (reward.type === 'led') {
    return <span className={`pass-preview pass-led pass-led-${reward.pattern}`} aria-label={`${reward.pattern} pattern`} />;
  }
  if (reward.type === 'pieceEffect') return <EffectPreview effect={reward.effect} />;
  if (reward.type === 'theme') {
    const { bg, panel, accent, text, good, warn } = reward.colors;
    return (
      <span className="pass-preview pass-swatches">
        {[bg, panel, accent, text, good, warn].map((color, i) => (
          <i key={i} style={{ background: color }} />
        ))}
      </span>
    );
  }
  const robot = findRobot(reward.robotId);
  return (
    <span className="pass-preview pass-skin">
      {/* The robot wearing the skin, drawn in 3D over this box. */}
      <span className="pass-skin-window" id={skinWindowId(reward.id)} />
      <span className="muted">
        for {robot.id === reward.robotId ? robot.name : reward.robotId}
        {(reward.extras?.length ?? 0) > 0 ? `, ${reward.extras.length} added parts` : ''}
        {reward.pieceEffect ? `, ${PIECE_EFFECTS.find((effect) => effect.value === reward.pieceEffect?.kind)?.label.split(':')[0] ?? 'game piece'} effect` : ''}
      </span>
    </span>
  );
}

/** A power-up's mark in its color, and what it does. */
export function PowerUpPreview({ power }: { power: PowerUp }) {
  return (
    <span className="pass-preview pass-power">
      <i style={{ '--power': power.color } as React.CSSProperties}>
        <PowerMark power={power} />
      </i>
      <span className="muted">{describePowerUp(power)}</span>
    </span>
  );
}

/** A power-up's picture, or its emoji or letters when it has none. */
export function PowerMark({ power }: { power: { icon: string; image?: string } }) {
  return power.image ? <img className="power-image" src={power.image} alt="" /> : <>{power.icon}</>;
}

/** A fresh reward of a type, with a new id. */
export function blankReward(type: RewardType): Reward {
  const id = `${type}-${Date.now().toString(36)}`;
  if (type === 'rivets') return { type, id, name: '50 Rivets', amount: 50 };
  if (type === 'powerUp') {
    return {
      type,
      id,
      name: 'New power-up',
      powerUp: { icon: '⚡', color: '#38bdf8', duration: 5, cooldown: 25, uses: 3, boosts: { driveSpeed: 1.2 } },
    };
  }
  if (type === 'skin') return { type, id, name: 'New skin', robotId: OFFICIAL_ROBOTS[0]?.id ?? '', recolors: [], extras: [] };
  if (type === 'nameColor') return { type, id, name: 'New name color', color: '#38bdf8' };
  if (type === 'badge') return { type, id, name: 'New badge', badge: '⭐' };
  if (type === 'led') return { type, id, name: 'New LED effect', pattern: LED_PATTERNS.find((p) => !p.free)?.value ?? 'strobe' };
  if (type === 'pieceEffect') return { type, id, name: 'New game piece effect', effect: { kind: 'glow', color: ALLIANCE_COLOR } };
  return { type, id, name: 'New theme', colors: { ...(THEMES.srpp.colors as ThemeColors) } };
}

/**
 * Development only: changes the road of rewards and saves it into the
 * project (src/pass/drive-pass.json), where the published game reads it.
 */
const DAY = 86400000;

/** How many days a season runs, to a tenth of a day, or undefined for a season with no real start. */
function seasonDays(pass: DrivePass): number | undefined {
  const start = new Date(pass.startedAt);
  if (start.getFullYear() <= 2000) return undefined;
  return Math.round(((new Date(pass.endsAt).getTime() - start.getTime()) / DAY) * 10) / 10;
}

function PassEditor({ onDone }: { onDone: () => void }) {
  const [pass, setPass] = useState<DrivePass>(() => JSON.parse(JSON.stringify(PASS)));
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState<RewardType>('skin');
  const [skinRobot, setSkinRobot] = useState(OFFICIAL_ROBOTS[0]?.id ?? '');
  const change = (index: number, tier: Tier) => setPass({ ...pass, tiers: pass.tiers.map((other, i) => (i === index ? tier : other)) });
  // Ids must be unique across every season, since players keep rewards by their id.
  const ids = [...pass.tiers, ...pass.past.flatMap((season) => season.tiers)].map((tier) => tier.reward.id);
  const repeated = ids.find((id, i) => ids.indexOf(id) !== i);
  const [nextName, setNextName] = useState('');
  const [nextDays, setNextDays] = useState(SEASON_DAYS);
  const [championRobot, setChampionRobot] = useState(OFFICIAL_ROBOTS[0]?.id ?? '');

  /** Ends this season: its rewards are kept for those who earned them, and a new, empty season starts now. */
  const startSeason = () => {
    const number = pass.past.length + 2;
    const now = Date.now();
    setPass({
      id: `season-${number}-${now.toString(36)}`,
      name: nextName.trim() || `Drive Pass: Season ${number}`,
      startedAt: new Date(now).toISOString(),
      endsAt: new Date(now + Math.max(1, nextDays) * 86400000).toISOString(),
      // Champion skins carry on into the new season, for its new champions.
      champions: pass.champions,
      tiers: [],
      past: [...pass.past, { id: pass.id, name: pass.name, startedAt: pass.startedAt, tiers: pass.tiers }],
    });
    setNextName('');
    setMessage('New season ready. It starts once you save the pass: everyone\'s Ranking Points begin again from zero.');
  };

  const save = async () => {
    const sorted = { ...pass, tiers: [...pass.tiers].sort((a, b) => a.rp - b.rp) };
    try {
      const reply = await fetch('/__drive-pass', { method: 'POST', body: JSON.stringify(sorted) });
      if (!reply.ok) throw new Error();
      setMessage('Saved to src/pass/drive-pass.json. The page reloads with the new pass.');
    } catch {
      setMessage('Could not save. This only works while running the game locally.');
    }
  };

  return (
    <section className="card pass-editor">
      <h2>Edit the Drive Pass</h2>
      <p className="hint">
        Only on your computer. Saving writes src/pass/drive-pass.json; commit it to publish the pass. Rewards are listed by the Ranking
        Points they need. Each id must be unique and should not change once players have the reward, as their choices are saved by it.
      </p>
      <label className="field">
        <span>Season name</span>
        <input type="text" value={pass.name} onChange={(event) => setPass({ ...pass, name: event.target.value })} />
      </label>
      <p className="hint">
        {new Date(pass.startedAt).getFullYear() <= 2000
          ? 'This first season counts every match played.'
          : new Date(pass.startedAt).getTime() > Date.now()
            ? `This season starts ${new Date(pass.startedAt).toLocaleString()}.`
            : `This season started ${new Date(pass.startedAt).toLocaleString()}.`}
        {pass.past.length > 0 && ` Earlier seasons: ${pass.past.map((season) => season.name).join(', ')}.`}
      </p>
      <label className="field">
        <span>Season starts (only matches from then on earn Ranking Points)</span>
        <input
          type="datetime-local"
          value={toLocalInput(pass.startedAt)}
          onChange={(event) => {
            if (!event.target.value) return;
            // Moving the start keeps the season just as long, or the usual length if it had none.
            const start = new Date(event.target.value).getTime();
            const length = seasonDays(pass) ?? SEASON_DAYS;
            setPass({ ...pass, startedAt: new Date(start).toISOString(), endsAt: new Date(start + length * DAY).toISOString() });
          }}
        />
      </label>
      <label className="field">
        <span>Season lasts (days)</span>
        <input
          type="number"
          min={1}
          max={365}
          value={seasonDays(pass) ?? ''}
          onChange={(event) => {
            const days = Number(event.target.value);
            if (days >= 1) setPass({ ...pass, endsAt: new Date(new Date(pass.startedAt).getTime() + days * DAY).toISOString() });
          }}
        />
      </label>
      <label className="field">
        <span>Season ends (for the countdown)</span>
        <input
          type="datetime-local"
          value={toLocalInput(pass.endsAt)}
          onChange={(event) => event.target.value && setPass({ ...pass, endsAt: new Date(event.target.value).toISOString() })}
        />
      </label>
      <details className="pass-new-season">
        <summary>Champion skins ({pass.champions.length})</summary>
        <p className="hint">
          One per robot, worn only by whoever is first on that robot's leaderboard this season, for as long as they stay first. Made in
          the robot builder like other skins. Save any changes here first: opening the builder leaves this editor.
        </p>
        <ul className="pass-champions">
          {pass.champions.map((skin) => (
            <li key={skin.id}>
              <span>
                {findRobot(skin.robotId).name}: {skin.name}
              </span>
              <button className="small" onClick={() => openSkinInBuilder(skin.robotId, { id: skin.id, name: skin.name, rp: 0 }, true)}>
                Edit in the robot builder
              </button>
              <button className="small danger" onClick={() => setPass({ ...pass, champions: pass.champions.filter((other) => other.id !== skin.id) })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="button-row">
          <select value={championRobot} onChange={(event) => setChampionRobot(event.target.value)} aria-label="Robot to make a champion skin for">
            {OFFICIAL_ROBOTS.map((robot) => (
              <option key={robot.id} value={robot.id}>
                {robot.name}
                {pass.champions.some((skin) => skin.robotId === robot.id) ? ' (has one)' : ''}
              </option>
            ))}
          </select>
          <button className="secondary" onClick={() => openSkinInBuilder(championRobot, undefined, true)}>
            Make a champion skin in the robot builder
          </button>
        </div>
      </details>
      <details className="pass-new-season">
        <summary>Start a new season</summary>
        <p className="hint">
          Ends this season. Everyone's Ranking Points start again from zero, counting only matches from now on. Rewards players
          unlocked this season stay theirs, except name badges. This season's rewards leave the road; add the new season's after.
        </p>
        <div className="button-row">
          <input type="text" placeholder="New season's name" value={nextName} onChange={(event) => setNextName(event.target.value)} />
          <label>
            Lasting{' '}
            <input type="number" min={1} max={365} value={nextDays} onChange={(event) => setNextDays(Number(event.target.value) || SEASON_DAYS)} /> days
          </label>
          <button className="secondary" onClick={startSeason}>
            Start the new season
          </button>
        </div>
      </details>
      {pass.tiers.map((tier, index) => (
        <TierEditor
          key={index}
          tier={tier}
          onChange={(next) => change(index, next)}
          onRemove={() => setPass({ ...pass, tiers: pass.tiers.filter((_, i) => i !== index) })}
        />
      ))}
      <div className="button-row">
        <select value={adding} onChange={(event) => setAdding(event.target.value as RewardType)} aria-label="Kind of reward to add">
          {REWARD_TYPES.filter(({ type }) => !SHOP_ONLY_TYPES.includes(type)).map(({ type, label }) => (
            <option key={type} value={type}>
              {label}
            </option>
          ))}
        </select>
        <button
          className="secondary"
          onClick={() =>
            adding === 'skin'
              ? openSkinInBuilder(skinRobot)
              : setPass({ ...pass, tiers: [...pass.tiers, { rp: (pass.tiers.at(-1)?.rp ?? 0) + 100, reward: blankReward(adding) }] })
          }
        >
          {adding === 'skin' ? 'Make the skin in the robot builder' : 'Add reward'}
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
      {adding === 'skin' && (
        <p className="hint">Save any other changes here first: opening the builder leaves this editor.</p>
      )}
      {repeated && <p className="hint lobby-error">Two rewards share the id "{repeated}". Give each its own.</p>}
      <div className="button-row">
        <button className="primary" disabled={!!repeated} onClick={() => void save()}>
          Save the pass
        </button>
        <button className="secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
      {message && <p className="hint">{message}</p>}
    </section>
  );
}

/**
 * Changes one reward: what it costs (Ranking Points on the road, or Rivets in
 * the Shop, as `cost` says), its name and id, and what it is.
 */
export function TierEditor({
  tier,
  onChange,
  onRemove,
  cost = 'RP',
  onEditSkin,
}: {
  tier: Tier;
  onChange: (tier: Tier) => void;
  onRemove: () => void;
  cost?: string;
  onEditSkin?: () => void;
}) {
  const { reward } = tier;
  const set = (change: Partial<Reward>) => onChange({ ...tier, reward: { ...reward, ...change } as Reward });
  return (
    <div className="pass-tier-editor">
      <div className="pass-tier-row">
        <label>
          {cost}
          <input type="number" min={0} step={10} value={tier.rp} onChange={(event) => onChange({ ...tier, rp: Math.max(0, Number(event.target.value) || 0) })} />
        </label>
        <span className="muted">{TYPE_LABELS[reward.type]}</span>
        <label>
          Name
          <input type="text" value={reward.name} onChange={(event) => set({ name: event.target.value })} />
        </label>
        <label>
          Id
          <input type="text" value={reward.id} onChange={(event) => set({ id: event.target.value.replace(/[^a-z0-9-]/gi, '').toLowerCase() })} />
        </label>
        <button className="small danger" onClick={onRemove}>
          Remove
        </button>
      </div>
      <div className="pass-tier-row">
        {reward.type === 'nameColor' && <NameStyleEditor style={reward} onChange={(change) => set(change)} />}
        {reward.type === 'badge' && (
          <>
            <label>
              Badge (an emoji or up to 3 letters)
              <input type="text" maxLength={4} value={reward.badge} onChange={(event) => set({ badge: event.target.value })} />
            </label>
            <label>
              Or a picture (shown instead)
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void badgePicture(file).then((image) => set({ image }));
                  event.target.value = '';
                }}
              />
            </label>
            {reward.image && (
              <span className="pass-skin-part">
                <BadgeMark reward={reward} />
                <button className="small" onClick={() => set({ image: undefined })}>
                  Remove picture
                </button>
              </span>
            )}
          </>
        )}
        {reward.type === 'led' && (
          <label>
            Pattern
            <select value={reward.pattern} onChange={(event) => set({ pattern: event.target.value })}>
              {LED_PATTERNS.filter((pattern) => !pattern.free).map((pattern) => (
                <option key={pattern.value} value={pattern.value}>
                  {pattern.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {reward.type === 'pieceEffect' && <EffectPicker value={reward.effect} onChange={(effect) => effect && set({ effect })} />}
        {reward.type === 'rivets' && (
          <label>
            Rivets given
            <input
              type="number"
              min={1}
              max={100000}
              step={5}
              value={reward.amount}
              onChange={(event) => set({ amount: Math.max(1, Math.round(Number(event.target.value) || 1)) })}
            />
          </label>
        )}
        {reward.type === 'powerUp' && <PowerUpEditor power={reward.powerUp} onChange={(powerUp) => set({ powerUp })} />}
        {reward.type === 'theme' &&
          (Object.keys(reward.colors) as (keyof ThemeColors)[]).map((key) => (
            <label key={key}>
              {key}
              <input
                type="text"
                value={reward.colors[key]}
                onChange={(event) => set({ colors: { ...reward.colors, [key]: event.target.value } })}
              />
            </label>
          ))}
        {reward.type === 'skin' && (
          <>
            <span className="muted">
              For {findRobot(reward.robotId).name}: {(reward.recolors ?? []).filter(Boolean).length} parts recolored,{' '}
              {reward.extras?.length ?? 0} added.
            </span>
            <button className="small" onClick={() => (onEditSkin ? onEditSkin() : openSkinInBuilder(reward.robotId, { id: reward.id, name: reward.name, rp: tier.rp }))}>
              Edit in the robot builder
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Choosing what a power-up looks like, how long it lasts, and what it boosts, within fixed limits. */
function PowerUpEditor({ power, onChange }: { power: PowerUp; onChange: (power: PowerUp) => void }) {
  return (
    <>
      <label>
        Mark (an emoji or letters)
        <input type="text" maxLength={4} value={power.icon} onChange={(event) => onChange({ ...power, icon: event.target.value })} />
      </label>
      <label>
        Or a picture (shown instead)
        <input
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void badgePicture(file).then((image) => onChange({ ...power, image }));
            event.target.value = '';
          }}
        />
      </label>
      {power.image && (
        <span className="pass-skin-part">
          <span className="pass-power">
            <i style={{ '--power': power.color } as React.CSSProperties}>
              <PowerMark power={power} />
            </i>
          </span>
          <button
            className="small"
            onClick={() => {
              const { image: _old, ...rest } = power;
              onChange(rest);
            }}
          >
            Remove picture
          </button>
        </span>
      )}
      <ColorInput label="Glow color" value={power.color} onChange={(color) => onChange({ ...power, color })} />
      {POWER_TIMINGS.map((timing) => (
        <label key={timing.key}>
          {timing.label}
          {timing.unit && ` (${timing.unit})`}
          <input
            type="number"
            min={timing.min}
            max={timing.max}
            step={timing.step}
            value={power[timing.key]}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) onChange({ ...power, [timing.key]: Math.min(timing.max, Math.max(timing.min, value)) });
            }}
          />
        </label>
      ))}
      {BOOST_STATS.map((stat) => {
        const current = power.boosts[stat.key] ?? 1;
        return (
          <label key={stat.key}>
            {stat.label}: ×{current.toFixed(2)}
            <input
              type="range"
              min={1}
              max={stat.max}
              step={0.05}
              value={current}
              onChange={(event) => {
                const value = Number(event.target.value);
                const boosts = { ...power.boosts };
                if (value <= 1) delete boosts[stat.key];
                else boosts[stat.key] = Math.round(value * 100) / 100;
                onChange({ ...power, boosts });
              }}
            />
          </label>
        );
      })}
      <span className="muted">{describePowerUp(power)}</span>
    </>
  );
}

/**
 * The look of a name color: its colors (one, or several for a gradient), an
 * outline or glow, and an animation, with the name drawn as it will look.
 */
function NameStyleEditor({ style, onChange }: { style: NameStyleFields; onChange: (change: Partial<NameStyleFields>) => void }) {
  const name = useGame((state) => state.settings.displayName) || 'Your name';
  const clean = cleanNameStyle(style);
  const gradient = clean.colors.slice(1);
  const animated = clean.effect !== 'none';
  return (
    <div className="name-style-editor">
      <div className="pass-tier-row">
        <ColorInput label={gradient.length ? 'Color 1' : 'Name color'} value={style.color} onChange={(color) => onChange({ color })} />
        {gradient.map((color, i) => (
          <span key={i} className="pass-skin-part">
            <ColorInput
              label={`Color ${i + 2}`}
              value={color}
              onChange={(next) => onChange({ gradient: gradient.map((other, j) => (j === i ? next : other)) })}
            />
            <button className="small secondary" onClick={() => onChange({ gradient: gradient.filter((_, j) => j !== i) })} title="Remove this color">
              ✕
            </button>
          </span>
        ))}
        {gradient.length < MAX_GRADIENT && (
          <button className="small secondary" onClick={() => onChange({ gradient: [...gradient, gradient.at(-1) ?? clean.colors[0]] })}>
            {gradient.length ? 'Add a color' : 'Make it a gradient'}
          </button>
        )}
      </div>
      <div className="pass-tier-row">
        <label>
          Edge
          <select
            value={clean.outline ? clean.edge : 'none'}
            onChange={(event) =>
              event.target.value === 'none'
                ? onChange({ outline: '' })
                : onChange({ edge: event.target.value as NameStyleFields['edge'], outline: clean.outline || '#000000' })
            }
          >
            <option value="none">None</option>
            {NAME_EDGES.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {clean.outline && <ColorInput label="Edge color" value={clean.outline} onChange={(outline) => onChange({ outline })} />}
        <label>
          Animation
          <select value={clean.effect} onChange={(event) => onChange({ effect: event.target.value as NameStyleFields['effect'] })}>
            {NAME_EFFECTS.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {animated && (
          <label>
            One cycle: {clean.speed.toFixed(1)} s
            <input
              type="range"
              min={NAME_SPEED.least}
              max={NAME_SPEED.most}
              step={0.1}
              value={clean.speed}
              onChange={(event) => onChange({ speed: Number(event.target.value) })}
            />
          </label>
        )}
      </div>
      <div className="name-style-sample">
        <StyledName text={name} style={style} />
        <span className="muted">{describeNameStyle(clean) || 'Plain color'}</span>
      </div>
    </div>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  return (
    <label>
      {label}
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/** How big a badge picture is stored: small, as it is only ever shown beside a name. */
const BADGE_SIZE = 64;

/** A picture made into a small square badge, as a data URL kept in the pass file. */
async function badgePicture(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = BADGE_SIZE;
  canvas.height = BADGE_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no canvas');
  const scale = Math.min(BADGE_SIZE / bitmap.width, BADGE_SIZE / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(bitmap, (BADGE_SIZE - width) / 2, (BADGE_SIZE - height) / 2, width, height);
  bitmap.close();
  return canvas.toDataURL('image/png');
}

/** An ISO date as the value a datetime-local box shows, in the player's own time zone. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
