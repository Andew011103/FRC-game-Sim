import { useEffect, useRef, useState } from 'react';
import { OFFICIAL_ROBOTS } from '../robots';
import { newRobot, sanitizeRobot } from '../robots/custom';
import { BUMPER_FIELDS, DRIVE_FIELDS, FRAME_FIELDS, MAX_SUBSYSTEMS } from '../robots/spec';
import type { RobotDefinition, Traversal } from '../robots/types';
import { SUBSYSTEM_SPECS } from '../sim/subsystems';
import type { FieldSpec } from '../sim/subsystems/types';
import { Dropdown, Slider } from './controls';
import { useGame } from './store';

/** Whether the robot goes under the trench bar or over the bump. */
const TRAVERSAL_OPTIONS: { value: Traversal; label: string }[] = [
  { value: 'auto', label: 'By its shape: under the trench only if low enough' },
  { value: 'trench', label: 'Trench robot: always fits under the bar' },
  { value: 'bump', label: 'Bump robot: never fits under the bar' },
];

/** Settings every subsystem has; they are kept when a box is given a different job. */
const SHAPE_KEYS = ['x', 'z', 'bottom', 'sizeX', 'sizeY', 'sizeZ'];

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
  const [editingId, setEditingId] = useState<string | null>(customRobots[0]?.id ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const iconInput = useRef<HTMLInputElement>(null);

  const draft = customRobots.find((robot) => robot.id === editingId) ?? null;

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
  const relabel = (index: number, type: string) =>
    change({
      ...draft,
      subsystems: draft.subsystems.map((subsystem, i) =>
        i === index ? { type, ...Object.fromEntries(SHAPE_KEYS.map((key) => [key, subsystem[key]])) } : subsystem,
      ),
    });

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
        <p className="hint">How far the bumper sticks out past the frame on each side. Zero leaves that side bare.</p>
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
        <div className="builder-wide">
        <h2>
          Subsystems ({draft.subsystems.length} of {MAX_SUBSYSTEMS})
        </h2>
        <p className="hint">
          Each subsystem is a box. Give it a job, then size it and place it anywhere on the robot.
        </p>
        </div>
        {draft.subsystems.map((subsystem, index) => {
          const spec = SUBSYSTEM_SPECS[subsystem.type];
          return (
            <div className="subsystem card" key={index}>
              <div className="subsystem-head">
                <Dropdown
                  className="small"
                  label="What this box does"
                  value={subsystem.type}
                  options={Object.values(SUBSYSTEM_SPECS).map((option) => ({ value: option.type, label: option.label }))}
                  onChange={(type) => relabel(index, type)}
                />
                <button
                  className="small"
                  onClick={() => change({ ...draft, subsystems: draft.subsystems.filter((_, i) => i !== index) })}
                >
                  Remove
                </button>
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
                fields={spec.fields.filter((field) => field.group !== 'shape')}
                values={subsystem}
                onChange={(key, value) => setSubsystem(index, key, value)}
              />
            </div>
          );
        })}
        <div className="builder-wide">
        {draft.subsystems.length < MAX_SUBSYSTEMS && (
          <Dropdown
            className="small wide"
            placeholder="Add a subsystem…"
            options={Object.values(SUBSYSTEM_SPECS).map((spec) => ({ value: spec.type, label: spec.label }))}
            onChange={(type) => change({ ...draft, subsystems: [...draft.subsystems, { type }] })}
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
        <h2>Name and colour</h2>
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
            aria-label="Robot colour"
            onChange={(event) => change({ ...draft, color: event.target.value })}
          />
        </div>
        <div className="team-row">
          <input
            type="text"
            inputMode="numeric"
            placeholder="Team no."
            maxLength={5}
            aria-label="Team number"
            value={draft.team ?? ''}
            onChange={(event) => change({ ...draft, team: event.target.value.replace(/\D/g, '') || undefined })}
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
        <h2>Share</h2>
        <div className="button-row">
          <button className="small" onClick={() => download(draft, false)}>
            Export file
          </button>
          <button className="small" onClick={() => fileInput.current?.click()}>
            Import file
          </button>
          {import.meta.env.DEV && (
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
        .filter((field) => !field.showIf || values[field.showIf] === true)
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
