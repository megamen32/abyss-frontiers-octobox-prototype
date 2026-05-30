import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { ChunkCoord } from '../types';

export const WORLD_CHUNKS_PER_AXIS = GAME_CONFIG.world.worldChunksPerAxis;
export const WORLD_SIZE = GAME_CONFIG.world.chunkSize * WORLD_CHUNKS_PER_AXIS;

export interface CoordinateMapper {
  toWrappedWorld(position: Vector3): Vector3;
  toRenderPosition(position: Vector3): Vector3;
}

export const identityCoordinateMapper: CoordinateMapper = {
  toWrappedWorld: (position) => wrapPosition(position),
  toRenderPosition: (position) => position.clone(),
};

export function wrapScalar(value: number, size = WORLD_SIZE): number {
  return ((value % size) + size) % size;
}

export function wrapPosition(position: Vector3): Vector3 {
  return new Vector3(
    wrapScalar(position.x),
    wrapScalar(position.y),
    wrapScalar(position.z),
  );
}

export function wrapPositionInPlace(position: Vector3): void {
  position.set(
    wrapScalar(position.x),
    wrapScalar(position.y),
    wrapScalar(position.z),
  );
}

export function wrapChunkCoord(coord: ChunkCoord): ChunkCoord {
  return {
    x: wrapIndex(coord.x, WORLD_CHUNKS_PER_AXIS),
    y: wrapIndex(coord.y, WORLD_CHUNKS_PER_AXIS),
    z: wrapIndex(coord.z, WORLD_CHUNKS_PER_AXIS),
  };
}

export function shortestWrappedDelta(a: Vector3, b: Vector3): Vector3 {
  return new Vector3(
    shortestAxisDelta(a.x, b.x),
    shortestAxisDelta(a.y, b.y),
    shortestAxisDelta(a.z, b.z),
  );
}

export function shortestWrappedDistance(a: Vector3, b: Vector3): number {
  return shortestWrappedDelta(a, b).length();
}

export function shortestWrappedDistanceSq(a: Vector3, b: Vector3): number {
  return shortestWrappedDelta(a, b).lengthSq();
}

export function wrappedChunkDelta(a: ChunkCoord, b: ChunkCoord): ChunkCoord {
  return {
    x: shortestIndexDelta(a.x, b.x, WORLD_CHUNKS_PER_AXIS),
    y: shortestIndexDelta(a.y, b.y, WORLD_CHUNKS_PER_AXIS),
    z: shortestIndexDelta(a.z, b.z, WORLD_CHUNKS_PER_AXIS),
  };
}

export function wrappedChunkDistance(a: ChunkCoord, b: ChunkCoord): number {
  const delta = wrappedChunkDelta(a, b);
  return Math.max(Math.abs(delta.x), Math.abs(delta.y), Math.abs(delta.z));
}

function wrapIndex(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function shortestAxisDelta(from: number, to: number): number {
  let delta = to - from;
  if (delta > WORLD_SIZE * 0.5) {
    delta -= WORLD_SIZE;
  } else if (delta < -WORLD_SIZE * 0.5) {
    delta += WORLD_SIZE;
  }
  return delta;
}

function shortestIndexDelta(from: number, to: number, size: number): number {
  let delta = to - from;
  if (delta > size * 0.5) {
    delta -= size;
  } else if (delta < -size * 0.5) {
    delta += size;
  }
  return delta;
}
