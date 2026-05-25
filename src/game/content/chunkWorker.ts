/// <reference lib="webworker" />

import { ChunkGenerator } from './chunkGenerator';
import { dehydrateChunk } from './chunkPayload';
import type { ChunkBuildTimings, ChunkCoord } from '../types';

interface GenerateChunkRequest {
  type: 'generate';
  seed: number;
  coord: ChunkCoord;
}

interface GenerateChunkResponse {
  type: 'ready';
  key: string;
  chunk: ReturnType<typeof dehydrateChunk>;
  timings: ChunkBuildTimings;
}

let generator: ChunkGenerator | null = null;
let currentSeed: number | null = null;

self.onmessage = (event: MessageEvent<GenerateChunkRequest>) => {
  if (event.data.type !== 'generate') {
    return;
  }
  if (!generator || currentSeed !== event.data.seed) {
    generator = new ChunkGenerator(event.data.seed);
    currentSeed = event.data.seed;
  }
  const result = generator.generateProfiled(event.data.coord);
  const serializeStart = performance.now();
  const dehydrated = dehydrateChunk(result.chunk);
  const serializeMs = performance.now() - serializeStart;
  const response: GenerateChunkResponse = {
    type: 'ready',
    key: result.chunk.key,
    chunk: dehydrated,
    timings: {
      ...result.timings,
      serializeMs,
      totalMs: result.timings.totalMs + serializeMs,
    },
  };
  const mesh = dehydrated.staticMeshData;
  const transferables: Transferable[] = mesh
    ? [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer]
    : [];
  self.postMessage(response, transferables);
};

export {};
