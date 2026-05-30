import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { WorldFieldSample } from '../types';
import { hashInts } from '../utils/hash';
import { worldDangerLevel } from '../utils/depth';
import { sampleWorldSkeleton } from './worldSkeleton';

const _gradientStep = GAME_CONFIG.world.meshStepNear;

export function sampleWorldField(position: Vector3, seed: number = GAME_CONFIG.seed): WorldFieldSample {
  const skeleton = sampleWorldSkeleton(position, seed);
  const noise = valueNoise(position, seed);
  const radius = skeleton.radius * (0.86 + noise * 0.28);
  const clearance = radius - skeleton.distance;
  const fieldBias = Math.max(0, Math.min(1, (clearance + radius) / (radius * 2)));
  const density = Math.max(0, Math.min(1, 1 - fieldBias));
  const danger = worldDangerLevel(position.y);
  return {
    density,
    clearance,
    danger,
    spawnWeight: Math.max(0, fieldBias - 0.25),
    profileId: GAME_CONFIG.world.generationProfile,
    avoidance: new Vector3(),
    fieldBias,
  };
}

export function sampleAvoidanceVector(position: Vector3, seed: number = GAME_CONFIG.seed): Vector3 {
  const cx = sampleClearance(position, seed);
  const px = sampleClearance(new Vector3(position.x + _gradientStep, position.y, position.z), seed);
  const nx = sampleClearance(new Vector3(position.x - _gradientStep, position.y, position.z), seed);
  const py = sampleClearance(new Vector3(position.x, position.y + _gradientStep, position.z), seed);
  const ny = sampleClearance(new Vector3(position.x, position.y - _gradientStep, position.z), seed);
  const pz = sampleClearance(new Vector3(position.x, position.y, position.z + _gradientStep), seed);
  const nz = sampleClearance(new Vector3(position.x, position.y, position.z - _gradientStep), seed);
  const gradient = new Vector3(px - nx, py - ny, pz - nz);
  if (gradient.lengthSq() <= 0.000001 || cx > GAME_CONFIG.ship.radius * 8) {
    return new Vector3();
  }
  return gradient.normalize().multiplyScalar(1 - Math.max(0, cx) / (GAME_CONFIG.ship.radius * 8));
}

function sampleClearance(position: Vector3, seed: number): number {
  const skeleton = sampleWorldSkeleton(position, seed);
  const noise = valueNoise(position, seed);
  return skeleton.radius * (0.86 + noise * 0.28) - skeleton.distance;
}

function valueNoise(position: Vector3, seed: number): number {
  const scale = GAME_CONFIG.world.meshStepFar;
  const x = Math.floor(position.x / scale);
  const y = Math.floor(position.y / scale);
  const z = Math.floor(position.z / scale);
  return hashInts(seed, 91, x, y, z) / 0xffffffff;
}
