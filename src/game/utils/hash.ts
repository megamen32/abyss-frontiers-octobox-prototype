import type { ChunkCoord, Face } from '../types';
import { wrapChunkCoord } from './worldTopology';

export function hashInts(...values: number[]): number {
  let hash = 2166136261;
  for (const value of values) {
    let v = value | 0;
    hash ^= v & 255;
    hash = Math.imul(hash, 16777619);
    v >>= 8;
    hash ^= v & 255;
    hash = Math.imul(hash, 16777619);
    v >>= 8;
    hash ^= v & 255;
    hash = Math.imul(hash, 16777619);
    v >>= 8;
    hash ^= v & 255;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function chunkSeed(globalSeed: number, coord: ChunkCoord): number {
  const wrapped = wrapChunkCoord(coord);
  return hashInts(globalSeed, wrapped.x, wrapped.y, wrapped.z);
}

export function faceSeed(globalSeed: number, coord: ChunkCoord, face: Face): number {
  const wrapped = wrapChunkCoord(coord);
  switch (face) {
    case 'px':
      return hashInts(globalSeed, 1, wrapChunkCoord({ x: wrapped.x + 1, y: wrapped.y, z: wrapped.z }).x, wrapped.y, wrapped.z);
    case 'nx':
      return hashInts(globalSeed, 1, wrapped.x, wrapped.y, wrapped.z);
    case 'py':
      return hashInts(globalSeed, 2, wrapChunkCoord({ x: wrapped.x, y: wrapped.y + 1, z: wrapped.z }).y, wrapped.x, wrapped.z);
    case 'ny':
      return hashInts(globalSeed, 2, wrapped.y, wrapped.x, wrapped.z);
    case 'pz':
      return hashInts(globalSeed, 3, wrapChunkCoord({ x: wrapped.x, y: wrapped.y, z: wrapped.z + 1 }).z, wrapped.x, wrapped.y);
    case 'nz':
      return hashInts(globalSeed, 3, wrapped.z, wrapped.x, wrapped.y);
  }
}
