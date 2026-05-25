import { MathUtils, Vector3 } from 'three';
import type { LeafCell, Obstacle, Portal } from '../types';
import { GAME_CONFIG } from '../config';
import { aabbCenter, aabbSize, intersectsAabb } from '../utils/chunk';
import { SeededRandom } from '../utils/rng';
import { worldDangerLevel } from '../utils/depth';

export function placeObstacles(cells: LeafCell[], portals: Portal[], rng: SeededRandom): Obstacle[] {
  const obstacles: Obstacle[] = [];
  const chunkDanger = cells.reduce((maxDanger, cell) => {
    const center = aabbCenter(cell.bounds);
    return Math.max(maxDanger, worldDangerLevel(center.y));
  }, 0);
  const maxObstacles = Math.round(
    GAME_CONFIG.world.maxObstaclesPerChunk
      * MathUtils.lerp(1, GAME_CONFIG.world.depthObstacleCapMultiplier, chunkDanger),
  );

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
    const depthDanger = worldDangerLevel(aabbCenter(cell.bounds).y);
    const densityBonus = depthDanger * GAME_CONFIG.world.depthObstacleDensityBonus;
    const shouldFill =
      caveMode
        ? cell.caveBias <= GAME_CONFIG.world.caveWallBias
          || (
            cell.caveBias < GAME_CONFIG.world.caveCoreBias
            && rng.next() < Math.min(0.96, 0.78 + densityBonus)
          )
          || (
            cell.caveBias >= GAME_CONFIG.world.caveCoreBias
            && rng.next() < densityBonus * 0.2
          )
        : rng.next() < Math.min(0.9, 0.55 + densityBonus);

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

    if (obstacles.length >= maxObstacles) {
      break;
    }
  }

  return obstacles;
}
