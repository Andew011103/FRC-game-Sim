import { useEffect, useState } from 'react';
import {
  CONTROLS,
  DEFAULT_SETTINGS,
  THEMES,
  keyLabel,
  padLabel,
  type Control,
  type PlayCamera,
  ANGLED_PITCH,
  type QualitySetting,
} from '../settings';
import { Dropdown, Slider } from './controls';
import { useGame } from './store';
import { useUnlocked } from './passHooks';
import { passThemes } from '../pass/pass';

const QUALITY_OPTIONS: { value: QualitySetting; label: string }[] = [
  { value: 'auto', label: 'Auto: starts high, lowers itself if slow' },
  { value: 'low', label: 'Low: no shadows, fastest' },
  { value: 'medium', label: 'Medium: simple shadows' },
  { value: 'high', label: 'High: full shadows and resolution' },
];

const CAMERA_OPTIONS: { value: PlayCamera; label: string }[] = [
  { value: 'angled', label: 'Angled above, from the driver side' },
  { value: 'driver', label: 'Driver station' },
  { value: 'follow', label: 'Follow the robot' },
];

const STATION_OPTIONS = [
  { value: '1', label: 'Station 1: on your left' },
  { value: '2', label: 'Station 2: the middle' },
  { value: '3', label: 'Station 3: on your right' },
];

/** The parts of the in-match display that can be switched off. */
const HUD_OPTIONS: { key: 'showInfo' | 'showControls' | 'showSpeed'; label: string }[] = [
  { key: 'showInfo', label: 'Show the info panel: robot, control mode, frame rate' },
  { key: 'showControls', label: 'Show the list of controls' },
  { key: 'showSpeed', label: 'Show speed and heading' },
];

/** Which control is waiting for a key or a gamepad button to be pressed. */
type Listening = { control: Control; device: 'keys' | 'pad' } | null;

/** The player's preferences: look, sound, driving aids and controls. */
/** The settings screen's tabs, so nothing needs scrolling to find. */
const SETTINGS_TABS = [
  { id: 'display', label: 'Display' },
  { id: 'account', label: 'Account' },
  { id: 'game', label: 'Game' },
  { id: 'controls', label: 'Controls' },
] as const;

