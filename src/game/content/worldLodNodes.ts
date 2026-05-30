import { GAME_CONFIG } from '../config';
import type { ChunkCoord } from '../types';
import { wrapChunkCoord } from '../utils/worldTopology';

export type LodLevel = 'near' | 'medium' | 'far';

export interface LodNodeId {
  level: LodLevel;
  coord: ChunkCoord;
}

export function lodNodeSize(level: LodLevel): number {
  if (level === 'near') return GAME_CONFIG.world.chunkSize;
  if (level === 'medium') return GAME_CONFIG.world.chunkSize * 2;
  return GAME_CONFIG.world.chunkSize * 4;
}

export function lodNodeKey(node: LodNodeId): string {
  const coord = wrapLodNodeCoord(node);
  return `${node.level}:${coord.x},${coord.y},${coord.z}`;
}

export function wrapLodNodeCoord(node: LodNodeId): ChunkCoord {
  const divisor = lodNodeSize(node.level) / GAME_CONFIG.world.chunkSize;
  const wrapped = wrapChunkCoord(node.coord);
  return {
    x: Math.floor(wrapped.x / divisor),
    y: Math.floor(wrapped.y / divisor),
    z: Math.floor(wrapped.z / divisor),
  };
}

export function meshStepForLodLevel(level: LodLevel): number {
  if (level === 'near') return GAME_CONFIG.world.meshStepNear;
  if (level === 'medium') return GAME_CONFIG.world.meshStepMedium;
  return GAME_CONFIG.world.meshStepFar;
}
