import { Box3, MathUtils, Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { CaveCollisionSample, Obstacle, PlayerState } from '../types';
import { alignPlayerToDirection, travelDirection } from './player';

const SURFACE_NORMAL = new Vector3(0, -1, 0);
const CRT_P0 = new Vector3();
const CRT_P1 = new Vector3();
const CRT_P2 = new Vector3();
const CRT_P3 = new Vector3();
const CRT_C = new Vector3();
const CRT_D = new Vector3();
const CRT_D2 = new Vector3();
const CRT_DIFF = new Vector3();
const CRT_CLOSEST = new Vector3();
const CRT_GRADIENT = new Vector3();

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

export function resolvePlayerCaveCollision(
  player: PlayerState,
  samples: CaveCollisionSample[],
): boolean {
  if (samples.length < 2) return false;

  let bestSD = Number.POSITIVE_INFINITY;
  let bestRadius = 0;
  const n = samples.length;

  for (let seg = 0; seg < n - 1; seg++) {
    CRT_P0.copy(seg === 0 ? samples[0].position : samples[seg - 1].position);
    CRT_P1.copy(samples[seg].position);
    CRT_P2.copy(samples[seg + 1].position);
    CRT_P3.copy(seg + 2 >= n ? samples[n - 1].position : samples[seg + 2].position);

    let bestT = 0;
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      catmullRomVec(CRT_C, CRT_P0, CRT_P1, CRT_P2, CRT_P3, t);
      const dsq = CRT_C.distanceToSquared(player.position);
      if (dsq < bestDistSq) {
        bestDistSq = dsq;
        bestT = t;
      }
    }

    for (let iter = 0; iter < 4; iter++) {
      catmullRomVec(CRT_C, CRT_P0, CRT_P1, CRT_P2, CRT_P3, bestT);
      CRT_DIFF.copy(player.position).sub(CRT_C);
      if (CRT_DIFF.lengthSq() < 1e-10) break;

      catmullRomDeriv(CRT_D, CRT_P0, CRT_P1, CRT_P2, CRT_P3, bestT);
      catmullRomSecondDeriv(CRT_D2, CRT_P0, CRT_P1, CRT_P2, CRT_P3, bestT);
      const denom = CRT_D.dot(CRT_D) + CRT_DIFF.dot(CRT_D2);
      if (Math.abs(denom) < 1e-10) break;

      bestT = MathUtils.clamp(bestT + CRT_DIFF.dot(CRT_D) / denom, 0, 1);
    }

    catmullRomVec(CRT_C, CRT_P0, CRT_P1, CRT_P2, CRT_P3, bestT);
    const radius = MathUtils.lerp(samples[seg].radius, samples[seg + 1].radius, bestT);
    const sd = CRT_C.distanceTo(player.position) - radius;

    if (sd < bestSD) {
      bestSD = sd;
      CRT_CLOSEST.copy(CRT_C);
      bestRadius = radius;
    }
  }

  const allowedDist = Math.max(0.15, bestRadius - player.radius - GAME_CONFIG.collision.separationDistance);
  const currentDist = player.position.distanceTo(CRT_CLOSEST);
  if (currentDist <= allowedDist) return false;

  CRT_GRADIENT.copy(player.position).sub(CRT_CLOSEST);
  const gLen = CRT_GRADIENT.length();
  if (gLen < 1e-8) {
    CRT_GRADIENT.copy(travelDirection(player)).multiplyScalar(-1);
  } else {
    CRT_GRADIENT.divideScalar(gLen);
  }

  applyCollisionResponse(player, CRT_GRADIENT.clone().multiplyScalar(-1), {
    tangentialDamping: GAME_CONFIG.collision.obstacleTangentialDamping,
    reboundFactor: GAME_CONFIG.collision.obstacleReboundFactor,
    minReboundSpeed: GAME_CONFIG.collision.obstacleReboundMinSpeed,
    reposition: () => {
      player.position.copy(CRT_CLOSEST).addScaledVector(CRT_GRADIENT, allowedDist);
    },
  });
  return true;
}

function catmullRomVec(
  out: Vector3, p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number,
): Vector3 {
  const t2 = t * t;
  const t3 = t2 * t;
  return out.set(
    0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  );
}

function catmullRomDeriv(
  out: Vector3, p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number,
): Vector3 {
  const t2 = t * t;
  return out.set(
    0.5 * (-p0.x + p2.x + (4 * p0.x - 10 * p1.x + 8 * p2.x - 2 * p3.x) * t + (-3 * p0.x + 9 * p1.x - 9 * p2.x + 3 * p3.x) * t2),
    0.5 * (-p0.y + p2.y + (4 * p0.y - 10 * p1.y + 8 * p2.y - 2 * p3.y) * t + (-3 * p0.y + 9 * p1.y - 9 * p2.y + 3 * p3.y) * t2),
    0.5 * (-p0.z + p2.z + (4 * p0.z - 10 * p1.z + 8 * p2.z - 2 * p3.z) * t + (-3 * p0.z + 9 * p1.z - 9 * p2.z + 3 * p3.z) * t2),
  );
}

function catmullRomSecondDeriv(
  out: Vector3, p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number,
): Vector3 {
  return out.set(
    0.5 * ((4 * p0.x - 10 * p1.x + 8 * p2.x - 2 * p3.x) + 2 * (-3 * p0.x + 9 * p1.x - 9 * p2.x + 3 * p3.x) * t),
    0.5 * ((4 * p0.y - 10 * p1.y + 8 * p2.y - 2 * p3.y) + 2 * (-3 * p0.y + 9 * p1.y - 9 * p2.y + 3 * p3.y) * t),
    0.5 * ((4 * p0.z - 10 * p1.z + 8 * p2.z - 2 * p3.z) + 2 * (-3 * p0.z + 9 * p1.z - 9 * p2.z + 3 * p3.z) * t),
  );
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
