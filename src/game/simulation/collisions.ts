import { Box3, MathUtils, Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { Obstacle, PlayerState } from '../types';
import { alignPlayerToDirection, travelDirection } from './player';

const SURFACE_NORMAL = new Vector3(0, -1, 0);

export function overlapsObstacle(position: Vector3, radius: number, obstacle: Obstacle): boolean {
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

export function sweptSphereHitsObstacle(
  start: Vector3,
  end: Vector3,
  radius: number,
  obstacle: Obstacle,
): boolean {
  if (overlapsObstacle(end, radius, obstacle)) {
    return true;
  }

  if (obstacle.type === 'sphere' && obstacle.radius) {
    return segmentHitsSphere(start, end, obstacle.position, radius + obstacle.radius);
  }

  const size = obstacle.size ?? new Vector3(1, 1, 1);
  const halfSize = size.clone().multiplyScalar(0.5).addScalar(radius);
  const expanded = new Box3(obstacle.position.clone().sub(halfSize), obstacle.position.clone().add(halfSize));
  return segmentHitsBox(start, end, expanded);
}

export function resolvePlayerObstacleCollision(player: PlayerState, obstacle: Obstacle): void {
  const moveDirection = player.position.clone().sub(player.previousPosition);
  const fallbackDirection =
    moveDirection.lengthSq() > 0.0001 ? moveDirection.normalize() : travelDirection(player);
  const pushDirection = moveDirection.lengthSq() > 0.0001
    ? fallbackDirection.clone().multiplyScalar(-1)
    : obstacleCollisionNormal(player.position, obstacle);

  applyCollisionResponse(player, pushDirection, {
    tangentialDamping: GAME_CONFIG.collision.obstacleTangentialDamping,
    reboundFactor: GAME_CONFIG.collision.obstacleReboundFactor,
    minReboundSpeed: GAME_CONFIG.collision.obstacleReboundMinSpeed,
    reposition: () => {
      player.position.copy(player.previousPosition).addScaledVector(pushDirection, GAME_CONFIG.collision.separationDistance);
    },
  });
}

export function resolvePlayerSurfaceCollision(player: PlayerState, surfaceY: number): void {
  applyCollisionResponse(player, SURFACE_NORMAL, {
    tangentialDamping: GAME_CONFIG.collision.surfaceTangentialDamping,
    reboundFactor: GAME_CONFIG.collision.surfaceReboundFactor,
    minReboundSpeed: GAME_CONFIG.collision.surfaceReboundMinSpeed,
    reposition: () => {
      player.position.y = surfaceY - GAME_CONFIG.collision.separationDistance;
      if (player.previousPosition.y > player.position.y) {
        player.previousPosition.y = player.position.y;
      }
    },
  });
}

function applyCollisionResponse(
  player: PlayerState,
  pushDirection: Vector3,
  options: {
    tangentialDamping: number;
    reboundFactor: number;
    minReboundSpeed: number;
    reposition: () => void;
  },
): void {
  const normal = pushDirection.clone().normalize();
  options.reposition();

  const normalSpeed = player.velocity.dot(normal);
  const tangentialVelocity = player.velocity
    .clone()
    .addScaledVector(normal, -normalSpeed)
    .multiplyScalar(options.tangentialDamping);
  const impactSpeed = Math.max(0, -normalSpeed);
  const reboundSpeed = Math.max(options.minReboundSpeed, impactSpeed * options.reboundFactor);

  player.velocity.copy(tangentialVelocity).addScaledVector(normal, reboundSpeed);
  player.velocity.clampLength(0, GAME_CONFIG.ship.maxSpeed);
  player.speed = player.velocity.length();
  alignPlayerToDirection(player, player.velocity, 1);
}

function segmentHitsSphere(start: Vector3, end: Vector3, center: Vector3, radius: number): boolean {
  const segment = end.clone().sub(start);
  const lengthSq = segment.lengthSq();
  if (lengthSq <= 0.000001) {
    return start.distanceTo(center) <= radius;
  }

  const t = MathUtils.clamp(center.clone().sub(start).dot(segment) / lengthSq, 0, 1);
  const closest = start.clone().addScaledVector(segment, t);
  return closest.distanceTo(center) <= radius;
}

function segmentHitsBox(start: Vector3, end: Vector3, box: Box3): boolean {
  const direction = end.clone().sub(start);
  let tMin = 0;
  let tMax = 1;

  for (const axis of ['x', 'y', 'z'] as const) {
    const origin = start[axis];
    const delta = direction[axis];
    const min = box.min[axis];
    const max = box.max[axis];

    if (Math.abs(delta) < 0.000001) {
      if (origin < min || origin > max) {
        return false;
      }
      continue;
    }

    const invDelta = 1 / delta;
    let t1 = (min - origin) * invDelta;
    let t2 = (max - origin) * invDelta;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) {
      return false;
    }
  }

  return tMax >= 0 && tMin <= 1;
}

function obstacleCollisionNormal(position: Vector3, obstacle: Obstacle): Vector3 {
  if (obstacle.type === 'sphere' && obstacle.radius) {
    return position.clone().sub(obstacle.position).normalize();
  }

  const size = obstacle.size ?? new Vector3(1, 1, 1);
  const halfSize = size.clone().multiplyScalar(0.5);
  const local = position.clone().sub(obstacle.position);
  const penetration = new Vector3(
    halfSize.x - Math.abs(local.x),
    halfSize.y - Math.abs(local.y),
    halfSize.z - Math.abs(local.z),
  );

  if (penetration.x <= penetration.y && penetration.x <= penetration.z) {
    return new Vector3(Math.sign(local.x) || 1, 0, 0);
  }
  if (penetration.y <= penetration.z) {
    return new Vector3(0, Math.sign(local.y) || 1, 0);
  }
  return new Vector3(0, 0, Math.sign(local.z) || 1);
}
