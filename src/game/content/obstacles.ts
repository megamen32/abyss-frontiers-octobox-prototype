import { Vector3 } from 'three';
import type { LeafCell, Obstacle, Portal } from '../types';
import { GAME_CONFIG } from '../config';
import { aabbCenter, aabbSize, intersectsAabb } from '../utils/chunk';
import { SeededRandom } from '../utils/rng';

export function placeObstacles(cells: LeafCell[], portals: Portal[], rng: SeededRandom): Obstacle[] {
  const obstacles: Obstacle[] = [];

  for (const cell of cells) {
    if (cell.kind === 'free') {
      continue;
    }
    if (portals.some((portal) => intersectsAabb(cell.bounds, portal.bounds))) {
      continue;
    }

    const size = aabbSize(cell.bounds);
    const minSize = Math.min(size.x, size.y, size.z);
    if (minSize < 1.5) {
      continue;
    }

    const caveMode = GAME_CONFIG.world.generationMode === 'cave';
    const shouldFill =
      caveMode
        ? cell.caveBias <= GAME_CONFIG.world.caveWallBias || (cell.caveBias < GAME_CONFIG.world.caveCoreBias && rng.next() < 0.78)
        : rng.next() < 0.55;

    if (!shouldFill) {
      continue;
    }

    obstacles.push({
      id: `${cell.id}:obs`,
      type: 'box',
      motion: 'static',
      bounds: cell.bounds,
      position: aabbCenter(cell.bounds),
      basePosition: aabbCenter(cell.bounds),
      size,
      damage: minSize > 8 ? 2 : GAME_CONFIG.collision.obstacleDamage,
      cellId: cell.id,
      axis: new Vector3(0, 1, 0),
      angularSpeed: 0,
      driftAmplitude: 0,
      phase: 0,
    });

    if (obstacles.length >= GAME_CONFIG.world.maxObstaclesPerChunk) {
      break;
    }
  }

  return obstacles;
}
