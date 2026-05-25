import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { AABB, LeafCell } from '../types';
import { SeededRandom } from '../utils/rng';

export function generateOctoBoxLeaves(bounds: AABB, seed: number): LeafCell[] {
  const rng = new SeededRandom(seed);
  const leaves: LeafCell[] = [];
  split(bounds, 0, 'root', rng, leaves);
  return leaves;
}

function split(bounds: AABB, depth: number, id: string, rng: SeededRandom, leaves: LeafCell[]): void {
  const size = bounds.max.clone().sub(bounds.min);
  const minSize = Math.min(size.x, size.y, size.z);
  const caveBias = computeCaveBias(bounds);
  const density = estimateDensity(bounds, caveBias);
  const divisions = chooseDivisions(density);
  const minLeafSize = getMinLeafSize();
  const maxLeafSize = getMaxLeafSize();
  const forceSplit = minSize > maxLeafSize && density > GAME_CONFIG.world.octoboxEmptyDensityThreshold;
  const shouldStop =
    depth >= GAME_CONFIG.world.octoboxMaxDepth ||
    minSize <= minLeafSize ||
    minSize / divisions < minLeafSize ||
    (depth > 0 && density <= GAME_CONFIG.world.octoboxEmptyDensityThreshold) ||
    (!forceSplit && depth > 0 && rng.next() > splitProbabilityForDensity(density));

  if (shouldStop) {
    leaves.push({ id, depth, bounds, kind: 'empty', caveBias });
    return;
  }

  const splitX = buildSplitPoints(bounds.min.x, bounds.max.x, divisions, rng, minLeafSize);
  const splitY = buildSplitPoints(bounds.min.y, bounds.max.y, divisions, rng, minLeafSize);
  const splitZ = buildSplitPoints(bounds.min.z, bounds.max.z, divisions, rng, minLeafSize);
  let childIndex = 0;
  for (let xi = 0; xi < divisions; xi += 1) {
    for (let yi = 0; yi < divisions; yi += 1) {
      for (let zi = 0; zi < divisions; zi += 1) {
        const childMin = new Vector3(splitX[xi], splitY[yi], splitZ[zi]);
        const childMax = new Vector3(splitX[xi + 1], splitY[yi + 1], splitZ[zi + 1]);
        split({ min: childMin, max: childMax }, depth + 1, `${id}-${childIndex}`, rng, leaves);
        childIndex += 1;
      }
    }
  }
}

function buildSplitPoints(min: number, max: number, divisions: number, rng: SeededRandom, minSegmentSize: number): number[] {
  const size = max - min;
  const points = [min];
  if (divisions === 2) {
    const lower = min + minSegmentSize;
    const upper = max - minSegmentSize;
    points.push(rng.range(lower, upper), max);
    return points;
  }

  let cursor = min;
  for (let index = 1; index < divisions; index += 1) {
    const remainingSegments = divisions - index;
    const lower = cursor + minSegmentSize;
    const upper = max - remainingSegments * minSegmentSize;
    const base = min + (size * index) / divisions;
    const jitter = size * (0.04 / divisions);
    const preferredLower = Math.max(lower, base - jitter);
    const preferredUpper = Math.min(upper, base + jitter);
    const splitPoint = preferredLower <= preferredUpper ? rng.range(preferredLower, preferredUpper) : rng.range(lower, upper);
    points.push(splitPoint);
    cursor = splitPoint;
  }
  points.push(max);
  return points;
}

function chooseDivisions(density: number): number {
  return density >= GAME_CONFIG.world.octoboxDenseDensityThreshold
    ? GAME_CONFIG.world.denseSplitDivisions
    : GAME_CONFIG.world.sparseSplitDivisions;
}

function splitProbabilityForDensity(density: number): number {
  const base = GAME_CONFIG.world.octoboxSplitProbability;
  return Math.min(1, Math.max(0.08, base * (0.35 + density * 0.9)));
}

function getMinLeafSize(): number {
  const shipDiameter = GAME_CONFIG.ship.radius * 2;
  return shipDiameter * GAME_CONFIG.world.octoboxMinCellSizeMultiplier;
}

function getMaxLeafSize(): number {
  const shipDiameter = GAME_CONFIG.ship.radius * 2;
  return shipDiameter * GAME_CONFIG.world.octoboxMaxCellSizeMultiplier;
}

function computeCaveBias(bounds: AABB): number {
  const center = bounds.min.clone().add(bounds.max).multiplyScalar(0.5);
  const chunkSize = GAME_CONFIG.world.chunkSize;
  const chunkCenter = new Vector3(
    Math.floor(center.x / chunkSize) * chunkSize + chunkSize * 0.5,
    Math.floor(center.y / chunkSize) * chunkSize + chunkSize * 0.5,
    Math.floor(center.z / chunkSize) * chunkSize + chunkSize * 0.5,
  );
  const normalized = center.distanceTo(chunkCenter) / (chunkSize * 0.85);
  return Math.max(0, 1 - normalized);
}

function estimateDensity(bounds: AABB, caveBias: number): number {
  if (GAME_CONFIG.world.generationMode !== 'cave') {
    return 0.65;
  }

  const size = bounds.max.clone().sub(bounds.min);
  const minSize = Math.min(size.x, size.y, size.z);
  const maxLeafSize = getMaxLeafSize();
  const sizePressure = Math.min(1, minSize / maxLeafSize);

  if (caveBias >= GAME_CONFIG.world.caveCoreBias) {
    return 0.04 * sizePressure;
  }
  if (caveBias <= GAME_CONFIG.world.caveWallBias) {
    return 0.85 + sizePressure * 0.15;
  }

  const transition = (GAME_CONFIG.world.caveCoreBias - caveBias) / (GAME_CONFIG.world.caveCoreBias - GAME_CONFIG.world.caveWallBias);
  return Math.min(1, 0.28 + transition * 0.48 + sizePressure * 0.18);
}
