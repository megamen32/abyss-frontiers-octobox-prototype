import { GAME_CONFIG } from '../config';

export class SpawnBudgetController {
  private budget: number = GAME_CONFIG.world.spawnBudgetInitial;
  private sampleTime = 0;
  private weightedFps = 0;
  private lastMinuteAverageFps = 60;

  reset(): void {
    this.budget = GAME_CONFIG.world.spawnBudgetInitial;
    this.sampleTime = 0;
    this.weightedFps = 0;
    this.lastMinuteAverageFps = 60;
  }

  recordFrame(dt: number, fps: number): void {
    this.sampleTime += dt;
    this.weightedFps += fps * dt;

    if (this.sampleTime < GAME_CONFIG.world.spawnBudgetSampleSeconds) {
      return;
    }

    this.lastMinuteAverageFps = this.weightedFps / this.sampleTime;
    if (this.lastMinuteAverageFps < GAME_CONFIG.world.spawnBudgetFpsThreshold) {
      this.budget = Math.max(GAME_CONFIG.world.spawnBudgetMin, this.budget - 1);
    }

    this.sampleTime = 0;
    this.weightedFps = 0;
  }

  getBudget(): number {
    return this.budget;
  }

  getAverageFps(): number {
    if (this.sampleTime <= 0) {
      return this.lastMinuteAverageFps;
    }
    return this.weightedFps / this.sampleTime;
  }
}