export function SettingsScreen() {
  const [tab, setTab] = useState<(typeof SETTINGS_TABS)[number]['id']>('display');
  const settings = useGame((state) => state.settings);
  const unlocked = useUnlocked();
  // Drive Pass themes appear once unlocked.
  const passThemeIds = new Set(Object.keys(passThemes()));
  const update = useGame((state) => state.updateSettings);
  const setScreen = useGame((state) => state.setScreen);
  const setCamera = useGame((state) => state.setCamera);
  const setFieldCentric = useGame((state) => state.setFieldCentric);
  const [listening, setListening] = useState<Listening>(null);

  // While a control is waiting, the next key or newly pressed gamepad button becomes its binding.
  useEffect(() => {
    if (!listening) return;
    const { control, device } = listening;
    if (device === 'keys') {
      const onKey = (event: KeyboardEvent) => {
        event.preventDefault();
        event.stopPropagation();
        update({ keys: { ...settings.keys, [control]: event.code } });
        setListening(null);
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }
    let frame = 0;
    let before: boolean[] | null = null;
    const poll = () => {
      const pad = navigator.getGamepads?.().find((p) => p !== null && p.connected);
      const pressed = pad ? pad.buttons.map((button) => button.pressed) : [];
      const button = before ? pressed.findIndex((down, i) => down && !before![i]) : -1;
      before = pressed;
      if (button >= 0) {
        update({ pad: { ...settings.pad, [control]: button } });
        setListening(null);
        return;
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [listening, settings.keys, settings.pad, update]);

  const bindButton = (control: Control, device: 'keys' | 'pad', text: string) => {
    const waiting = listening?.control === control && listening.device === device;
    return (
      <button
        className={`bind${waiting ? ' waiting' : ''}`}
        onClick={() => setListening(waiting ? null : { control, device })}
      >
        {waiting ? (device === 'keys' ? 'Press a key…' : 'Press a button…') : text}
      </button>
    );
  };

  return (
    <div className="screen">
      <header className="screen-head">
        <button className="small" onClick={() => setScreen('home')}>
          Back
        </button>
        <h1>Settings</h1>
        <div className="toggle-pair screen-tabs" role="tablist" aria-label="Settings">
          {SETTINGS_TABS.map(({ id, label }) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="screen-body columns">
        {tab === 'display' && (
        <section className="card">
          <h2>Display</h2>
          <div className="fields">
            <div className="field">
              <span>Colors</span>
              <Dropdown
                label="Colors"
                value={settings.theme}
                options={Object.entries(THEMES)
                  .filter(([value]) => !passThemeIds.has(value) || unlocked.has(value) || value === settings.theme)
                  .map(([value, theme]) => ({ value, label: theme.name }))}
                onChange={(theme) => update({ theme })}
              />
            </div>
            <div className="field">
              <span>Graphics</span>
              <Dropdown
                label="Graphics"
                value={settings.quality}
                options={QUALITY_OPTIONS}
                onChange={(quality) => update({ quality: quality as QualitySetting })}
              />
            </div>
            <div className="field">
              <span>Driver station</span>
              <Dropdown
                label="Driver station"
                value={String(settings.driverStation)}
                options={STATION_OPTIONS}
                onChange={(station) => update({ driverStation: Number(station) })}
              />
            </div>
            <div className="field">
              <span>Camera at the start</span>
              <Dropdown
                label="Camera at the start"
                value={settings.defaultCamera}
                options={CAMERA_OPTIONS}
                onChange={(camera) => {
                  update({ defaultCamera: camera as PlayCamera });
                  setCamera(camera as PlayCamera);
                }}
              />
            </div>
            <div className="field">
              <span>Angled camera tilt</span>
              <Slider
                label="Angled camera tilt"
                value={settings.angledPitch}
                min={ANGLED_PITCH.least}
                max={ANGLED_PITCH.most}
                step={1}
                onChange={(angledPitch) => update({ angledPitch })}
              />
              <span className="field-value">{settings.angledPitch}°</span>
            </div>
            <label className="field check">
              <input
                type="checkbox"
                checked={settings.showPieceEffects}
                onChange={(event) => update({ showPieceEffects: event.target.checked })}
              />
              <span>Show game piece effects (on your shots and everyone else's)</span>
            </label>
            {HUD_OPTIONS.map(({ key, label }) => (
              <label className="field check" key={key}>
                <input type="checkbox" checked={settings[key]} onChange={(event) => update({ [key]: event.target.checked })} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </section>
        )}

        {tab === 'account' && (
        <section className="card">
          <h2>Account</h2>
          <div className="fields">
            <label className="field">
              <span>Display name</span>
              <input
                className="text-input"
                type="text"
                maxLength={24}
                value={settings.displayName}
                onChange={(event) => update({ displayName: event.target.value })}
              />
            </label>
            <div className="field">
              <span>Volume</span>
              <Slider label="Volume" value={settings.volume} min={0} max={1} step={0.05} onChange={(volume) => update({ volume })} />
              <span className="field-value">{Math.round(settings.volume * 100)}%</span>
            </div>
          </div>
          <p className="hint">
            The name is for multiplayer, and the game has no sounds yet, so neither changes anything today.
          </p>
        </section>
        )}

        {tab === 'game' && (
        <section className="card">
          <h2>Game</h2>
          <div className="fields">
            <label className="field check">
              <input
                type="checkbox"
                checked={settings.fieldCentric}
                onChange={(event) => {
                  update({ fieldCentric: event.target.checked });
                  setFieldCentric(event.target.checked);
                }}
              />
              <span>Field-centric control: forward is always away from you</span>
            </label>
            <label className="field check">
              <input
                type="checkbox"
                checked={settings.constantIntake}
                onChange={(event) => update({ constantIntake: event.target.checked })}
              />
              <span>Constant intake: intakes run without holding the button</span>
            </label>
            <label className="field check">
              <input
                type="checkbox"
                checked={settings.autoAim}
                onChange={(event) => update({ autoAim: event.target.checked })}
              />
              <span>Automatic aiming: a fixed shooter turns the robot to its target</span>
            </label>
            <label className="field check">
              <input
                type="checkbox"
                checked={settings.toggleShoot}
                onChange={(event) => update({ toggleShoot: event.target.checked })}
              />
              <span>Shoot switches on and off with a press, instead of being held</span>
            </label>
            <label className="field check">
              <input
                type="checkbox"
                checked={settings.toggleIntake}
                onChange={(event) => update({ toggleIntake: event.target.checked })}
              />
              <span>Intake switches on and off with a press, instead of being held</span>
            </label>
          </div>
          <h3>Speed presets</h3>
          <p className="hint">
            Keys {settings.speedPresets.map((_, i) => keyLabel(settings.keys[`speed${i + 1}` as 'speed1'])).join(', ')} hold driving and
            turning to these shares of top speed, the same for every robot; press the same key again for full speed. Slower driving makes
            shooting on the move more accurate.
          </p>
          <div className="fields">
            {settings.speedPresets.map((value, i) => (
              <Slider
                key={i}
                label={`Preset ${i + 1}: ${value}%`}
                value={value}
                min={5}
                max={100}
                step={5}
                onChange={(next) => update({ speedPresets: settings.speedPresets.map((other, k) => (k === i ? next : other)) })}
              />
            ))}
          </div>
        </section>
        )}

        {tab === 'controls' && (
        <section className="card wide">
          <h2>Controls</h2>
          <p className="hint">
            Each action shows its keyboard key, then its gamepad button. Click one, then press the key or button you
            want instead.
          </p>
          <div className="bindings">
            {CONTROLS.map(({ id, label, stick }) => (
              <div className="binding" key={id}>
                <span>{label}</span>
                {bindButton(id, 'keys', keyLabel(settings.keys[id]))}
                {stick ? <span className="muted">{stick}</span> : bindButton(id, 'pad', padLabel(settings.pad[id]))}
              </div>
            ))}
          </div>
          <div className="button-row">
            <button
              className="small"
              onClick={() => {
                setListening(null);
                update({ keys: DEFAULT_SETTINGS.keys, pad: DEFAULT_SETTINGS.pad });
              }}
            >
              Reset controls to defaults
            </button>
          </div>
        </section>
        )}
      </div>
    </div>
  );
}
