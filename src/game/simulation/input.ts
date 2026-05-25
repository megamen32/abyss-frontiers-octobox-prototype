import type { InputState } from '../types';

export class InputController {
  private readonly keys = new Set<string>();
  private restartLatched = false;
  private debugLatched = false;

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
      right: (this.keys.has('KeyD') ? 1 : 0) + (this.keys.has('KeyA') ? -1 : 0),
      vertical: (this.keys.has('Space') ? 1 : 0) + (this.keys.has('ControlLeft') || this.keys.has('ControlRight') ? -1 : 0),
      boost: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      restartPressed: this.restartLatched,
      debugTogglePressed: this.debugLatched,
    };
    this.restartLatched = false;
    this.debugLatched = false;
    return state;
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    if (event.code === 'KeyR') {
      this.restartLatched = true;
    }
    if (event.code === 'F1') {
      event.preventDefault();
      this.debugLatched = true;
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };
}
