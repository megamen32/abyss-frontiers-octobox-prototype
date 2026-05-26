import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { ChunkData, Mine, Obstacle, PlayerState } from '../types';
import { worldToChunkCoord } from '../utils/chunk';
import { depthBelowSurface } from '../utils/depth';
import { travelDirection } from './player';

const _sep = new Vector3();
const _anchor = new Vector3();
const _wander = new Vector3();
const _force = new Vector3();

const MINE_BOIDS_SEP_RADIUS = 8;
const MINE_BOIDS_SEP_WEIGHT = 3.0;
const MINE_BOIDS_ANCHOR_WEIGHT = 0.4;
const MINE_BOIDS_WANDER_WEIGHT = 0.6;
const MINE_BOIDS_ANCHOR_RADIUS = 18;
const MINE_BOIDS_MAX_SPEED = 4.0;
const MINE_BOIDS_DRAG = 0.7;

function chunkDepth(chunk: ChunkData): number {
  return depthBelowSurface((chunk.coord.y + 0.5) * GAME_CONFIG.world.chunkSize);
}

function updateMineIdleBoids(mine: Mine, allMines: Mine[], dt: number): void {
  if (!mine.anchorPosition) {
    mine.anchorPosition = mine.position.clone();
  }

  _sep.set(0, 0, 0);
  for (const other of allMines) {
    if (other === mine || other.state !== 'idle') continue;
    const dx = mine.position.x - other.position.x;
    const dy = mine.position.y - other.position.y;
    const dz = mine.position.z - other.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > 0.001 && dist < MINE_BOIDS_SEP_RADIUS) {
      const strength = 1 - dist / MINE_BOIDS_SEP_RADIUS;
      _sep.x += (dx / dist) * strength;
      _sep.y += (dy / dist) * strength;
      _sep.z += (dz / dist) * strength;
    }
  }

  _anchor.copy(mine.anchorPosition).sub(mine.position);
  const anchorDist = _anchor.length();
  if (anchorDist > 0.001) {
    const pull = Math.max(0, anchorDist - MINE_BOIDS_ANCHOR_RADIUS) / MINE_BOIDS_ANCHOR_RADIUS;
    _anchor.multiplyScalar(pull / anchorDist);
  } else {
    _anchor.set(0, 0, 0);
  }

  const t = performance.now() * 0.001;
  const seed = mine.id.length * 17 + mine.position.x * 0.1;
  _wander.set(
    Math.sin(t * 0.7 + seed) * 0.5,
    Math.cos(t * 0.5 + seed * 1.3) * 0.3,
    Math.sin(t * 0.9 + seed * 0.7) * 0.5,
  );

  _force.set(0, 0, 0);
  _force.addScaledVector(_sep, MINE_BOIDS_SEP_WEIGHT);
  _force.addScaledVector(_anchor, MINE_BOIDS_ANCHOR_WEIGHT);
  _force.addScaledVector(_wander, MINE_BOIDS_WANDER_WEIGHT);

  mine.velocity.addScaledVector(_force, dt);
  mine.velocity.multiplyScalar(1 - MINE_BOIDS_DRAG * dt);

  const spd = mine.velocity.length();
  if (spd > MINE_BOIDS_MAX_SPEED) {
    mine.velocity.multiplyScalar(MINE_BOIDS_MAX_SPEED / spd);
  }

  mine.position.addScaledVector(mine.velocity, dt);
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
      const aimTarget = player.position
        .clone()
        .add(player.velocity.clone().multiplyScalar(GAME_CONFIG.mines.leadTime));
      const direction = aimTarget.sub(mine.position);
      if (direction.lengthSq() > 0.0001) {
        mine.velocity.addScaledVector(direction.normalize(), GAME_CONFIG.mines.rocketAcceleration * dt);
      }
      if (mine.velocity.length() > GAME_CONFIG.mines.rocketMaxSpeed) {
        mine.velocity.setLength(GAME_CONFIG.mines.rocketMaxSpeed);
      }
      mine.position.addScaledVector(mine.velocity, dt);

      const distance = mine.position.distanceTo(player.position);
      if (distance <= GAME_CONFIG.mines.rocketToLaunchedDistance) {
        const burstDir = player.position.clone().sub(mine.position).normalize();
        mine.velocity.addScaledVector(burstDir, mine.speed);
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
      updateMineIdleBoids(mine, chunk.mines, dt);

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
