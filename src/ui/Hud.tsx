import { findRobot } from '../robots';
import type { RobotDefinition } from '../robots/types';
import { keyLabel, padLabel, type Control } from '../settings';
import { useGame } from './store';

const CAMERA_LABELS: Record<string, string> = {
  driver: 'Driver station',
  follow: 'Follow',
  top: 'Overhead',
};

/** One control hint: which control it is, what it does, and which subsystem it needs. */
const HINTS: { controls: Control[]; label: string; stick?: string; needs?: string; setting?: string }[] = [
  { controls: ['forward', 'left', 'back', 'right'], label: 'Drive', stick: 'Left stick' },
  { controls: ['turnLeft', 'turnRight'], label: 'Turn', stick: 'Right stick' },
  { controls: ['intake'], label: 'Intake', needs: 'intake' },
  { controls: ['outtake'], label: 'Outtake', needs: 'intake', setting: 'outtake' },
  { controls: ['shoot'], label: 'Shoot', needs: 'shooter' },
  { controls: ['deploy'], label: 'Expand hopper', needs: 'hopper', setting: 'expandable' },
  { controls: ['block'], label: 'Blocker', needs: 'blocker' },
  { controls: ['climb'], label: 'Climb up / down', needs: 'climber' },
  { controls: ['fieldCentric'], label: 'Control mode' },
  { controls: ['camera'], label: 'Camera' },
  { controls: ['reset'], label: 'Reset field' },
  { controls: ['pause'], label: 'Pause' },
];

function controlsFor(robot: RobotDefinition) {
  return HINTS.filter((control) => {
    if (!control.needs) return true;
    return robot.subsystems.some(
      (subsystem) => subsystem.type === control.needs && (!control.setting || subsystem[control.setting] === true),
    );
  });
}

export function Hud() {
  const telemetry = useGame((state) => state.telemetry);
  const camera = useGame((state) => state.camera);
  const fieldCentric = useGame((state) => state.fieldCentric);
  const customRobots = useGame((state) => state.customRobots);
  const settings = useGame((state) => state.settings);
  const robot = findRobot(
    useGame((state) => state.robotId),
    customRobots,
  );
  const isSwerve = robot.drivetrain.type === 'swerve';
  const heading = ((Math.round(-telemetry.headingDeg) % 360) + 360) % 360;
  const watching = useGame((state) => state.watching);
  if (watching) return <WatchingHud />;

  return (
    <div className="hud">
      <Countdown />
      <div className="hud-bottom-left">
        {telemetry.climbLevel > 0 && <div className="panel hud-climb">Tower level {telemetry.climbLevel}</div>}
        {telemetry.capacity > 0 && (
          <div className="panel hud-held">
            <span className="big">{telemetry.held}</span>
            <span className="unit">/ {telemetry.capacity}</span>
          </div>
        )}
        {settings.showSpeed && (
          <div className="panel hud-speed">
            <span className="big">{telemetry.speed.toFixed(1)}</span>
            <span className="unit">m/s</span>
            <span className="sub">
              {(telemetry.speed * 3.281).toFixed(1)} ft/s · heading {heading}°
            </span>
          </div>
        )}
      </div>

      {settings.showInfo && (
      <div className="panel hud-status">
        <span>
          {robot.name}
          {!robot.official && ' (custom)'}
        </span>
        <span>{isSwerve ? (fieldCentric ? 'Field-centric' : 'Robot-centric') : 'Arcade drive'}</span>
        <span>{CAMERA_LABELS[camera]} camera</span>
        <span className="muted">
          {telemetry.gamepad ? 'Gamepad connected' : 'Keyboard'} · {telemetry.fps} fps
        </span>
        <span className="muted">{telemetry.quality} quality</span>
        <span className="muted">
          physics {telemetry.simMs.toFixed(1)} · draw {telemetry.drawMs.toFixed(1)} ms
        </span>
      </div>
      )}

      {settings.showControls && (
      <div className="panel hud-keys">
        {controlsFor(robot).map((control) => (
          <span key={control.label}>
            <kbd>
              {telemetry.gamepad
                ? (control.stick ?? control.controls.map((id) => padLabel(settings.pad[id])).join(' '))
                : control.controls.map((id) => keyLabel(settings.keys[id])).join(' ')}
            </kbd>{' '}
            {control.label}
          </span>
        ))}
      </div>
      )}
    </div>
  );
}

/** How long "GO!" stays up once the match starts. */
const GO_SECONDS = 0.8;

/** The big 3, 2, 1, GO before a timed match, and the pause after auto. */
function Countdown() {
  const match = useGame((state) => state.match);
  if (!match || match.mode !== 'match') return null;
  if (match.holdReason === 'start') {
    return (
      <div className="countdown" aria-live="assertive">
        <span key={Math.ceil(match.hold)}>{Math.max(1, Math.ceil(match.hold))}</span>
      </div>
    );
  }
  if (match.holdReason === 'pause') {
    return (
      <div className="countdown pause" aria-live="assertive">
        <span>{(match.previousPhase ?? 'Period').toUpperCase()} OVER</span>
        <small>{Math.max(1, Math.ceil(match.hold))}</small>
      </div>
    );
  }
  if (match.elapsed < GO_SECONDS) {
    return (
      <div className="countdown go" aria-live="assertive">
        <span>GO!</span>
      </div>
    );
  }
  return null;
}

/** What someone watching a multiplayer match sees: who they are following, and that they can play once it is over. */
function WatchingHud() {
  const target = useGame((state) => state.watchTarget);
  const match = useGame((state) => state.match);
  const cameraKey = useGame((state) => state.settings.keys.camera);
  const teams = match ? [...match.blue.teams.map((team) => ['Blue', team] as const), ...match.red.teams.map((team) => ['Red', team] as const)] : [];
  const followed = target === null ? null : teams[target];
  return (
    <div className="hud">
      <Countdown />
      <div className="panel hud-watching">
        <strong>Watching this match</strong>
        <span>You can take a driver station in the room once it is over.</span>
        <span className="muted">
          {followed ? `Following ${followed[0]} ${followed[1].number ?? followed[1].name}` : 'View from above'} · <kbd>{keyLabel(cameraKey)}</kbd> next
          view · <kbd>Esc</kbd> menu
        </span>
      </div>
    </div>
  );
}
