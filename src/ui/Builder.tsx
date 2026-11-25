import { useEffect, useRef, useState } from 'react';
import { MAX_TEAM_LENGTH } from '../robots/team';
import { OFFICIAL_ROBOTS, findRobot } from '../robots';
import { MAX_SKIN_EXTRAS, newRobot, sanitizeRobot } from '../robots/custom';
import { cleanEpa } from '../robots/epa';
import { BUMPER_FIELDS, DRIVE_FIELDS, FRAME_FIELDS, MAX_DECORATIONS, MAX_SUBSYSTEMS, isDecoration } from '../robots/spec';
import type { RobotDefinition, Traversal } from '../robots/types';
import { SUBSYSTEM_SPECS } from '../sim/subsystems';
import type { FieldSpec } from '../sim/subsystems/types';
import { Dropdown, Slider } from './controls';
import { useGame } from './store';
import { useUnlocked } from './passHooks';
import { SKIN_EXTRA_TYPES, allowedLedPatterns } from '../pass/pass';
import { saveSkinToPass } from './skins';
import { LED_PATTERNS } from '../sim/subsystems/led';
import { EffectPicker } from './EffectPicker';

/** An LED pattern list with only the patterns this player may use (and whatever the robot already has). */
function lockLedPatterns(field: FieldSpec, values: Record<string, unknown>, allowed: Set<string>): FieldSpec {
  if (field.kind !== 'choice' || !field.key.endsWith('Pattern')) return field;
  return { ...field, options: field.options.filter((option) => allowed.has(option.value) || option.value === values[field.key]) };
}

/** Whether the robot goes under the trench bar or over the bump. */
const TRAVERSAL_OPTIONS: { value: Traversal; label: string }[] = [
  { value: 'auto', label: 'By its shape: under the trench only if low enough' },
  { value: 'trench', label: 'Trench robot: always fits under the bar' },
  { value: 'bump', label: 'Bump robot: never fits under the bar' },
];

/** Settings every subsystem has; they are kept when a box is given a different job. */
const SHAPE_KEYS = ['x', 'z', 'bottom', 'sizeX', 'sizeY', 'sizeZ', 'yaw', 'pitch', 'roll'];

/** The add menu's entry for a structure that is only for looks. */
const LOOK_ONLY = 'structure:look';

interface Props {
  /** Shows a robot in the 3D view behind the panel. */
  onPreview: (robot: RobotDefinition | null) => void;
  onTestDrive: () => void;
}

