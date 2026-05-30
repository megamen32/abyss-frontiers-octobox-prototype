import { describe, expect, it } from 'vitest';
import { UNIFIED_WORLD_BOIDS_CONFIG } from '../src/boids/BoidsConfig';
import { createRuntimeBoidsConfig } from '../src/game/simulation/runtimeBoidsConfig';

describe('runtime boids config', () => {
  it('keeps recent mobile WebKit-class devices at the 1k boid target', () => {
    const config = createRuntimeBoidsConfig({
      maxTouchPoints: 5,
      coarsePointer: true,
      viewportWidth: 390,
      hasWebGPU: true,
    });
    expect(config.maxBoids).toBe(1000);
    expect(config.initialBoids).toBe(1000);
    expect(config.fallback.cpuMaxBoids).toBe(1000);
    expect(config.cpuUpdateStride).toBe(2);
    expect(config.forceCPU).toBe(false);
  });

  it('uses the 6k desktop target only when WebGPU is available', () => {
    const config = createRuntimeBoidsConfig({
      viewportWidth: 1440,
      hasWebGPU: true,
    });
    expect(config.maxBoids).toBe(UNIFIED_WORLD_BOIDS_CONFIG.maxBoids);
    expect(config.initialBoids).toBe(UNIFIED_WORLD_BOIDS_CONFIG.initialBoids);
    expect(config.cpuUpdateStride).toBe(2);
    expect(config.forceCPU).toBe(false);
  });

  it('caps desktop CPU fallback below the 6k GPU target', () => {
    const config = createRuntimeBoidsConfig({
      viewportWidth: 1440,
      hasWebGPU: false,
    });
    expect(config.maxBoids).toBe(2000);
    expect(config.initialBoids).toBe(2000);
    expect(config.fallback.cpuMaxBoids).toBe(2000);
    expect(config.cpuUpdateStride).toBe(3);
    expect(config.forceCPU).toBe(true);
  });

  it('keeps the explicit cpu query as a WebGPU kill switch', () => {
    const config = createRuntimeBoidsConfig({
      viewportWidth: 1440,
      hasWebGPU: true,
      forceCPUQuery: true,
    });
    expect(config.maxBoids).toBe(2000);
    expect(config.forceCPU).toBe(true);
  });
});
