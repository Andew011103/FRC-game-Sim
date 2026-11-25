import type { Control, Settings } from '../settings';
import type { DriverInput, InputAction } from './types';

/** Controls that do something once when pressed, instead of being held. */
const ACTIONS: Partial<Record<Control, InputAction>> = {
  fieldCentric: 'toggleFieldCentric',
  camera: 'cycleCamera',
  reset: 'reset',
  pause: 'pause',
  speed1: 'speed1',
  speed2: 'speed2',
  speed3: 'speed3',
};
const DEADBAND = 0.1;

/**
 * Merges keyboard and gamepad into one DriverInput, using the player's own
 * key and button choices. The gamepad sticks win when they are being used.
 * It only listens while `active` says a match is on screen, so keys typed
 * or pressed in the menus do nothing here.
 */
export class InputManager {
  gamepadConnected = false;

  private readonly keys = new Set<string>();
  /** Keys pressed since the last read, so a tap shorter than a frame still counts once. */
  private readonly tapped = new Set<string>();
  private padButtons: boolean[] = [];
  /** For controls set to switch on and off with a press: whether each was down last frame, and whether it is on. */
  private readonly wasDown: Partial<Record<Control, boolean>> = {};
  private readonly latched: Partial<Record<Control, boolean>> = {};
  /** Whether the climb control currently means down. */
  private climbDown = false;

  constructor(
    private readonly onAction: (action: InputAction) => void,
    private readonly settings: () => Settings,
    private readonly active: () => boolean,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** Forgets anything switched on with a press, for the start of a match. */
  release(): void {
    for (const control of Object.keys(this.latched) as Control[]) this.latched[control] = false;
    this.climbDown = false;
  }

  /**
   * Call once per frame. Also fires gamepad button actions. `climbing` says
   * whether the robot is on its tower, which decides what the climb control does.
   */
  read(climbing = false): DriverInput {
    const { keys: bound, pad: buttons, toggleShoot, toggleIntake } = this.settings();
    const pressed = this.readGamepad();
    const pad = navigator.getGamepads?.().find((p) => p !== null && p.connected) ?? null;
    const held = (control: Control): boolean =>
      this.keys.has(bound[control]) ||
      this.tapped.has(bound[control]) ||
      (buttons[control] >= 0 && (pressed[buttons[control]] ?? false));
    /** A held control, or one that each press switches on or off. */
    const switched = (control: Control, toggle: boolean): boolean => {
      const down = held(control);
      if (down && !this.wasDown[control]) this.latched[control] = !this.latched[control];
      this.wasDown[control] = down;
      if (!toggle) this.latched[control] = false;
      return toggle ? (this.latched[control] ?? false) : down;
    };
    // One control climbs both ways: the first hold goes up, and each new hold while on the tower swaps direction.
    const climb = held('climb');
    if (climb && !this.wasDown.climb) this.climbDown = climbing ? !this.climbDown : false;
    this.wasDown.climb = climb;
    const axis = (positive: Control, negative: Control) => (held(positive) ? 1 : 0) - (held(negative) ? 1 : 0);

    const stickX = shape(pad?.axes[0] ?? 0);
    const stickY = -shape(pad?.axes[1] ?? 0);
    const stickTurn = shape(pad?.axes[2] ?? 0);
    const sticks = stickX !== 0 || stickY !== 0 || stickTurn !== 0;
    const result: DriverInput = {
      driveX: sticks ? stickX : axis('right', 'left'),
      driveY: sticks ? stickY : axis('forward', 'back'),
      turn: sticks ? stickTurn : axis('turnRight', 'turnLeft'),
      intake: switched('intake', toggleIntake),
      outtake: held('outtake'),
      shoot: switched('shoot', toggleShoot),
      deploy: held('deploy'),
      block: held('block'),
      climbUp: climb && !this.climbDown,
      climbDown: climb && this.climbDown,
      powerUp: held('powerUp'),
    };
    this.tapped.clear();
    return result;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Which gamepad buttons are down. Fires an action for each one newly pressed. */
  private readGamepad(): boolean[] {
    const pad = navigator.getGamepads?.().find((p) => p !== null && p.connected) ?? null;
    this.gamepadConnected = pad !== null;
    if (!pad) {
      this.padButtons = [];
      return [];
    }
    const pressed = pad.buttons.map((button) => button.pressed);
    if (this.active()) {
      const { pad: buttons } = this.settings();
      for (const [control, action] of Object.entries(ACTIONS) as [Control, InputAction][]) {
        const button = buttons[control];
        if (button >= 0 && pressed[button] && !this.padButtons[button]) this.onAction(action);
      }
    }
    this.padButtons = pressed;
    return pressed;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active()) return;
    // Typing in a form field must not drive the robot or trigger shortcuts.
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

    const { keys: bound } = this.settings();
    const control = (Object.keys(bound) as Control[]).find((id) => bound[id] === event.code);
    if (!control) return;
    event.preventDefault();
    const action = ACTIONS[control];
    if (action) {
      if (!event.repeat) this.onAction(action);
      return;
    }
    this.keys.add(event.code);
    this.tapped.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.tapped.clear();
  };
}

/** Removes stick drift near the centre and gives finer control at low speed. */
function shape(value: number): number {
  const size = Math.abs(value);
  if (size < DEADBAND) return 0;
  const scaled = Math.min(1, (size - DEADBAND) / (1 - DEADBAND));
  return Math.sign(value) * scaled * scaled;
}
