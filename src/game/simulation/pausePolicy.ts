export function shouldAdvanceGameState(paused: boolean): boolean {
  return !paused;
}

export function runIfGameStateAdvances(paused: boolean, callback: () => void): void {
  if (!paused) {
    callback();
  }
}
