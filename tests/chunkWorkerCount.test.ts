import { describe, expect, it } from 'vitest';
import { resolveChunkBuildWorkerCount } from '../src/game/simulation/chunkManager';

describe('chunk worker count selection', () => {
  it('caps desktop workers at four while leaving CPU headroom', () => {
    expect(resolveChunkBuildWorkerCount({ hardwareConcurrency: 10, viewportWidth: 1280 })).toBe(4);
    expect(resolveChunkBuildWorkerCount({ hardwareConcurrency: 4, viewportWidth: 1280 })).toBe(2);
    expect(resolveChunkBuildWorkerCount({ hardwareConcurrency: 2, viewportWidth: 1280 })).toBe(1);
  });

  it('keeps mobile worker counts conservative', () => {
    expect(resolveChunkBuildWorkerCount({ hardwareConcurrency: 8, maxTouchPoints: 5, viewportWidth: 390 })).toBe(2);
    expect(resolveChunkBuildWorkerCount({ hardwareConcurrency: 1, coarsePointer: true, viewportWidth: 720 })).toBe(1);
    expect(resolveChunkBuildWorkerCount({ hardwareConcurrency: 8, viewportWidth: 719 })).toBe(2);
  });

  it('honors the configured maximum worker cap', () => {
    expect(resolveChunkBuildWorkerCount({ hardwareConcurrency: 10, viewportWidth: 1280, configuredMax: 3 })).toBe(3);
    expect(resolveChunkBuildWorkerCount({ hardwareConcurrency: 10, maxTouchPoints: 1, configuredMax: 1 })).toBe(1);
  });
});
