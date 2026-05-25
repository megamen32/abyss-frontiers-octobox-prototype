import type { InputState } from '../types';

export class InputController {
  private readonly keys = new Set<string>();
  private accelerationAdjustLatched = 0;
  private dragAdjustLatched = 0;
  private turnAdjustLatched = 0;
  private restartLatched = false;
  private debugLatched = false;
  private chunkDebugLatched = false;
  private fogLatched = false;

  constructor(private readonly target: Window) {
    target.addEventListener('keydown', this.handleKeyDown);
    target.addEventListener('keyup', this.handleKeyUp);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.handleKeyDown);
    this.target.removeEventListener('keyup', this.handleKeyUp);
  }

  sample(): InputState {
    const state: InputState = {
      forward: (this.keys.has('KeyW') ? 1 : 0) + (this.keys.has('KeyS') ? -1 : 0),
      right: (this.keys.has('KeyD') ? -1 : 0) + (this.keys.has('KeyA') ? 1 : 0),
      vertical: (this.keys.has('Space') ? 1 : 0) + (this.keys.has('ControlLeft') || this.keys.has('ControlRight') ? -1 : 0),
      boost: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      accelerationAdjust: this.accelerationAdjustLatched,
      dragAdjust: this.dragAdjustLatched,
      turnAdjust: this.turnAdjustLatched,
      restartPressed: this.restartLatched,
      debugTogglePressed: this.debugLatched,
      chunkDebugTogglePressed: this.chunkDebugLatched,
      fogTogglePressed: this.fogLatched,
    };
    this.accelerationAdjustLatched = 0;
    this.dragAdjustLatched = 0;
    this.turnAdjustLatched = 0;
    this.restartLatched = false;
    this.debugLatched = false;
    this.chunkDebugLatched = false;
    this.fogLatched = false;
    return state;
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    if (event.code === 'KeyR') {
      this.restartLatched = true;
    }
    if (event.code === 'KeyZ') {
      event.preventDefault();
      this.debugLatched = true;
    }
    if (event.code === 'KeyC') {
      event.preventDefault();
      this.chunkDebugLatched = true;
    }
    if (event.code === 'KeyF') {
      event.preventDefault();
      this.fogLatched = true;
    }
    if (event.code === 'Equal' || event.code === 'NumpadAdd') {
      event.preventDefault();
      this.accelerationAdjustLatched += 1;
    }
    if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
      event.preventDefault();
      this.accelerationAdjustLatched -= 1;
    }
    if (event.code === 'BracketRight') {
      event.preventDefault();
      this.dragAdjustLatched += 1;
    }
    if (event.code === 'BracketLeft') {
      event.preventDefault();
      this.dragAdjustLatched -= 1;
    }
    if (event.code === 'Quote') {
      event.preventDefault();
      this.turnAdjustLatched += 1;
    }
    if (event.code === 'Semicolon') {
      event.preventDefault();
      this.turnAdjustLatched -= 1;
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };
}
