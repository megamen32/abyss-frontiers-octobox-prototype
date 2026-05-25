import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import { detectCaveChunk } from '../content/caveSystem';
import type { AABB, ChunkBuildTimings, ChunkCoord, ChunkData, DebugTimingSnapshot, Face, ChunkSyncResult } from '../types';
import { chunkKey, intersectsAabb, worldToChunkCoord } from '../utils/chunk';
import {
  chunkEvictionRadius,
  chunkGenerationRadius,
  getChunkFrustumPriority,
  getChunkOcclusionPenalty,
  type ViewFrustumSnapshot,
} from '../utils/visibility';
import { hydrateChunk } from '../content/chunkPayload';

interface ChunkWorkerResponse {
  type: 'ready';
  key: string;
  chunk: Parameters<typeof hydrateChunk>[0];
  timings: ChunkBuildTimings;
}

interface ChunkSyncOptions {
  caveOnly?: boolean;
  retentionAabb?: AABB;
  forcedCaves?: Array<{ coord: ChunkCoord; entranceFace: Face; clusterCenter: ChunkCoord; mouthRadiusChunks: number }>;
  viewFrustum?: ViewFrustumSnapshot;
}

export class ChunkManager {
  readonly activeChunks = new Map<string, ChunkData>();
  private readonly workers: Worker[];
  private readonly seed: number;
  private readonly pendingKeys = new Set<string>();
  private readonly wantedKeys = new Set<string>();
  private readonly readyQueue: ChunkData[] = [];
  private readonly debugTimings: Pick<DebugTimingSnapshot, 'hydrateMs' | 'readyQueueMs' | 'workerTotalMs' | 'workerOctoboxMs' | 'workerStaticMeshMs' | 'workerSerializeMs'> = {
    hydrateMs: 0,
    readyQueueMs: 0,
    workerTotalMs: 0,
    workerOctoboxMs: 0,
    workerStaticMeshMs: 0,
    workerSerializeMs: 0,
  };
  private roundRobinIndex = 0;

  constructor(seed: number) {
    this.seed = seed;
    this.workers = Array.from({ length: GAME_CONFIG.world.chunkBuildWorkers }, () => {
      const worker = new Worker(new URL('../content/chunkWorker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', this.handleWorkerMessage);
      return worker;
    });
  }

  syncAround(position: Vector3, forward: Vector3, speed: number, options: ChunkSyncOptions = {}): ChunkSyncResult {
    const currentCoord = worldToChunkCoord(position);
    const radius = chunkGenerationRadius();
    const evictRadius = chunkEvictionRadius();
    const wanted = new Set<string>();
    const keepAlive = new Set<string>();
    const added: ChunkData[] = [];
    const forcedCaves = new Map((options.forcedCaves ?? []).map((entry) => [chunkKey(entry.coord), entry]));

    // Build the generation set (inner radius) — request missing chunks from workers.
    for (const coord of prioritizedChunkCoords(currentCoord, radius, forward, speed, options.viewFrustum, this.activeChunks.values())) {
      const key = chunkKey(coord);
      const forcedEntry = forcedCaves.get(key);
      if (options.caveOnly && !forcedEntry && !detectCaveChunk(this.seed, coord)) {
        continue;
      }
      wanted.add(key);
      keepAlive.add(key);
      if (!this.activeChunks.has(key) && !this.pendingKeys.has(key)) {
        this.pendingKeys.add(key);
        const worker = this.workers[this.roundRobinIndex % this.workers.length];
        this.roundRobinIndex += 1;
        worker.postMessage({
          type: 'generate',
          seed: this.seed,
          coord,
          forceCaveEntranceFace: forcedEntry?.entranceFace,
          forceCaveClusterCenter: forcedEntry?.clusterCenter,
          forceCaveMouthRadiusChunks: forcedEntry?.mouthRadiusChunks,
        });
      }
    }

    // Build the eviction set (outer radius) — already-loaded chunks in this band are kept alive
    // even though we won't request new ones there.
    if (!options.caveOnly) {
      for (let x = -evictRadius; x <= evictRadius; x += 1) {
        for (let y = -evictRadius; y <= evictRadius; y += 1) {
          for (let z = -evictRadius; z <= evictRadius; z += 1) {
            const coord = { x: currentCoord.x + x, y: currentCoord.y + y, z: currentCoord.z + z };
            keepAlive.add(chunkKey(coord));
          }
        }
      }
    }

    if (options.retentionAabb) {
      for (const chunk of this.activeChunks.values()) {
        if (intersectsAabb(chunk.bounds, options.retentionAabb)) {
          keepAlive.add(chunk.key);
        }
      }
    }

    // wantedKeys governs which worker results are accepted; use the larger keepAlive set so
    // in-flight chunks for the buffer zone aren't discarded on arrival.
    this.wantedKeys.clear();
    for (const key of keepAlive) {
      this.wantedKeys.add(key);
    }

    const removed: string[] = [];
    for (const key of this.activeChunks.keys()) {
      if (!keepAlive.has(key)) {
        this.activeChunks.delete(key);
        removed.push(key);
      }
    }

    const readyQueueStart = performance.now();
    while (this.readyQueue.length > 0) {
      const chunk = this.readyQueue.shift();
      if (!chunk || !keepAlive.has(chunk.key) || this.activeChunks.has(chunk.key)) {
        continue;
      }
      this.activeChunks.set(chunk.key, chunk);
      added.push(chunk);
    }
    this.debugTimings.readyQueueMs = smoothTiming(this.debugTimings.readyQueueMs, performance.now() - readyQueueStart);

    return { added, removed, currentCoord };
  }

  consumeDebugTimings(): Pick<DebugTimingSnapshot, 'hydrateMs' | 'readyQueueMs' | 'workerTotalMs' | 'workerOctoboxMs' | 'workerStaticMeshMs' | 'workerSerializeMs'> {
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
    this.debugTimings.workerStaticMeshMs = smoothTiming(this.debugTimings.workerStaticMeshMs, event.data.timings.staticMeshMs);
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
  viewFrustum?: ViewFrustumSnapshot,
  blockers?: Iterable<ChunkData>,
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
        const chunkLen = offset.length();
        const direction = offset.normalize();
        const forwardness = direction.dot(normalizedForward);
        // Asymmetric generation: full radius forward, half sideways, 1 chunk behind.
        const maxLen = forwardness > 0.3 ? radius : forwardness > -0.3 ? radius * 0.5 : 1.0;
        if (chunkLen > maxLen + 0.5) {
          continue;
        }
        const predictedDistance = offset.distanceTo(predictedChunkOffset);
        const distancePenalty = chunkLen * 0.28;
        const verticalPenalty = Math.abs(direction.y) * 0.15;
        let frustumScore = 0;
        let occlusionPenalty = 0;
        if (viewFrustum) {
          const size = GAME_CONFIG.world.chunkSize;
          const bounds = {
            min: new Vector3(coord.x * size, coord.y * size, coord.z * size),
            max: new Vector3((coord.x + 1) * size, (coord.y + 1) * size, (coord.z + 1) * size),
          };
          frustumScore = getChunkFrustumPriority(bounds, viewFrustum) * 4.5;
          occlusionPenalty = blockers ? getChunkOcclusionPenalty(bounds, viewFrustum.position, blockers) : 0;
        }
        queue.push({
          coord,
          score: frustumScore + forwardness * 3.2 - distancePenalty - verticalPenalty - predictedDistance * 0.6 - occlusionPenalty,
        });
      }
    }
  }

  queue.sort((a, b) => b.score - a.score);
  return queue.map((entry) => entry.coord);
}
