import type { DebugTimingSnapshot } from '../types';

const METRIC_KEYS: Array<keyof DebugTimingSnapshot> = [
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
  'workerStaticMeshMs',
  'workerSerializeMs',
  'workerCount',
  'drawCalls',
  'drawTriangles',
  'drawLines',
  'drawPoints',
  'visibleChunks',
  'staticMeshChunks',
];

export interface PerformanceFrame extends DebugTimingSnapshot {
  timestampMs: number;
  fps: number;
}

export interface PerformanceMetricSummary {
  average: number;
  minimum: number;
  maximum: number;
  p95: number;
}

export interface PerformanceReport {
  capturedAt: string;
  frameCount: number;
  metrics: Record<string, PerformanceMetricSummary>;
  frames: PerformanceFrame[];
}

export interface PerformanceCaptureApi {
  clear: () => void;
  report: () => PerformanceReport;
}

declare global {
  interface Window {
    __ABYSS_PERF__?: PerformanceCaptureApi;
  }
}

export class PerformanceCapture {
  private readonly frames: PerformanceFrame[] = [];

  constructor(private readonly maxFrames = 600) {
    window.__ABYSS_PERF__ = {
      clear: () => this.frames.splice(0),
      report: () => this.report(),
    };
  }

  record(fps: number, timings: DebugTimingSnapshot): void {
    this.frames.push({ timestampMs: performance.now(), fps, ...timings });
    if (this.frames.length > this.maxFrames) {
      this.frames.shift();
    }
  }

  report(): PerformanceReport {
    const metrics: Record<string, PerformanceMetricSummary> = {
      fps: summarize(this.frames.map((frame) => frame.fps)),
    };
    for (const key of METRIC_KEYS) {
      metrics[key] = summarize(this.frames.map((frame) => frame[key]));
    }
    return {
      capturedAt: new Date().toISOString(),
      frameCount: this.frames.length,
      metrics,
      frames: [...this.frames],
    };
  }
}

function summarize(samples: number[]): PerformanceMetricSummary {
  if (samples.length === 0) {
    return { average: 0, minimum: 0, maximum: 0, p95: 0 };
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    average: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    minimum: sorted[0],
    maximum: sorted[sorted.length - 1],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
  };
}
