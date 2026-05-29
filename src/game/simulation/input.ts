import { GAME_CONFIG } from '../config';
import type { InputState } from '../types';

interface RawGamepadState {
  connected: boolean;
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
  lt: number;
  rt: number;
  a: boolean;
  y: boolean;
  lb: boolean;
  rb: boolean;
  start: boolean;
  prevA: boolean;
  prevY: boolean;
  prevStart: boolean;
}

function applyDeadzone(value: number, threshold: number): number {
  if (Math.abs(value) < threshold) return 0;
  return (value - Math.sign(value) * threshold) / (1 - threshold);
}

function pollGamepad(prev: RawGamepadState): RawGamepadState {
  const gamepads = navigator.getGamepads();
  let gp: Gamepad | null = null;
  for (let i = 0; i < gamepads.length; i += 1) {
    if (gamepads[i]) { gp = gamepads[i]; break; }
  }
  if (!gp) {
    return { ...prev, connected: false };
  }
  const cfg = GAME_CONFIG.gamepad;
  const a = gp.buttons[0]?.pressed ?? false;
  const y = gp.buttons[3]?.pressed ?? false;
  const start = gp.buttons[9]?.pressed ?? false;
  const next: RawGamepadState = {
    connected: true,
    leftX: applyDeadzone(gp.axes[0] ?? 0, cfg.leftStickDeadzone),
    leftY: applyDeadzone(gp.axes[1] ?? 0, cfg.leftStickDeadzone),
    rightX: applyDeadzone(gp.axes[2] ?? 0, cfg.rightStickDeadzone),
    rightY: applyDeadzone(gp.axes[3] ?? 0, cfg.rightStickDeadzone),
    lt: gp.buttons[6] ? Math.max(0, (gp.buttons[6].value ?? 0) - cfg.triggerThreshold) / (1 - cfg.triggerThreshold) : 0,
    rt: gp.buttons[7] ? Math.max(0, (gp.buttons[7].value ?? 0) - cfg.triggerThreshold) / (1 - cfg.triggerThreshold) : 0,
    a,
    y,
    lb: gp.buttons[4]?.pressed ?? false,
    rb: gp.buttons[5]?.pressed ?? false,
    start,
    prevA: prev.a,
    prevY: prev.y,
    prevStart: prev.start,
  };
  return next;
}

export class InputController {
  private readonly keys = new Set<string>();
  private accelerationAdjustLatched = 0;
  private dragAdjustLatched = 0;
  private turnAdjustLatched = 0;
  private restartLatched = false;
  private debugLatched = false;
  private chunkDebugLatched = false;
  private fogLatched = false;
  private debugUiLatched = false;
  private pauseLatched = false;
  private autopilotLatched = false;
  private touchForward = 0;
  private touchRight = 0;
  private touchVertical = 0;
  private gamepad: RawGamepadState = {
    connected: false,
    leftX: 0, leftY: 0,
    rightX: 0, rightY: 0,
    lt: 0, rt: 0,
    a: false, y: false,
    lb: false, rb: false,
    start: false,
    prevA: false, prevY: false, prevStart: false,
  };

  constructor(private readonly target: Window) {
    target.addEventListener('keydown', this.handleKeyDown);
    target.addEventListener('keyup', this.handleKeyUp);
    target.addEventListener('gamepadconnected', () => { this.gamepad.connected = true; });
    target.addEventListener('gamepaddisconnected', () => { this.gamepad.connected = false; });
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.handleKeyDown);
    this.target.removeEventListener('keyup', this.handleKeyUp);
  }

  isGamepadConnected(): boolean {
    return this.gamepad.connected;
  }

  setTouchInput(forward: number, right: number, vertical: number): void {
    this.touchForward = forward;
    this.touchRight = right;
    this.touchVertical = vertical;
  }

  sample(): InputState {
    this.gamepad = pollGamepad(this.gamepad);
    const gp = this.gamepad;
    const cfg = GAME_CONFIG.gamepad;

    const kbForward = (this.keys.has('KeyW') ? 1 : 0) + (this.keys.has('KeyS') ? -1 : 0);
    const kbRight = (this.keys.has('KeyD') ? -1 : 0) + (this.keys.has('KeyA') ? 1 : 0);
    const kbVertical = (this.keys.has('Space') ? 1 : 0) + (this.keys.has('ControlLeft') || this.keys.has('ControlRight') ? -1 : 0);

    const gpYaw = -gp.leftX * cfg.stickYawScale;
    const gpPitch = -gp.leftY * cfg.stickPitchScale;

    const forward = Math.max(-1, Math.min(1, kbForward + gpPitch + this.touchForward));
    const right = Math.max(-1, Math.min(1, kbRight + gpYaw + this.touchRight));

    let vertical = kbVertical + this.touchVertical;
    if (gp.rb) vertical += 1;
    if (gp.lb) vertical -= 1;
    vertical = Math.max(-1, Math.min(1, vertical));

    const boost = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) || gp.lt > 0.3;
    const brake = gp.rt > 0.3;

    if (gp.a && !gp.prevA) this.restartLatched = true;
    if (gp.y && !gp.prevY) this.debugLatched = true;
    if (gp.start && !gp.prevStart) this.pauseLatched = true;

    const state: InputState = {
      forward,
      right,
      vertical,
      boost,
      brake,
      accelerationAdjust: this.accelerationAdjustLatched,
      dragAdjust: this.dragAdjustLatched,
      turnAdjust: this.turnAdjustLatched,
      restartPressed: this.restartLatched,
      debugTogglePressed: this.debugLatched,
      chunkDebugTogglePressed: this.chunkDebugLatched,
      fogTogglePressed: this.fogLatched,
      debugUiTogglePressed: this.debugUiLatched,
      pausePressed: this.pauseLatched,
      autopilotTogglePressed: this.autopilotLatched,
      cameraYaw: gp.rightX * cfg.cameraYawScale,
    };
    this.accelerationAdjustLatched = 0;
    this.dragAdjustLatched = 0;
    this.turnAdjustLatched = 0;
    this.restartLatched = false;
    this.debugLatched = false;
    this.chunkDebugLatched = false;
    this.fogLatched = false;
    this.debugUiLatched = false;
    this.pauseLatched = false;
    this.autopilotLatched = false;
    return state;
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    if (event.code === 'KeyR') this.restartLatched = true;
    if (event.code === 'KeyZ') { event.preventDefault(); this.debugLatched = true; }
    if (event.code === 'KeyC') { event.preventDefault(); this.chunkDebugLatched = true; }
    if (event.code === 'KeyF') { event.preventDefault(); this.fogLatched = true; }
    if (event.code === 'KeyU') { event.preventDefault(); this.debugUiLatched = true; }
    if (event.code === 'Escape') { event.preventDefault(); this.pauseLatched = true; }
    if (event.code === 'KeyB') { event.preventDefault(); this.autopilotLatched = true; }
    if (event.code === 'Equal' || event.code === 'NumpadAdd') { event.preventDefault(); this.accelerationAdjustLatched += 1; }
    if (event.code === 'Minus' || event.code === 'NumpadSubtract') { event.preventDefault(); this.accelerationAdjustLatched -= 1; }
    if (event.code === 'BracketRight') { event.preventDefault(); this.dragAdjustLatched += 1; }
    if (event.code === 'BracketLeft') { event.preventDefault(); this.dragAdjustLatched -= 1; }
    if (event.code === 'Quote') { event.preventDefault(); this.turnAdjustLatched += 1; }
    if (event.code === 'Semicolon') { event.preventDefault(); this.turnAdjustLatched -= 1; }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };
}
