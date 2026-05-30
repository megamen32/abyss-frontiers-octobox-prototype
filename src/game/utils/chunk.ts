import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { AABB, ChunkCoord } from '../types';
import { wrapChunkCoord, wrapPosition } from './worldTopology';

export function chunkKey(coord: ChunkCoord): string {
  const wrapped = wrapChunkCoord(coord);
  return `${wrapped.x},${wrapped.y},${wrapped.z}`;
}

export function worldToChunkCoord(position: Vector3): ChunkCoord {
  const size = GAME_CONFIG.world.chunkSize;
  const wrapped = wrapPosition(position);
  return {
    x: Math.floor(wrapped.x / size),
    y: Math.floor(wrapped.y / size),
    z: Math.floor(wrapped.z / size),
  };
}

export function chunkBounds(coord: ChunkCoord): AABB {
  const size = GAME_CONFIG.world.chunkSize;
  const wrapped = wrapChunkCoord(coord);
  const min = new Vector3(wrapped.x * size, wrapped.y * size, wrapped.z * size);
  const max = min.clone().addScalar(size);
  return { min, max };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function aabbCenter(bounds: AABB): Vector3 {
  return bounds.min.clone().add(bounds.max).multiplyScalar(0.5);
}

export function aabbSize(bounds: AABB): Vector3 {
  return bounds.max.clone().sub(bounds.min);
}

export function containsPoint(bounds: AABB, point: Vector3): boolean {
  return (
    point.x >= bounds.min.x &&
    point.x <= bounds.max.x &&
    point.y >= bounds.min.y &&
    point.y <= bounds.max.y &&
    point.z >= bounds.min.z &&
    point.z <= bounds.max.z
  );
}

export function intersectsAabb(a: AABB, b: AABB): boolean {
  return (
    a.min.x <= b.max.x &&
    a.max.x >= b.min.x &&
    a.min.y <= b.max.y &&
    a.max.y >= b.min.y &&
    a.min.z <= b.max.z &&
    a.max.z >= b.min.z
  );
}
