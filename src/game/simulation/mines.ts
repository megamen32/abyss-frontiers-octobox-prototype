import { MathUtils, Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { ChunkData, Mine, Obstacle, PlayerState } from '../types';
import { worldToChunkCoord } from '../utils/chunk';
import { depthBelowSurface } from '../utils/depth';

const _toPlayer = new Vector3();
const _relativeVelocity = new Vector3();

const MINE_LEAD_TIME_MIN = 0.15;
const MINE_LEAD_TIME_MAX = 2.5;
const MINE_MIN_CLOSING_SPEED = 0.001;

function chunkDepth(chunk: ChunkData): number {
  return depthBelowSurface((chunk.coord.y + 0.5) * GAME_CONFIG.world.chunkSize);
}

function mineLeadTime(mine: Mine, player: PlayerState): number {
  _toPlayer.copy(player.position).sub(mine.position);
  const distance = _toPlayer.length();
  if (distance <= 0.0001) {
    return MINE_LEAD_TIME_MIN;
  }

  _toPlayer.multiplyScalar(1 / distance);
  _relativeVelocity.copy(player.velocity).sub(mine.velocity);
  const closingSpeed = _relativeVelocity.dot(_toPlayer);
  return MathUtils.clamp(
    distance / Math.max(closingSpeed, MINE_MIN_CLOSING_SPEED),
    MINE_LEAD_TIME_MIN,
    MINE_LEAD_TIME_MAX,
  );
}

function mineAimTarget(mine: Mine, player: PlayerState): Vector3 {
  return player.position.clone().addScaledVector(player.velocity, mineLeadTime(mine, player));
}

export function updateMinesInChunk(chunk: ChunkData, player: PlayerState, dt: number): void {
  const isDeep = chunkDepth(chunk) >= GAME_CONFIG.mines.deepMineDepth;

  for (const mine of chunk.mines) {
    if (mine.state === 'dead') {
      continue;
    }

    if (mine.state === 'idle' && isDeep) {
      mine.state = 'rocket';
      mine.targetPosition = null;
    }

    if (mine.state === 'rocket') {
      mine.targetPosition = mineAimTarget(mine, player);

      const distance = mine.position.distanceTo(player.position);
      if (distance <= GAME_CONFIG.mines.rocketToLaunchedDistance) {
        mine.state = 'launched';
      }

      const mineChunk = worldToChunkCoord(mine.position);
      if (
        mineChunk.x !== chunk.coord.x ||
        mineChunk.y !== chunk.coord.y ||
        mineChunk.z !== chunk.coord.z
      ) {
        mine.state = 'dead';
      }
      continue;
    }

    if (mine.state === 'idle') {
      const distance = mine.position.distanceTo(player.position);
      if (distance <= mine.triggerRadius) {
        mine.targetPosition = mineAimTarget(mine, player);
        mine.telegraphTimer = GAME_CONFIG.mines.telegraphDuration;
        mine.state = 'targeting';
      }
      continue;
    }

    if (mine.state === 'targeting') {
      mine.telegraphTimer = Math.max(0, mine.telegraphTimer - dt);
      mine.targetPosition = mineAimTarget(mine, player);
      if (mine.telegraphTimer <= 0) {
        mine.state = 'launched';
        mine.targetPosition = null;
      }
      continue;
    }

    mine.targetPosition = mineAimTarget(mine, player);

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
