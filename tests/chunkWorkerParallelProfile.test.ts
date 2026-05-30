import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChunkGenerator } from '../src/game/content/chunkGenerator';
import { dehydrateChunk, hydrateChunk } from '../src/game/content/chunkPayload';
import type { ChunkCoord } from '../src/game/types';

interface WorkerTaskSample {
  coord: ChunkCoord;
  totalMs: number;
  octoboxMs: number;
  adjacencyBuildMs: number;
  staticMeshMs: number;
  serializeMs: number;
  hydrateMs: number;
  payloadBytes: number;
  cells: number;
  mines: number;
  isCaveChunk: boolean;
}

interface WorkerCountProfile {
  workerCount: number;
  makespanMs: number;
  p50WorkerTotalMs: number;
  p95WorkerTotalMs: number;
  p99WorkerTotalMs: number;
  p50QueueWaitMs: number;
  p95QueueWaitMs: number;
  p99QueueWaitMs: number;
  maxQueueWaitMs: number;
  p95SerializeMs: number;
  p95HydrateMs: number;
  payloadBytes: number;
  maxWorkerPayloadBytes: number;
  maxInFlightPayloadBytes: number;
}

describe('Chunk worker parallelism profiling', () => {
  it('writes modeled worker-count profile for 1/2/4/6/8 chunk builders', async () => {
    const generator = new ChunkGenerator(133742);
    const coords = buildWorkerProfileCoords();
    const samples: WorkerTaskSample[] = [];

    for (const coord of coords) {
      const { chunk, timings } = generator.generateProfiled(coord);
      const serializeStart = performance.now();
      const dehydrated = dehydrateChunk(chunk);
      const serializeMs = performance.now() - serializeStart;
      const hydrateStart = performance.now();
      hydrateChunk(dehydrated);
      const hydrateMs = performance.now() - hydrateStart;
      samples.push({
        coord,
        totalMs: timings.totalMs + serializeMs,
        octoboxMs: timings.octoboxMs,
        adjacencyBuildMs: timings.adjacencyBuildMs ?? 0,
        staticMeshMs: timings.staticMeshMs,
        serializeMs,
        hydrateMs,
        payloadBytes: estimatePayloadBytes(dehydrated),
        cells: chunk.cells.length,
        mines: chunk.mines.length,
        isCaveChunk: chunk.isCaveChunk === true,
      });
    }

    const workerCounts = [1, 2, 4, 6, 8];
    const profiles = workerCounts.map((workerCount) => modelWorkerCount(workerCount, samples));
    const report = {
      generatedAt: new Date().toISOString(),
      coords,
      samples,
      profiles,
      recommendation: recommendWorkerCounts(profiles),
    };

    const outputDirectory = resolve(process.cwd(), 'artifacts/performance');
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      resolve(outputDirectory, 'chunk-worker-parallel-profile.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );

    for (const profile of profiles) {
      console.log(
        `workers=${profile.workerCount}`
        + ` makespan=${profile.makespanMs.toFixed(2)}`
        + ` p95Task=${profile.p95WorkerTotalMs.toFixed(2)}`
        + ` p95Wait=${profile.p95QueueWaitMs.toFixed(2)}`
        + ` hydrate=${profile.p95HydrateMs.toFixed(2)}`
        + ` maxWait=${profile.maxQueueWaitMs.toFixed(2)}`
        + ` payload=${profile.payloadBytes}`,
      );
    }

    expect(samples.length).toBeGreaterThan(20);
    expect(profiles.map((profile) => profile.workerCount)).toEqual(workerCounts);
    expect(profiles[0].makespanMs).toBeGreaterThan(profiles[1].makespanMs);
    expect(profiles[profiles.length - 1].p95WorkerTotalMs).toBeLessThan(40);
    expect(profiles[profiles.length - 1].p95HydrateMs).toBeLessThan(4);
  }, 30_000);
});

function buildWorkerProfileCoords(): ChunkCoord[] {
  const coords: ChunkCoord[] = [];
  for (const y of [0, -10, -11, 511]) {
    for (const x of [0, 1, 511]) {
      for (const z of [0, 1, 511]) {
        coords.push({ x, y, z });
      }
    }
  }
  coords.push(
    { x: 3, y: 500, z: 3 },
    { x: 4, y: 500, z: 3 },
    { x: 3, y: 499, z: 3 },
  );
  const unique = new Map<string, ChunkCoord>();
  for (const coord of coords) {
    unique.set(`${coord.x},${coord.y},${coord.z}`, coord);
  }
  return [...unique.values()];
}

function modelWorkerCount(workerCount: number, samples: WorkerTaskSample[]): WorkerCountProfile {
  const workerReadyAt = new Array(workerCount).fill(0) as number[];
  const queueWaits: number[] = [];
  const workerPayloads = new Array(workerCount).fill(0) as number[];
  for (const sample of samples) {
    let worker = 0;
    for (let index = 1; index < workerReadyAt.length; index += 1) {
      if (workerReadyAt[index] < workerReadyAt[worker]) {
        worker = index;
      }
    }
    queueWaits.push(workerReadyAt[worker]);
    workerReadyAt[worker] += sample.totalMs;
    workerPayloads[worker] += sample.payloadBytes;
  }
  const taskTimes = samples.map((sample) => sample.totalMs);
  const maxWorkerPayloadBytes = Math.max(...workerPayloads);
  return {
    workerCount,
    makespanMs: Math.max(...workerReadyAt),
    p50WorkerTotalMs: percentile(taskTimes, 0.5),
    p95WorkerTotalMs: percentile(taskTimes, 0.95),
    p99WorkerTotalMs: percentile(taskTimes, 0.99),
    p50QueueWaitMs: percentile(queueWaits, 0.5),
    p95QueueWaitMs: percentile(queueWaits, 0.95),
    p99QueueWaitMs: percentile(queueWaits, 0.99),
    maxQueueWaitMs: Math.max(...queueWaits),
    p95SerializeMs: percentile(samples.map((sample) => sample.serializeMs), 0.95),
    p95HydrateMs: percentile(samples.map((sample) => sample.hydrateMs), 0.95),
    payloadBytes: samples.reduce((sum, sample) => sum + sample.payloadBytes, 0),
    maxWorkerPayloadBytes,
    maxInFlightPayloadBytes: maxWorkerPayloadBytes,
  };
}

function recommendWorkerCounts(profiles: WorkerCountProfile[]): { desktop: number; mobile: number } {
  const desktop = profiles.find((profile) => profile.workerCount === 4)?.workerCount ?? 2;
  const twoWorkerMobile = profiles.find((profile) => profile.workerCount === 2);
  const mobile = twoWorkerMobile && twoWorkerMobile.p95WorkerTotalMs < 40 ? 2 : 1;
  return { desktop, mobile };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function estimatePayloadBytes(value: unknown): number {
  const seen = new Set<ArrayBufferLike>();
  return estimateValueBytes(value, seen);
}

function estimateValueBytes(value: unknown, seen: Set<ArrayBufferLike>): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return 8;
  }
  if (typeof value === 'boolean') {
    return 1;
  }
  if (typeof value === 'string') {
    return value.length * 2;
  }
  if (ArrayBuffer.isView(value)) {
    const buffer = value.buffer;
    if (seen.has(buffer)) {
      return 0;
    }
    seen.add(buffer);
    return value.byteLength;
  }
  if (Array.isArray(value)) {
    let bytes = 0;
    for (const item of value) {
      bytes += estimateValueBytes(item, seen);
    }
    return bytes;
  }
  if (typeof value === 'object') {
    let bytes = 0;
    for (const item of Object.values(value)) {
      bytes += estimateValueBytes(item, seen);
    }
    return bytes;
  }
  return 0;
}
