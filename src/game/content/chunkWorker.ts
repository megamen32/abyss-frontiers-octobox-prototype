/// <reference lib="webworker" />

import { ChunkGenerator } from './chunkGenerator';
import { dehydrateChunk } from './chunkPayload';
import type { ChunkCoord } from '../types';

interface GenerateChunkRequest {
  type: 'generate';
  seed: number;
  coord: ChunkCoord;
}

interface GenerateChunkResponse {
  type: 'ready';
  key: string;
  chunk: ReturnType<typeof dehydrateChunk>;
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
  const chunk = generator.generate(event.data.coord);
  const response: GenerateChunkResponse = {
    type: 'ready',
    key: chunk.key,
    chunk: dehydrateChunk(chunk),
  };
  self.postMessage(response);
};

export {};
