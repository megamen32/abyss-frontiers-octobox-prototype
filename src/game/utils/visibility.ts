import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { AABB, ChunkData } from '../types';

const FOG_THRESHOLD = 0.03;

export interface ViewFrustumSnapshot {
  position: Vector3;
  lookAt: Vector3;
  up: Vector3;
  fov: number;
  aspect: number;
  near: number;
  far: number;
}

export function fogDensity(): number {
  const hideDistance = (GAME_CONFIG.visuals.fogRenderRadiusChunks - 0.5) * GAME_CONFIG.world.chunkSize;
  return Math.sqrt(-Math.log(FOG_THRESHOLD)) / hideDistance;
}

export function fogVisibilityDistance(): number {
  return GAME_CONFIG.visuals.fogRenderRadiusChunks * GAME_CONFIG.world.chunkSize;
}

export function fogCullingDistance(): number {
  return fogVisibilityDistance() + GAME_CONFIG.world.chunkSize * 1.5;
}

export function fogChunkRenderRadius(): number {
  return GAME_CONFIG.visuals.fogRenderRadiusChunks;
}

export function chunkGenerationRadius(): number {
  return fogChunkRenderRadius() + GAME_CONFIG.world.preloadRadiusPadding;
}

export function chunkEvictionRadius(): number {
  return chunkGenerationRadius() + GAME_CONFIG.world.evictionRadiusPadding;
}

export function buildFrustumFromSnapshot(snapshot: ViewFrustumSnapshot): Frustum {
  const camera = new PerspectiveCamera(snapshot.fov, snapshot.aspect, snapshot.near, snapshot.far);
  camera.position.copy(snapshot.position);
  camera.up.copy(snapshot.up);
  camera.lookAt(snapshot.lookAt);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return new Frustum().setFromProjectionMatrix(matrix);
}

export function isChunkInsideViewFrustum(bounds: AABB, snapshot: ViewFrustumSnapshot): boolean {
  const frustum = buildFrustumFromSnapshot(snapshot);
  return frustum.intersectsBox(new Box3(bounds.min.clone(), bounds.max.clone()));
}

export function getChunkFrustumPriority(bounds: AABB, snapshot: ViewFrustumSnapshot): number {
  const frustum = buildFrustumFromSnapshot(snapshot);
  const box = new Box3(bounds.min.clone(), bounds.max.clone());
  if (frustum.intersectsBox(box)) {
    return 1;
  }

  const center = bounds.min.clone().add(bounds.max).multiplyScalar(0.5);
  const forward = snapshot.lookAt.clone().sub(snapshot.position).normalize();
  const toCenter = center.clone().sub(snapshot.position);
  const distance = Math.max(1, toCenter.length());
  const forwardness = toCenter.normalize().dot(forward);
  if (forwardness <= -0.2) {
    return -1;
  }

  const halfFov = (snapshot.fov * Math.PI) / 360;
  const angle = Math.acos(Math.max(-1, Math.min(1, forwardness)));
  const margin = Math.max(0.12, GAME_CONFIG.world.chunkSize / distance);
  return angle <= halfFov * (1 + margin) ? 0.45 : -0.25;
}

export function getChunkOcclusionPenalty(
  bounds: AABB,
  cameraPosition: Vector3,
  blockers: Iterable<ChunkData>,
): number {
  const targetCenter = bounds.min.clone().add(bounds.max).multiplyScalar(0.5);
  const targetDistance = cameraPosition.distanceTo(targetCenter);
  let penalty = 0;
  for (const chunk of blockers) {
    if (!chunk.staticMeshData || chunk.staticMeshData.indices.length === 0) {
      continue;
    }
    const blockerCenter = chunk.bounds.min.clone().add(chunk.bounds.max).multiplyScalar(0.5);
    const blockerDistance = cameraPosition.distanceTo(blockerCenter);
    if (blockerDistance >= targetDistance) {
      continue;
    }
    if (!segmentIntersectsAabb(cameraPosition, targetCenter, chunk.bounds)) {
      continue;
    }
    penalty += 0.55;
  }
  return penalty;
}

function segmentIntersectsAabb(start: Vector3, end: Vector3, bounds: AABB): boolean {
  const direction = end.clone().sub(start);
  let tMin = 0;
  let tMax = 1;

  for (const axis of ['x', 'y', 'z'] as const) {
    const origin = start[axis];
    const delta = direction[axis];
    const min = bounds.min[axis];
    const max = bounds.max[axis];
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
