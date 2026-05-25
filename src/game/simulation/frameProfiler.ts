import type { DebugTimingSnapshot } from '../types';

type TimingKey = keyof DebugTimingSnapshot;

const TIMING_KEYS: TimingKey[] = [
  'frameMs',
  'inputMs',
  'simulationMs',
  'chunkSyncMs',
  'worldMs',
  'renderMs',
  'renderSpawnQueueMs',
  'renderChunkUpdateMs',
  'renderDebugMs',
  'renderHudCameraMs',
  'renderDrawMs',
  'hydrateMs',
  'readyQueueMs',
  'workerTotalMs',
  'workerOctoboxMs',
  'workerSerializeMs',
  'drawCalls',
  'drawTriangles',
  'drawLines',
  'drawPoints',
];

export class FrameProfiler {
  private readonly values: DebugTimingSnapshot = {
    frameMs: 0,
    inputMs: 0,
    simulationMs: 0,
    chunkSyncMs: 0,
    worldMs: 0,
    renderMs: 0,
    renderSpawnQueueMs: 0,
    renderChunkUpdateMs: 0,
    renderDebugMs: 0,
    renderHudCameraMs: 0,
    renderDrawMs: 0,
    hydrateMs: 0,
    readyQueueMs: 0,
    workerTotalMs: 0,
    workerOctoboxMs: 0,
    workerSerializeMs: 0,
    drawCalls: 0,
    drawTriangles: 0,
    drawLines: 0,
    drawPoints: 0,
  };

  addSample(key: TimingKey, value: number): void {
    this.values[key] = blend(this.values[key], value);
  }

  addSnapshot(snapshot: Partial<DebugTimingSnapshot>): void {
    for (const key of TIMING_KEYS) {
      const value = snapshot[key];
      if (typeof value === 'number') {
        this.addSample(key, value);
      }
    }
  }

  snapshot(): DebugTimingSnapshot {
    return { ...this.values };
  }
}

function blend(current: number, next: number): number {
  if (current === 0) {
    return next;
  }
  return current * 0.82 + next * 0.18;
}
