import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { ChunkBuildTimings, ChunkCoord, ChunkData, DebugTimingSnapshot, ChunkSyncResult } from '../types';
import { chunkKey, worldToChunkCoord } from '../utils/chunk';
import { chunkGenerationRadius } from '../utils/visibility';
import { ChunkGenerator } from '../content/chunkGenerator';
import { hydrateChunk } from '../content/chunkPayload';

interface ChunkWorkerResponse {
  type: 'ready';
  key: string;
  chunk: Parameters<typeof hydrateChunk>[0];
  timings: ChunkBuildTimings;
}

export class ChunkManager {
  readonly activeChunks = new Map<string, ChunkData>();
  private readonly generator: ChunkGenerator;
  private readonly workers: Worker[];
  private readonly seed: number;
  private readonly pendingKeys = new Set<string>();
  private readonly wantedKeys = new Set<string>();
  private readonly readyQueue: ChunkData[] = [];
  private readonly debugTimings: Pick<DebugTimingSnapshot, 'hydrateMs' | 'readyQueueMs' | 'workerTotalMs' | 'workerOctoboxMs' | 'workerSerializeMs'> = {
    hydrateMs: 0,
    readyQueueMs: 0,
    workerTotalMs: 0,
    workerOctoboxMs: 0,
    workerSerializeMs: 0,
  };
  private roundRobinIndex = 0;

  constructor(seed: number) {
    this.seed = seed;
    this.generator = new ChunkGenerator(seed);
    this.workers = Array.from({ length: GAME_CONFIG.world.chunkBuildWorkers }, () => {
      const worker = new Worker(new URL('../content/chunkWorker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', this.handleWorkerMessage);
      return worker;
    });
  }

  syncAround(position: Vector3, forward: Vector3, speed: number): ChunkSyncResult {
    const currentCoord = worldToChunkCoord(position);
    const radius = chunkGenerationRadius();
    const wanted = new Set<string>();
    const added: ChunkData[] = [];

    for (const coord of prioritizedChunkCoords(currentCoord, radius, forward, speed)) {
      const key = chunkKey(coord);
      wanted.add(key);
      if (!this.activeChunks.has(key) && !this.pendingKeys.has(key)) {
        if (this.activeChunks.size === 0 && this.pendingKeys.size === 0 && key === chunkKey(currentCoord)) {
          const chunk = this.generator.generate(coord);
          this.activeChunks.set(key, chunk);
          added.push(chunk);
        } else {
          this.pendingKeys.add(key);
          const worker = this.workers[this.roundRobinIndex % this.workers.length];
          this.roundRobinIndex += 1;
          worker.postMessage({ type: 'generate', seed: this.seed, coord });
        }
      }
    }

    this.wantedKeys.clear();
    for (const key of wanted) {
      this.wantedKeys.add(key);
    }

    const removed: string[] = [];
    for (const key of this.activeChunks.keys()) {
      if (!wanted.has(key)) {
        this.activeChunks.delete(key);
        removed.push(key);
      }
    }

    const readyQueueStart = performance.now();
    while (this.readyQueue.length > 0) {
      const chunk = this.readyQueue.shift();
      if (!chunk || !wanted.has(chunk.key) || this.activeChunks.has(chunk.key)) {
        continue;
      }
      this.activeChunks.set(chunk.key, chunk);
      added.push(chunk);
    }
    this.debugTimings.readyQueueMs = smoothTiming(this.debugTimings.readyQueueMs, performance.now() - readyQueueStart);

    return { added, removed, currentCoord };
  }

  consumeDebugTimings(): Pick<DebugTimingSnapshot, 'hydrateMs' | 'readyQueueMs' | 'workerTotalMs' | 'workerOctoboxMs' | 'workerSerializeMs'> {
    return { ...this.debugTimings };
  }

  dispose(): void {
    for (const worker of this.workers) {
      worker.removeEventListener('message', this.handleWorkerMessage);
      worker.terminate();
    }
  }

  private handleWorkerMessage = (event: MessageEvent<ChunkWorkerResponse>): void => {
    if (event.data.type !== 'ready') {
      return;
    }
    this.pendingKeys.delete(event.data.key);
    this.debugTimings.workerTotalMs = smoothTiming(this.debugTimings.workerTotalMs, event.data.timings.totalMs);
    this.debugTimings.workerOctoboxMs = smoothTiming(this.debugTimings.workerOctoboxMs, event.data.timings.octoboxMs);
    this.debugTimings.workerSerializeMs = smoothTiming(this.debugTimings.workerSerializeMs, event.data.timings.serializeMs);
    const hydrateStart = performance.now();
    const chunk = hydrateChunk(event.data.chunk);
    this.debugTimings.hydrateMs = smoothTiming(this.debugTimings.hydrateMs, performance.now() - hydrateStart);
    if (!this.wantedKeys.has(chunk.key) || this.activeChunks.has(chunk.key)) {
      return;
    }
    this.readyQueue.push(chunk);
  };
}

function smoothTiming(current: number, next: number): number {
  if (current === 0) {
    return next;
  }
  return current * 0.82 + next * 0.18;
}

export function prioritizedChunkCoords(
  currentCoord: ChunkCoord,
  radius: number,
  forward: Vector3,
  speed = 0,
): ChunkCoord[] {
  const normalizedForward = forward.lengthSq() > 0.0001 ? forward.clone().normalize() : new Vector3(0, 0, 1);
  const predictedChunkOffset = normalizedForward
    .clone()
    .multiplyScalar((speed * GAME_CONFIG.world.generationLookaheadSeconds) / GAME_CONFIG.world.chunkSize);
  const queue: Array<{ coord: ChunkCoord; score: number }> = [];

  for (let x = -radius; x <= radius; x += 1) {
    for (let y = -radius; y <= radius; y += 1) {
      for (let z = -radius; z <= radius; z += 1) {
        const coord = { x: currentCoord.x + x, y: currentCoord.y + y, z: currentCoord.z + z };
        const offset = new Vector3(x, y, z);
        if (offset.lengthSq() === 0) {
          queue.push({ coord, score: Number.POSITIVE_INFINITY });
          continue;
        }
        const direction = offset.normalize();
        const forwardness = direction.dot(normalizedForward);
        const predictedDistance = offset.distanceTo(predictedChunkOffset);
        const distancePenalty = offset.length() * 0.28;
        const verticalPenalty = Math.abs(direction.y) * 0.15;
        queue.push({
          coord,
          score: forwardness * 3.2 - distancePenalty - verticalPenalty - predictedDistance * 0.6,
        });
      }
    }
  }

  queue.sort((a, b) => b.score - a.score);
  return queue.map((entry) => entry.coord);
}
