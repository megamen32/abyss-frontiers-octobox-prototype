import type { ChunkCoord, Face } from '../types';

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
  return hashInts(globalSeed, coord.x, coord.y, coord.z);
}

export function faceSeed(globalSeed: number, coord: ChunkCoord, face: Face): number {
  switch (face) {
    case 'px':
      return hashInts(globalSeed, 1, coord.x + 1, coord.y, coord.z);
    case 'nx':
      return hashInts(globalSeed, 1, coord.x, coord.y, coord.z);
    case 'py':
      return hashInts(globalSeed, 2, coord.y + 1, coord.x, coord.z);
    case 'ny':
      return hashInts(globalSeed, 2, coord.y, coord.x, coord.z);
    case 'pz':
      return hashInts(globalSeed, 3, coord.z + 1, coord.x, coord.y);
    case 'nz':
      return hashInts(globalSeed, 3, coord.z, coord.x, coord.y);
  }
}
