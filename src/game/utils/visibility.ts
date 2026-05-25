import { GAME_CONFIG } from '../config';

// Opacity at which a fogged point is considered invisible. Used to compute fogDensity.
const FOG_THRESHOLD = 0.03;

/**
 * Computes the FogExp2 density so that objects at the chunk-generation boundary
 * are invisible. Uses (fogRenderRadiusChunks - 0.5) as the effective hide distance
 * to give a half-chunk safety margin — the last rendered chunk is fully invisible
 * before its far face is reached.
 *
 * Three.js FogExp2 uses: opacity = exp(-density² × dist²)
 * Solving for density: density = sqrt(-log(threshold)) / hideDistance
 */
export function fogDensity(): number {
  const hideDistance = (GAME_CONFIG.visuals.fogRenderRadiusChunks - 0.5) * GAME_CONFIG.world.chunkSize;
  return Math.sqrt(-Math.log(FOG_THRESHOLD)) / hideDistance;
}

export function fogVisibilityDistance(): number {
  return GAME_CONFIG.visuals.fogRenderRadiusChunks * GAME_CONFIG.world.chunkSize;
}

export function fogChunkRenderRadius(): number {
  return GAME_CONFIG.visuals.fogRenderRadiusChunks;
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