/** Lets players make their own robots: size, drivetrain and any mix of subsystems. */
export function Builder({ onPreview, onTestDrive }: Props) {
  const customRobots = useGame((state) => state.customRobots);
  const saveRobot = useGame((state) => state.saveRobot);
  const deleteRobot = useGame((state) => state.deleteRobot);
  const setRobotId = useGame((state) => state.setRobotId);
  const setScreen = useGame((state) => state.setScreen);
  const [editingId, setEditingId] = useState<string | null>(() => useGame.getState().builderFocus ?? customRobots[0]?.id ?? null);
  const builderFocus = useGame((state) => state.builderFocus);
  const setBuilderFocus = useGame((state) => state.setBuilderFocus);
  useEffect(() => {
    if (!builderFocus) return;
    setEditingId(builderFocus);
    setBuilderFocus(null);
  }, [builderFocus, setBuilderFocus]);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const iconInput = useRef<HTMLInputElement>(null);

  const draft = customRobots.find((robot) => robot.id === editingId) ?? null;
  const unlocked = useUnlocked();
  // LED patterns this player may pick: the free ones and the ones unlocked. Official robots, made while developing, may use any.
  const ledPatterns = import.meta.env.DEV
    ? new Set(LED_PATTERNS.map((pattern) => pattern.value))
    : new Set([...LED_PATTERNS.filter((pattern) => pattern.free).map((pattern) => pattern.value), ...allowedLedPatterns(unlocked)]);

  // If the robot being edited is gone, edit another one. With none left, nothing is made until the player asks.
  useEffect(() => {
    if (!draft && customRobots.length > 0) setEditingId(customRobots[0].id);
  }, [draft, customRobots]);

  // Rebuild the 3D preview shortly after each change.
  useEffect(() => {
    const timer = setTimeout(() => onPreview(draft), draft ? 120 : 0);
    return () => clearTimeout(timer);
  }, [draft, onPreview]);

  const add = (robot: RobotDefinition) => {
    saveRobot(robot);
    setEditingId(robot.id);
  };

  const importFile = async (file: File) => {
    try {
      const robot = sanitizeRobot({ ...JSON.parse(await file.text()), id: undefined });
      if (!robot) throw new Error('not a robot');
      add(robot);
      setMessage(`Imported "${robot.name}".`);
    } catch {
      setMessage('That file is not a robot this game can read.');
    }
  };

  const filePicker = (
    <input
      ref={fileInput}
      type="file"
      accept="application/json,.json"
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void importFile(file);
        event.target.value = '';
      }}
    />
  );
  const copyBuiltIn = (
    <Dropdown
      className="small"
      placeholder="Copy a built-in robot…"
      options={OFFICIAL_ROBOTS.map((robot) => ({ value: robot.id, label: robot.name }))}
      onChange={(id) => {
        const base = OFFICIAL_ROBOTS.find((robot) => robot.id === id);
        if (base) add(newRobot(base));
      }}
    />
  );

  if (!draft) {
    // Wait for the effect above to pick one of the robots that do exist.
    if (customRobots.length > 0) return null;
    return (
      <div className="builder-empty">
        <section className="card">
          <p className="eyebrow">Robot builder</p>
          <h2>You have no robots yet</h2>
          <p className="hint">
            Custom robots are saved in this browser. They can be driven anywhere but never count on leaderboards.
          </p>
          <button className="primary" onClick={() => add(newRobot())}>
            Create robot
          </button>
          <div className="button-row">
            {copyBuiltIn}
            <button className="small" onClick={() => fileInput.current?.click()}>
              Import file
            </button>
          </div>
          <button className="secondary" onClick={() => setScreen('robots')}>
            Back to robots
          </button>
          {filePicker}
          {message && <p className="hint">{message}</p>}
        </section>
      </div>
    );
  }

  /** Every edit goes through the same validation as an imported file. */
  const change = (next: RobotDefinition) => {
    const clean = sanitizeRobot(next);
    if (clean) saveRobot(clean);
  };

  const remove = () => {
    const remaining = customRobots.filter((robot) => robot.id !== draft.id);
    deleteRobot(draft.id);
    setEditingId(remaining[0]?.id ?? null);
  };

  const uploadIcon = async (file: File) => {
    try {
      change({ ...draft, icon: await shrinkImage(file) });
      setMessage(null);
    } catch {
      setMessage('That file is not a picture this game can read.');
    }
  };

  const setSubsystem = (index: number, key: string, value: unknown) =>
    change({
      ...draft,
      subsystems: draft.subsystems.map((subsystem, i) => (i === index ? { ...subsystem, [key]: value } : subsystem)),
    });

  /** Gives a box a different job, keeping its size and place. */
  const relabel = (index: number, type: string) => {
    // A decoration given a working job becomes a subsystem, which needs a free place.
    if (!skinBase && isDecoration(draft.subsystems[index]) && type !== 'led' && mechanismCount >= MAX_SUBSYSTEMS) {
      setMessage(`This robot already has ${MAX_SUBSYSTEMS} subsystems. Remove one first to give this part a working job.`);
      return;
    }
    change({
      ...draft,
      subsystems: draft.subsystems.map((subsystem, i) =>
        i === index
          ? {
              type,
              ...Object.fromEntries(SHAPE_KEYS.map((key) => [key, subsystem[key]])),
              // In a skin, a structure is always see-through, and a see-through one stays so.
              ...((draft.skinOf || isDecoration(subsystem)) && type === 'structure' ? { solid: false } : {}),
            }
          : subsystem,
      ),
    });
  };

  /** Developer only: writes the robot into the game's own robots folder, making it official. */
  const saveOfficial = async () => {
    const official = { ...draft, id: slugOf(draft), official: true };
    try {
      const reply = await fetch('/__official-robot', { method: 'POST', body: JSON.stringify(official) });
      if (!reply.ok) throw new Error('not saved');
      setMessage(`Saved "${draft.name}" as an official robot. It is in the menu now; this custom copy can be deleted.`);
    } catch {
      download(draft, true);
      setMessage('Could not write the file directly, so it was downloaded. Put it in src/robots/builtin/.');
    }
  };

  const drivetrain = draft.drivetrain as unknown as Record<string, unknown>;
  const chassis = draft.chassis as unknown as Record<string, unknown>;
  // A skin keeps the robot's frame, drivetrain and mechanisms; it may only recolor them and add see-through parts.
  const skinBase = draft.skinOf ? findRobot(draft.skinOf.robotId) : null;
  const baseCount = skinBase?.subsystems.length ?? 0;
  // Working parts and parts only for looks are counted apart: LED strips and see-through structures have their own allowance.
  const mechanismCount = draft.subsystems.filter((part) => !isDecoration(part)).length;
  const decorationCount = draft.subsystems.length - mechanismCount;
  const roomFor = (part: { type: string; solid?: unknown }) =>
    skinBase
      ? draft.subsystems.length < baseCount + MAX_SKIN_EXTRAS
      : isDecoration(part)
        ? decorationCount < MAX_DECORATIONS
        : mechanismCount < MAX_SUBSYSTEMS;
  const addable = Object.values(SUBSYSTEM_SPECS).filter((spec) => !skinBase || SKIN_EXTRA_TYPES.includes(spec.type));
  const addOptions = [
    ...addable.filter((spec) => roomFor({ type: spec.type })).map((spec) => ({ value: spec.type, label: spec.label })),
    ...(!skinBase && roomFor({ type: 'structure', solid: false }) ? [{ value: LOOK_ONLY, label: 'See-through structure (only for looks)' }] : []),
  ];

  return (
    <div className="builder">
      <main className="builder-main">
        <section className="card">
        <h2>Your robots</h2>
        <div className="chip-row">
          {customRobots.map((robot) => (
            <button
              key={robot.id}
              className={`chip${robot.id === draft.id ? ' selected' : ''}`}
              onClick={() => setEditingId(robot.id)}
            >
              {robot.name}
            </button>
          ))}
        </div>
        <div className="button-row">
          <button className="small" onClick={() => add(newRobot())}>
            Create robot
          </button>
          {copyBuiltIn}
        </div>

        </section>
        {skinBase ? (
          <section className="card builder-wide">
            <h2>Skin for {skinBase.name}</h2>
            <p className="hint">
              A Drive Pass skin. The frame, drivetrain, bumpers and mechanisms are {skinBase.name}'s and stay as they are, so the
              skin cannot change how it plays. Recolor any part, and add see-through structures and LED strips anywhere. Save it to
              the Drive Pass from the side panel.
            </p>
            <p className="hint">
              A skin can also change how fuel looks in the air after this robot shoots it. While the skin is worn, its effect
              is used instead of any game piece effect the player has equipped.
            </p>
            <EffectPicker
              optional
              value={draft.pieceEffect}
              onChange={(pieceEffect) => {
                const { pieceEffect: _old, ...rest } = draft;
                change(pieceEffect ? { ...rest, pieceEffect } : rest);
              }}
            />
          </section>
        ) : (
        <>
        <section className="card">
        <h2>Frame</h2>
        <Fields
          fields={FRAME_FIELDS}
          values={chassis}
          onChange={(key, value) => change({ ...draft, chassis: { ...draft.chassis, [key]: value } })}
        />

        </section>
        <section className="card">
        <div className="fields">
          <div className="field">
            <span>Past the hub line</span>
            <Dropdown
              label="How the robot gets past the hub line"
              value={draft.traversal ?? 'auto'}
              options={TRAVERSAL_OPTIONS}
              onChange={(traversal) => change({ ...draft, traversal: traversal as Traversal })}
            />
          </div>
        </div>
        </section>
        <section className="card">
        <h2>Bumpers</h2>
        <p className="hint">
          {chassis.round
            ? 'A round frame has one ring of bumper: set how far it sticks out with Front.'
            : 'How far the bumper sticks out past the frame on each side. Zero leaves that side bare.'}
        </p>
        <Fields
          fields={BUMPER_FIELDS}
          values={chassis}
          onChange={(key, value) => change({ ...draft, chassis: { ...draft.chassis, [key]: value } })}
        />

        </section>
        <section className="card">
        <h2>Drivetrain</h2>
        <div className="segmented">
          {(['swerve', 'tank'] as const).map((type) => (
            <button
              key={type}
              className={draft.drivetrain.type === type ? 'selected' : ''}
              onClick={() => change({ ...draft, drivetrain: { type } as RobotDefinition['drivetrain'] })}
            >
              {type === 'swerve' ? 'Swerve' : 'Tank'}
            </button>
          ))}
        </div>
        <Fields
          fields={DRIVE_FIELDS[draft.drivetrain.type]}
          values={drivetrain}
          onChange={(key, value) =>
            change({ ...draft, drivetrain: { ...draft.drivetrain, [key]: value } as RobotDefinition['drivetrain'] })
          }
        />

        </section>
        </>
        )}
        <div className="builder-wide">
        <h2>
          {skinBase
            ? `Parts (${draft.subsystems.length - baseCount} added, up to ${MAX_SKIN_EXTRAS})`
            : `Subsystems (${mechanismCount} of ${MAX_SUBSYSTEMS}) · Decorations (${decorationCount} of ${MAX_DECORATIONS})`}
        </h2>
        <p className="hint">
          Each subsystem is a box. Give it a job, then size it and place it anywhere on the robot. LED strips and see-through
          structures are only for looks: they count as decorations, not subsystems, and can be turned any way.
        </p>
        </div>
        {draft.subsystems.map((subsystem, index) => {
          const spec = SUBSYSTEM_SPECS[subsystem.type];
          // One of the robot's own mechanisms, in a skin: only its colors can change.
          if (skinBase && index < baseCount) {
            return (
              <div className="subsystem card" key={index}>
                <div className="subsystem-head">
                  <strong>{spec.label}</strong>
                  <span className="muted">{skinBase.name}'s own: colors only</span>
                </div>
                <Fields
                  fields={spec.fields.filter((field) => field.kind === 'color')}
                  values={subsystem}
                  onChange={(key, value) => setSubsystem(index, key, value)}
                />
              </div>
            );
          }
          return (
            <div className="subsystem card" key={index}>
              <div className="subsystem-head">
                <Dropdown
                  className="small"
                  label="What this box does"
                  value={subsystem.type}
                  options={addable.map((option) => ({ value: option.type, label: option.label }))}
                  onChange={(type) => relabel(index, type)}
                />
                <span className="subsystem-actions">
                <button
                  className="small"
                  disabled={!roomFor(subsystem)}
                  title={!roomFor(subsystem) ? 'This robot has as many of these as it can' : 'Add an identical copy right after this one'}
                  onClick={() =>
                    change({
                      ...draft,
                      // An exact copy, every setting and color the same, placed right after the original.
                      subsystems: [
                        ...draft.subsystems.slice(0, index + 1),
                        structuredClone(subsystem),
                        ...draft.subsystems.slice(index + 1),
                      ],
                    })
                  }
                >
                  Duplicate
                </button>
                <button
                  className="small"
                  onClick={() => change({ ...draft, subsystems: draft.subsystems.filter((_, i) => i !== index) })}
                >
                  Remove
                </button>
                </span>
              </div>
              <p className="hint">{spec.description}</p>
              <details className="shape" open>
                <summary>Shape and position</summary>
                <Fields
                  fields={spec.fields.filter((field) => field.group === 'shape')}
                  values={subsystem}
                  onChange={(key, value) => setSubsystem(index, key, value)}
                />
              </details>
              <Fields
                fields={spec.fields
                  .filter((field) => field.group !== 'shape')
                  // A part added by a skin is never solid.
                  .filter((field) => !(skinBase && field.key === 'solid'))
                  .map((field) => lockLedPatterns(field, subsystem, ledPatterns))}
                values={subsystem}
                onChange={(key, value) => {
                  // Making a see-through structure solid turns it into a subsystem, which needs a free place.
                  if (key === 'solid' && value === true && isDecoration(subsystem) && mechanismCount >= MAX_SUBSYSTEMS) {
                    setMessage(`This robot already has ${MAX_SUBSYSTEMS} subsystems, so this structure has to stay see-through.`);
                    return;
                  }
                  setSubsystem(index, key, value);
                }}
              />
              {subsystem.type === 'led' && !import.meta.env.DEV && (
                <p className="hint">More LED effects can be unlocked in the Drive Pass.</p>
              )}
            </div>
          );
        })}
        <div className="builder-wide">
        {addOptions.length > 0 && (
          <Dropdown
            className="small wide"
            placeholder={skinBase ? 'Add a see-through structure or LED strip…' : 'Add a subsystem or decoration…'}
            options={addOptions}
            onChange={(type) =>
              change({
                ...draft,
                subsystems: [
                  ...draft.subsystems,
                  type === LOOK_ONLY || (skinBase && type === 'structure') ? { type: 'structure', solid: false } : { type },
                ],
              })
            }
          />
        )}

        </div>
      </main>

      <aside className="builder-side">
        {/* The 3D view draws the turning robot inside this box. */}
        <div id="robot-preview" className="robot-preview" />
        <p className="eyebrow">Robot builder</p>
        <p className="hint">
          Custom robots are saved in this browser. They can be driven anywhere but never count on leaderboards.
        </p>
        <h2>Name and color</h2>
        <div className="name-row">
          <input
            type="text"
            value={draft.name}
            maxLength={40}
            aria-label="Robot name"
            // Saved as typed; trimming happens when the field is left so spaces can be entered.
            onChange={(event) => saveRobot({ ...draft, name: event.target.value })}
            onBlur={() => change(draft)}
          />
          <input
            type="color"
            value={draft.color ?? '#9aa3af'}
            aria-label="Robot color"
            onChange={(event) => change({ ...draft, color: event.target.value })}
          />
        </div>
        {!skinBase && (
        <>
        <div className="team-row">
          <input
            type="text"
            placeholder="Team no."
            maxLength={MAX_TEAM_LENGTH}
            title="A team number, or a short label such as Kitbot or 2910 v2"
            aria-label="Team number or label"
            value={draft.team ?? ''}
            onChange={(event) => {
              // Spaces are kept while typing; only the ends are tidied when the robot is saved.
              const typed = event.target.value.replace(/[^A-Za-z0-9 .#'&+-]/g, '').slice(0, MAX_TEAM_LENGTH);
              change({ ...draft, team: typed.trim() ? typed : undefined });
            }}
          />
          {draft.icon ? (
            <img className="team-icon" src={draft.icon} alt="Team icon" />
          ) : (
            <span className="team-icon">Icon</span>
          )}
          <button className="small" onClick={() => iconInput.current?.click()}>
            {draft.icon ? 'Change icon' : 'Upload icon'}
          </button>
          {draft.icon && (
            <button className="small" onClick={() => change({ ...draft, icon: undefined })}>
              Remove
            </button>
          )}
        </div>
        <p className="hint">The number is painted in white on the bumpers; both show on the scoreboard in a match.</p>
        {import.meta.env.DEV && (
          <label className="field">
            <span>EPA, 0.0 to 100.0 (official robots only)</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={draft.epa ?? ''}
              onChange={(event) => change({ ...draft, epa: cleanEpa(event.target.value) })}
            />
          </label>
        )}
        {import.meta.env.DEV && (
          <div className="tag-overrides">
            {TAG_OVERRIDES.map(({ key, label }) => (
              <label className="field" key={key}>
                <span>{label} tag (official robots only)</span>
                <select
                  value={draft[key] === undefined ? 'auto' : draft[key] ? 'yes' : 'no'}
                  onChange={(event) => {
                    const { [key]: _old, ...rest } = draft;
                    change(event.target.value === 'auto' ? (rest as RobotDefinition) : { ...draft, [key]: event.target.value === 'yes' });
                  }}
                >
                  <option value="auto">By its parts</option>
                  <option value="yes">Show it</option>
                  <option value="no">Leave it off</option>
                </select>
              </label>
            ))}
          </div>
        )}
        </>
        )}
        <input
          ref={iconInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadIcon(file);
            event.target.value = '';
          }}
        />

        <button
          className="primary"
          onClick={() => {
            setRobotId(draft.id);
            onTestDrive();
          }}
        >
          Test drive
        </button>
        <button
          className="secondary"
          onClick={() => {
            setRobotId(draft.id);
            setScreen('robots');
          }}
        >
          Back to robots
        </button>
        {skinBase && import.meta.env.DEV && (
          <>
            <h2>{draft.skinOf!.shop ? 'Shop' : 'Drive Pass'}</h2>
            {draft.skinOf!.champion ? (
              <p className="hint">A champion skin: worn only by whoever is first on {skinBase.name}'s leaderboard, while they stay first.</p>
            ) : (
            <label className="field">
              <span>{draft.skinOf!.shop ? 'Price in Rivets' : 'Ranking Points needed'}</span>
              <input
                type="number"
                min={0}
                step={10}
                value={draft.skinOf!.rp}
                onChange={(event) => change({ ...draft, skinOf: { ...draft.skinOf!, rp: Math.max(0, Number(event.target.value) || 0) } })}
              />
            </label>
            )}
            <p className="hint">Saved as the reward "{draft.skinOf!.rewardId}", named after this robot.</p>
            <button className="primary" onClick={() => void saveSkinToPass(draft).then(setMessage)}>
              {draft.skinOf!.champion ? 'Save champion skin' : draft.skinOf!.shop ? 'Save skin to the Shop' : 'Save skin to the Drive Pass'}
            </button>
          </>
        )}
        <h2>Share</h2>
        <div className="button-row">
          <button className="small" onClick={() => download(draft, false)}>
            Export file
          </button>
          <button className="small" onClick={() => fileInput.current?.click()}>
            Import file
          </button>
          {import.meta.env.DEV && !skinBase && (
            <button className="small" onClick={() => void saveOfficial()} title="Developer only">
              Save as official
            </button>
          )}
          <button className="small danger" onClick={remove}>
            Delete robot
          </button>
        </div>
        {filePicker}
        {message && <p className="hint">{message}</p>}

      </aside>
    </div>
  );
}

