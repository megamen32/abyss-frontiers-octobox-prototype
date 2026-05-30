import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { AABB } from '../types';
import { sampleWorldField } from './worldField';

export interface WorldFieldCache {
  bounds: AABB;
  step: number;
  nx: number;
  ny: number;
  nz: number;
  clearance: Float32Array;
  danger: Float32Array;
}

export interface CachedFieldSample {
  clearance: number;
  danger: number;
  avoidance: Vector3;
}

export function buildWorldFieldCache(bounds: AABB, seed: number, step: number = GAME_CONFIG.world.meshStepFar): WorldFieldCache {
  const nx = Math.floor((bounds.max.x - bounds.min.x) / step) + 1;
  const ny = Math.floor((bounds.max.y - bounds.min.y) / step) + 1;
  const nz = Math.floor((bounds.max.z - bounds.min.z) / step) + 1;
  const clearance = new Float32Array(nx * ny * nz);
  const danger = new Float32Array(nx * ny * nz);
  const position = new Vector3();
  for (let x = 0; x < nx; x += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let z = 0; z < nz; z += 1) {
        position.set(
          Math.min(bounds.max.x, bounds.min.x + x * step),
          Math.min(bounds.max.y, bounds.min.y + y * step),
          Math.min(bounds.max.z, bounds.min.z + z * step),
        );
        const sample = sampleWorldField(position, seed);
        const idx = cacheIndex(x, y, z, ny, nz);
        clearance[idx] = sample.clearance;
        danger[idx] = sample.danger;
      }
    }
  }
  return { bounds, step, nx, ny, nz, clearance, danger };
}

export function sampleCachedWorldField(cache: WorldFieldCache, position: Vector3): CachedFieldSample {
  const x = clampIndex(Math.round((position.x - cache.bounds.min.x) / cache.step), cache.nx);
  const y = clampIndex(Math.round((position.y - cache.bounds.min.y) / cache.step), cache.ny);
  const z = clampIndex(Math.round((position.z - cache.bounds.min.z) / cache.step), cache.nz);
  const c = clearanceAt(cache, x, y, z);
  const gx = clearanceAt(cache, x + 1, y, z) - clearanceAt(cache, x - 1, y, z);
  const gy = clearanceAt(cache, x, y + 1, z) - clearanceAt(cache, x, y - 1, z);
  const gz = clearanceAt(cache, x, y, z + 1) - clearanceAt(cache, x, y, z - 1);
  const avoidance = new Vector3(gx, gy, gz);
  if (avoidance.lengthSq() > 0.000001 && c < GAME_CONFIG.ship.radius * 8) {
    avoidance.normalize().multiplyScalar(1 - Math.max(0, c) / (GAME_CONFIG.ship.radius * 8));
  } else {
    avoidance.set(0, 0, 0);
  }
  return {
    clearance: c,
    danger: cache.danger[cacheIndex(x, y, z, cache.ny, cache.nz)],
    avoidance,
  };
}

function clearanceAt(cache: WorldFieldCache, x: number, y: number, z: number): number {
  return cache.clearance[cacheIndex(
    clampIndex(x, cache.nx),
    clampIndex(y, cache.ny),
    clampIndex(z, cache.nz),
    cache.ny,
    cache.nz,
  )];
}

function cacheIndex(x: number, y: number, z: number, ny: number, nz: number): number {
  return (x * ny + y) * nz + z;
}

function clampIndex(value: number, size: number): number {
  return Math.max(0, Math.min(size - 1, value));
}
