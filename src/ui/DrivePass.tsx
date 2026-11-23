import { useState } from 'react';
import { PASS, REWARD_TYPES, RP_RULES, SEASON_DAYS, keptRewards, type DrivePass, type Reward, type RewardType, type ThemeColors, type Tier } from '../pass/pass';
import { OFFICIAL_ROBOTS, findRobot } from '../robots';
import { LED_PATTERNS } from '../sim/subsystems/led';
import { THEMES } from '../settings';
import { useRankingPoints, useUnlocked } from './passHooks';
import { useGame } from './store';
import { BadgeMark } from './BadgeMark';
import { SeasonCountdown } from './Leaderboard';
import { openSkinInBuilder } from './skins';
import { EffectPicker, EffectPreview } from './EffectPicker';
import { ALLIANCE_COLOR, PIECE_EFFECTS } from '../pass/effects';

const TYPE_LABELS = Object.fromEntries(REWARD_TYPES.map(({ type, label }) => [type, label])) as Record<RewardType, string>;

/** The Drive Pass: Ranking Points earned, and the road of rewards they unlock. */
export function DrivePassScreen() {
  const setScreen = useGame((state) => state.setScreen);
  const rp = useRankingPoints();
  const unlocked = useUnlocked();
  const previewAll = useGame((state) => state.passPreviewAll);
  const setPreviewAll = useGame((state) => state.setPassPreviewAll);
  const [editing, setEditing] = useState(false);
  const owned = useGame((state) => state.settings.owned);
  const kept = keptRewards(owned);
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
            <div className="pass-road" data-clip>
              {PASS.tiers.length === 0 && <p className="hint">No rewards yet.</p>}
              {PASS.tiers.map((tier) => (
                <RewardCard key={tier.reward.id} tier={tier} open={unlocked.has(tier.reward.id)} reached={rp >= tier.rp} />
              ))}
            </div>
            {kept.length > 0 && (
              <>
                <h2>Kept from earlier seasons</h2>
                <div className="pass-road" data-clip>
                  {kept.map((reward) => (
                    <RewardCard key={reward.id} tier={{ rp: -1, reward }} open reached />
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

/** One reward on the road: what it is, what it needs, and equipping it once it is unlocked. */
export function RewardCard({ tier, open, reached, label }: { tier: Tier; open: boolean; reached: boolean; label?: string }) {
  const { reward } = tier;
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
  } else {
    note = 'Use it on LED strips in the robot builder.';
  }

  return (
    <article className={`card pass-card${open ? ' open' : ''}${equipped ? ' equipped' : ''}`}>
      <span className="pass-card-rp">{label ?? (tier.rp >= 0 ? `${tier.rp} RP` : 'Kept')}</span>
      <span className="muted pass-card-type">{TYPE_LABELS[reward.type]}</span>
      <RewardPreview reward={reward} />
      <strong>{reward.name}</strong>
      {!open ? (
        <span className="muted">🔒 Locked</span>
      ) : equip ? (
        <button className={equipped ? 'secondary' : 'primary'} onClick={equip}>
          {equipped ? 'Equipped: take off' : 'Equip'}
        </button>
      ) : (
        <span className="hint">{note}</span>
      )}
      {open && !reached && <span className="muted pass-card-preview">Previewing</span>}
    </article>
  );
}

function RewardPreview({ reward }: { reward: Reward }) {
  const name = useGame((state) => state.settings.displayName);
  if (reward.type === 'nameColor') return <span className="pass-preview pass-name" style={{ color: reward.color }}>{name}</span>;
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
      <span className="pass-swatches">
        {[reward.color, ...(reward.recolors ?? []).flatMap((colors) => Object.values(colors ?? {}))]
          .filter((color): color is string => !!color)
          .slice(0, 6)
          .map((color, i) => (
          <i key={i} style={{ background: color }} />
        ))}
      </span>
      <span className="muted">
        for {robot.id === reward.robotId ? robot.name : reward.robotId}
        {(reward.extras?.length ?? 0) > 0 ? `, ${reward.extras.length} added parts` : ''}
        {reward.pieceEffect ? `, ${PIECE_EFFECTS.find((effect) => effect.value === reward.pieceEffect?.kind)?.label.split(':')[0] ?? 'game piece'} effect` : ''}
      </span>
    </span>
  );
}

/** A fresh reward of a type, with a new id. */
function blankReward(type: RewardType): Reward {
  const id = `${type}-${Date.now().toString(36)}`;
  if (type === 'skin') return { type, id, name: 'New skin', robotId: OFFICIAL_ROBOTS[0]?.id ?? '', recolors: [], extras: [] };
  if (type === 'nameColor') return { type, id, name: 'New name colour', color: '#38bdf8' };
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
          {REWARD_TYPES.map(({ type, label }) => (
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

function TierEditor({ tier, onChange, onRemove }: { tier: Tier; onChange: (tier: Tier) => void; onRemove: () => void }) {
  const { reward } = tier;
  const set = (change: Partial<Reward>) => onChange({ ...tier, reward: { ...reward, ...change } as Reward });
  return (
    <div className="pass-tier-editor">
      <div className="pass-tier-row">
        <label>
          RP
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
        {reward.type === 'nameColor' && <ColorInput label="Name colour" value={reward.color} onChange={(color) => set({ color })} />}
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
              For {findRobot(reward.robotId).name}: {(reward.recolors ?? []).filter(Boolean).length} parts recoloured,{' '}
              {reward.extras?.length ?? 0} added.
            </span>
            <button className="small" onClick={() => openSkinInBuilder(reward.robotId, { id: reward.id, name: reward.name, rp: tier.rp })}>
              Edit in the robot builder
            </button>
          </>
        )}
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
