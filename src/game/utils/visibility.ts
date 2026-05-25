import { GAME_CONFIG } from '../config';

export function fogVisibilityDistance(): number {
  const { fogDensity, fogVisibilityThreshold } = GAME_CONFIG.visuals;
  if (fogDensity <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.sqrt(-Math.log(fogVisibilityThreshold)) / fogDensity;
}

export function fogChunkRenderRadius(): number {
  return Math.max(1, Math.ceil(fogVisibilityDistance() / GAME_CONFIG.world.chunkSize));
}

export function chunkGenerationRadius(): number {
  return fogChunkRenderRadius() + GAME_CONFIG.world.preloadRadiusPadding;
}

// Chunks stay loaded until they exceed this radius. The extra buffer prevents
// evicting chunks the moment the player crosses a boundary, which would leave
// the renderer empty while new chunks are still being generated.
export function chunkEvictionRadius(): number {
  return chunkGenerationRadius() + GAME_CONFIG.world.evictionRadiusPadding;
}