export function Fields({
  fields,
  values,
  onChange,
}: {
  fields: FieldSpec[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <div className="fields">
      {fields
        .filter((field) => (!field.showIf || values[field.showIf] === true) && (!field.hideIf || values[field.hideIf] !== true))
        .map((field) => (
          <FieldEditor
            key={field.key}
            field={field}
            value={values[field.key] ?? field.default}
            onChange={(value) => onChange(field.key, value)}
          />
        ))}
    </div>
  );
}

function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.kind === 'boolean') {
    return (
      <label className="field check">
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        <span>{field.label}</span>
      </label>
    );
  }
  if (field.kind === 'choice') {
    return (
      <div className="field">
        <span>{field.label}</span>
        <Dropdown label={field.label} value={String(value)} options={field.options} onChange={onChange} />
      </div>
    );
  }
  if (field.kind === 'color') {
    return (
      <label className="field">
        <span>{field.label}</span>
        <input type="color" value={String(value)} onChange={(event) => onChange(event.target.value)} />
      </label>
    );
  }

  const step = field.step ?? (field.max - field.min <= 3 ? 0.01 : field.max - field.min <= 40 ? 0.1 : 1);
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return (
    <div className="field">
      <span>{field.label}</span>
      <Slider label={field.label} min={field.min} max={field.max} step={step} value={Number(value)} onChange={onChange} />
      <NumberBox value={Number(value)} digits={digits} min={field.min} max={field.max} unit={field.unit} onChange={onChange} />
    </div>
  );
}

