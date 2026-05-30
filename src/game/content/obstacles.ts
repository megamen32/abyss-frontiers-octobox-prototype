import { MathUtils, Vector3 } from 'three';
import type { LeafCell, Obstacle, Portal } from '../types';
import { GAME_CONFIG } from '../config';
import { aabbCenter, aabbSize, intersectsAabb } from '../utils/chunk';
import { SeededRandom } from '../utils/rng';
import { worldDangerLevel } from '../utils/depth';

export function placeObstacles(cells: LeafCell[], portals: Portal[], rng: SeededRandom): Obstacle[] {
  const isTunnelField = GAME_CONFIG.world.generationProfile === ('tunnel_field' as string);
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

    const depthDanger = worldDangerLevel(aabbCenter(cell.bounds).y);
    if (depthDanger <= 0) {
      continue;
    }
    const densityBonus = depthDanger * GAME_CONFIG.world.depthObstacleDensityBonus;
    const shouldFill =
      isTunnelField
        ? cell.fieldBias <= GAME_CONFIG.world.tunnelWallThreshold
          || (
            cell.fieldBias < GAME_CONFIG.world.tunnelCoreThreshold
            && rng.next() < Math.min(0.96, 0.78 + densityBonus)
          )
          || (
            cell.fieldBias >= GAME_CONFIG.world.tunnelCoreThreshold
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
      damage: minSize > 8 ? GAME_CONFIG.collision.largeObstacleDamage : GAME_CONFIG.collision.obstacleDamage,
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
