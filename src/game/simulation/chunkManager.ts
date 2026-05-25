import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { ChunkCoord, ChunkData } from '../types';
import { chunkKey, worldToChunkCoord } from '../utils/chunk';
import { ChunkGenerator } from '../content/chunkGenerator';
import { hydrateChunk } from '../content/chunkPayload';

interface ChunkWorkerResponse {
  type: 'ready';
  key: string;
  chunk: Parameters<typeof hydrateChunk>[0];
}

export class ChunkManager {
  readonly activeChunks = new Map<string, ChunkData>();
  private readonly generator: ChunkGenerator;
  private readonly workers: Worker[];
  private readonly seed: number;
  private readonly pendingKeys = new Set<string>();
  private readonly wantedKeys = new Set<string>();
  private readonly readyQueue: ChunkData[] = [];
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

  syncAround(position: Vector3): { added: ChunkData[]; removed: string[]; currentCoord: ChunkCoord } {
    const currentCoord = worldToChunkCoord(position);
    const radius = GAME_CONFIG.world.activeRadius;
    const wanted = new Set<string>();
    const added: ChunkData[] = [];

    for (let x = -radius; x <= radius; x += 1) {
      for (let y = -radius; y <= radius; y += 1) {
        for (let z = -radius; z <= radius; z += 1) {
          const coord = { x: currentCoord.x + x, y: currentCoord.y + y, z: currentCoord.z + z };
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

    while (this.readyQueue.length > 0) {
      const chunk = this.readyQueue.shift();
      if (!chunk || !wanted.has(chunk.key) || this.activeChunks.has(chunk.key)) {
        continue;
      }
      this.activeChunks.set(chunk.key, chunk);
      added.push(chunk);
    }

    return { added, removed, currentCoord };
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
    const chunk = hydrateChunk(event.data.chunk);
    if (!this.wantedKeys.has(chunk.key) || this.activeChunks.has(chunk.key)) {
      return;
    }
    this.readyQueue.push(chunk);
  };
}
