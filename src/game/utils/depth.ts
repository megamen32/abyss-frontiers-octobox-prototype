import { MathUtils } from 'three';
import { GAME_CONFIG } from '../config';
import { WORLD_SIZE, wrapScalar } from './worldTopology';

export interface DepthBand {
  label: string;
  accent: string;
}

const DEPTH_BANDS: Array<{ min: number; band: DepthBand }> = [
  { min: 0.8, band: { label: 'ABYSSAL MAW', accent: '#ff8a5b' } },
  { min: 0.55, band: { label: 'PRESSURE TRENCH', accent: '#ffb36b' } },
  { min: 0.3, band: { label: 'TWILIGHT REACH', accent: '#6fd1ff' } },
  { min: 0, band: { label: 'SHALLOW GLOW', accent: '#9fffe0' } },
];

export function depthBelowSurface(positionY: number): number {
  const y = wrapScalar(positionY);
  let delta = GAME_CONFIG.world.spawn.y - y;
  if (delta > WORLD_SIZE * 0.5) {
    delta -= WORLD_SIZE;
  } else if (delta < -WORLD_SIZE * 0.5) {
    delta += WORLD_SIZE;
  }
  return Math.max(0, delta);
}

export function depthProgress(depth: number, rampDistance: number): number {
  return MathUtils.clamp(depth / rampDistance, 0, 1);
}

export function worldDangerLevel(positionY: number): number {
  return depthProgress(depthBelowSurface(positionY), GAME_CONFIG.world.depthDifficultyRamp);
}

export function bandForDangerLevel(level: number): DepthBand {
  return DEPTH_BANDS.find((entry) => level >= entry.min)?.band ?? DEPTH_BANDS[DEPTH_BANDS.length - 1].band;
}
