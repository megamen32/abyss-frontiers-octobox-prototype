import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { ChunkData, Mine, Obstacle, PlayerState } from '../types';
import { worldToChunkCoord } from '../utils/chunk';
import { travelDirection } from './player';

export function updateMinesInChunk(chunk: ChunkData, player: PlayerState, dt: number): void {
  for (const mine of chunk.mines) {
    if (mine.state === 'dead') {
      continue;
    }

    if (mine.state === 'idle') {
      const distance = mine.position.distanceTo(player.position);
      if (distance <= mine.triggerRadius) {
        mine.targetPosition = player.position
          .clone()
          .add(player.velocity.clone().multiplyScalar(GAME_CONFIG.mines.leadTime));
        mine.telegraphTimer = GAME_CONFIG.mines.telegraphDuration;
        mine.velocity.set(0, 0, 0);
        mine.state = 'targeting';
      }
      continue;
    }

    if (mine.state === 'targeting') {
      mine.telegraphTimer = Math.max(0, mine.telegraphTimer - dt);
      if (mine.telegraphTimer > 0) {
        continue;
      }

      const target = mine.targetPosition?.clone() ?? player.position.clone();
      const direction = target.sub(mine.position);
      if (direction.lengthSq() <= 0.0001) {
        direction.copy(travelDirection(player));
      }
      mine.velocity.copy(direction.normalize().multiplyScalar(mine.speed));
      mine.state = 'launched';
      mine.targetPosition = null;
      continue;
    }

    mine.position.addScaledVector(mine.velocity, dt);

    const mineChunk = worldToChunkCoord(mine.position);
    if (
      mineChunk.x !== chunk.coord.x ||
      mineChunk.y !== chunk.coord.y ||
      mineChunk.z !== chunk.coord.z
    ) {
      mine.state = 'dead';
      continue;
    }

    if (chunk.obstacles.some((obstacle) => collidesWithObstacle(mine.position, mine.radius, obstacle))) {
      mine.state = 'dead';
    }
  }
}

export function mineHitsPlayer(mine: Mine, player: PlayerState): boolean {
  return mine.state !== 'dead' && mine.position.distanceTo(player.position) <= player.radius + mine.radius;
}

export function collidesWithObstacle(position: Vector3, radius: number, obstacle: Obstacle): boolean {
  if (obstacle.type === 'sphere' && obstacle.radius) {
    return position.distanceTo(obstacle.position) <= radius + obstacle.radius;
  }

  const size = obstacle.size ?? new Vector3(1, 1, 1);
  const halfSize = size.clone().multiplyScalar(0.5);
  const min = obstacle.position.clone().sub(halfSize);
  const max = obstacle.position.clone().add(halfSize);
  const closest = new Vector3(
    Math.max(min.x, Math.min(position.x, max.x)),
    Math.max(min.y, Math.min(position.y, max.y)),
    Math.max(min.z, Math.min(position.z, max.z)),
  );
  return closest.distanceTo(position) <= radius;
}
