import { describe, expect, it } from 'vitest';
import { DEFAULT_BOIDS_CONFIG } from '../src/boids/BoidsConfig';
import { initGPUResources } from '../src/boids/BoidsCompute';

describe('boids WebGPU feature gate', () => {
  it('returns null when WebGPU is unavailable', async () => {
    expect('gpu' in navigator).toBe(false);
    await expect(initGPUResources(DEFAULT_BOIDS_CONFIG)).resolves.toBeNull();
  });
});
