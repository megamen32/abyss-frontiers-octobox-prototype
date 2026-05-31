import { UNIFIED_WORLD_BOIDS_CONFIG } from '../../boids/BoidsConfig';
import type { BoidsConfig } from '../../boids/BoidsTypes';

const STORAGE_KEY = 'abyss3.boids.maxBoids';
const MIN_ADAPTIVE_BOIDS = 300;

interface RuntimeBoidsDeviceProfile {
  maxTouchPoints?: number;
  coarsePointer?: boolean;
  viewportWidth?: number;
  hasWebGPU?: boolean;
  forceCPUQuery?: boolean;
}

export function createRuntimeBoidsConfig(profile: RuntimeBoidsDeviceProfile = detectRuntimeBoidsDeviceProfile()): BoidsConfig {
  const mobile = (profile.maxTouchPoints ?? 0) > 0 || profile.coarsePointer === true || (profile.viewportWidth ?? 1024) < 820;
  const forceCPU = profile.forceCPUQuery === true || profile.hasWebGPU !== true;
  const defaultMaxBoids = mobile ? 1000 : forceCPU ? 2000 : UNIFIED_WORLD_BOIDS_CONFIG.maxBoids;
  const storedMaxBoids = readStoredBoidsBudget(defaultMaxBoids);
  const maxBoids = Math.max(MIN_ADAPTIVE_BOIDS, Math.min(defaultMaxBoids, storedMaxBoids));
  const initialBoids = Math.min(maxBoids, mobile ? 1000 : forceCPU ? 2000 : UNIFIED_WORLD_BOIDS_CONFIG.initialBoids);
  const cpuUpdateStride = mobile ? 2 : forceCPU ? 3 : 2;
  return {
    ...UNIFIED_WORLD_BOIDS_CONFIG,
    maxBoids,
    initialBoids,
    cpuUpdateStride,
    fallback: { cpuMaxBoids: maxBoids },
    forceCPU,
  };
}

export function reduceStoredBoidsBudget(currentMaxBoids: number, ratio = 0.8): number {
  const next = Math.max(MIN_ADAPTIVE_BOIDS, Math.floor(currentMaxBoids * ratio));
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(next));
  } catch {
    return next;
  }
  return next;
}

function readStoredBoidsBudget(fallback: number): number {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function detectRuntimeBoidsDeviceProfile(): RuntimeBoidsDeviceProfile {
  const nav = globalThis.navigator;
  return {
    maxTouchPoints: nav?.maxTouchPoints,
    coarsePointer: typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia('(pointer: coarse)').matches : false,
    viewportWidth: typeof globalThis.innerWidth === 'number' ? globalThis.innerWidth : undefined,
    hasWebGPU: nav ? 'gpu' in nav : false,
    forceCPUQuery: typeof globalThis.location === 'object'
      ? new URLSearchParams(globalThis.location.search).has('cpu')
      : false,
  };
}