/** A typed value next to a slider, for exact sizes. It applies on Enter or when the box is left. */
function NumberBox({
  value,
  digits,
  min,
  max,
  unit,
  onChange,
}: {
  value: number;
  digits: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(value.toFixed(digits));
  useEffect(() => setText(value.toFixed(digits)), [value, digits]);

  const commit = () => {
    const typed = Number(text);
    if (text.trim() === '' || !Number.isFinite(typed)) {
      setText(value.toFixed(digits));
      return;
    }
    const next = Math.min(max, Math.max(min, typed));
    setText(next.toFixed(digits));
    if (next !== value) onChange(next);
  };

  return (
    <span className="number-box">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
      <span>{unit ?? ''}</span>
    </span>
  );
}

const ICON_SIZE = 64;

/** A picture file as a small square PNG data URL, fitted inside the square without cropping. */
async function shrinkImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no canvas');
  const scale = Math.min(ICON_SIZE / bitmap.width, ICON_SIZE / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(bitmap, (ICON_SIZE - width) / 2, (ICON_SIZE - height) / 2, width, height);
  bitmap.close();
  return canvas.toDataURL('image/png');
}

/** Tags the selector cannot tell from the parts alone, set by hand on official robots. */
const TAG_OVERRIDES = [
  { key: 'dualIntake', label: 'Dual intake' },
  { key: 'doubleTurret', label: 'Double turret' },
] as const;

/** A robot's name as a file name and official id: lower-case letters, digits and dashes. */
function slugOf(robot: RobotDefinition): string {
  return (
    robot.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'robot'
  );
}

/** Saves a robot as a JSON file. The official form is what goes in src/robots/builtin/. */
function download(robot: RobotDefinition, official: boolean): void {
  const slug = slugOf(robot);
  const data = official ? { ...robot, id: slug, official: true } : robot;
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${slug}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
