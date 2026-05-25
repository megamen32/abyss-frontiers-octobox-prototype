import { Box3, Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { LeafCell, Obstacle, Portal } from '../types';
import { aabbCenter, aabbSize, clamp, intersectsAabb } from '../utils/chunk';
import { SeededRandom } from '../utils/rng';

export function placeObstacles(cells: LeafCell[], portals: Portal[], rng: SeededRandom): Obstacle[] {
  const obstacles: Obstacle[] = [];
  const max = GAME_CONFIG.world.maxObstaclesPerChunk;
  const spawn = new Vector3(GAME_CONFIG.world.spawn.x, GAME_CONFIG.world.spawn.y, GAME_CONFIG.world.spawn.z);

  for (const cell of cells) {
    if (obstacles.length >= max || cell.kind === 'free') {
      continue;
    }
    const size = aabbSize(cell.bounds);
    const minSize = Math.min(size.x, size.y, size.z);
    if (minSize < 2.2 || portals.some((portal) => intersectsAabb(cell.bounds, portal.bounds))) {
      continue;
    }

    const density = minSize > 18 ? 2 : 1;
    for (let index = 0; index < density && obstacles.length < max; index += 1) {
      if (rng.next() > obstacleProbability(minSize)) {
        continue;
      }

      const type = rng.next() > 0.48 ? 'sphere' : 'box';
      const boundsBox = new Box3(cell.bounds.min.clone(), cell.bounds.max.clone()).expandByScalar(-0.8);
      const position = new Vector3(
        rng.range(boundsBox.min.x, boundsBox.max.x),
        rng.range(boundsBox.min.y, boundsBox.max.y),
        rng.range(boundsBox.min.z, boundsBox.max.z),
      );
      if (position.distanceTo(spawn) < 12) {
        continue;
      }

      const axis = new Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
      const motion = rng.next() < 0.1 ? 'linear_drift' : rng.next() < 0.24 ? 'slow_rotate' : 'static';
      const id = `${cell.id}:obs:${obstacles.length}`;

      if (type === 'sphere') {
        const radius = sampleSphereRadius(minSize, rng);
        obstacles.push({
          id,
          type,
          motion,
          bounds: cell.bounds,
          position,
          basePosition: position.clone(),
          radius,
          damage: radius > 5 ? 2 : GAME_CONFIG.collision.obstacleDamage,
          cellId: cell.id,
          axis,
          angularSpeed: rng.range(0.16, 0.7),
          driftAmplitude: clamp(minSize * 0.14, 0, 4.5),
          phase: rng.range(0, Math.PI * 2),
        });
      } else {
        const sizeVector = sampleBoxSize(size, minSize, rng);
        obstacles.push({
          id,
          type,
          motion,
          bounds: cell.bounds,
          position,
          basePosition: aabbCenter(cell.bounds),
          size: sizeVector,
          damage: sizeVector.length() > 12 ? 2 : GAME_CONFIG.collision.obstacleDamage,
          cellId: cell.id,
          axis,
          angularSpeed: rng.range(0.16, 0.55),
          driftAmplitude: clamp(minSize * 0.1, 0, 3.5),
          phase: rng.range(0, Math.PI * 2),
        });
      }
    }
  }

  return obstacles;
}

function obstacleProbability(minSize: number): number {
  if (minSize < 4) {
    return 0.25;
  }
  if (minSize < 9) {
    return 0.46;
  }
  return 0.66;
}

function sampleSphereRadius(minSize: number, rng: SeededRandom): number {
  const tier = rng.next();
  if (tier < 0.38) {
    return clamp(minSize * rng.range(0.12, 0.2), 0.45, 1.25);
  }
  if (tier < 0.68) {
    return clamp(minSize * rng.range(0.2, 0.35), 1.2, 4.8);
  }
  return clamp(minSize * rng.range(0.4, 0.86), 4.5, 15);
}

function sampleBoxSize(size: Vector3, minSize: number, rng: SeededRandom): Vector3 {
  const thinChance = rng.next();
  if (thinChance < 0.3) {
    return new Vector3(
      clamp(size.x * rng.range(0.08, 0.22), 0.5, size.x - 1),
      clamp(size.y * rng.range(0.08, 0.22), 0.5, size.y - 1),
      clamp(size.z * rng.range(0.08, 0.22), 0.5, size.z - 1),
    );
  }
  if (thinChance < 0.74) {
    return new Vector3(
      clamp(size.x * rng.range(0.22, 0.45), 1, size.x - 1),
      clamp(size.y * rng.range(0.22, 0.45), 1, size.y - 1),
      clamp(size.z * rng.range(0.22, 0.45), 1, size.z - 1),
    );
  }
  return new Vector3(
    clamp(size.x * rng.range(0.5, 0.9), 3.5, Math.max(3.5, size.x - 0.5)),
    clamp(size.y * rng.range(0.5, 0.9), 3.5, Math.max(3.5, size.y - 0.5)),
    clamp(size.z * rng.range(0.5, 0.9), 3.5, Math.max(3.5, size.z - 0.5)),
  ).clampScalar(0.5, Math.max(0.5, minSize - 0.3));
}
