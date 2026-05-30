import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { AABB, LeafCell } from '../types';
import { SeededRandom } from '../utils/rng';
import { worldDangerLevel } from '../utils/depth';
import { sampleWorldField } from './worldField';

export interface OctoboxProfile {
  fieldSampleMs: number;
  splitPointsMs: number;
  nodesVisited: number;
  leavesGenerated: number;
  maxDepthReached: number;
}

export function generateOctoBoxLeaves(bounds: AABB, seed: number, profile?: OctoboxProfile): LeafCell[] {
  const rng = new SeededRandom(seed);
  const leaves: LeafCell[] = [];
  if (profile) {
    profile.fieldSampleMs = 0;
    profile.splitPointsMs = 0;
    profile.nodesVisited = 0;
    profile.leavesGenerated = 0;
    profile.maxDepthReached = 0;
  }
  split(bounds, 0, 'root', rng, leaves, seed, profile);
  return leaves;
}

function split(
  bounds: AABB,
  depth: number,
  id: string,
  rng: SeededRandom,
  leaves: LeafCell[],
  seed: number,
  profile?: OctoboxProfile,
): void {
  if (profile) {
    profile.nodesVisited += 1;
    if (depth > profile.maxDepthReached) {
      profile.maxDepthReached = depth;
    }
  }
  const size = bounds.max.clone().sub(bounds.min);
  const minSize = Math.min(size.x, size.y, size.z);
  const fieldSampleStart = profile ? performance.now() : 0;
  const fieldBias = computeFieldBias(bounds, seed);
  if (profile) {
    profile.fieldSampleMs += performance.now() - fieldSampleStart;
  }
  const density = estimateDensity(bounds, fieldBias);
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
    leaves.push({ id, depth, bounds, kind: 'empty', fieldBias });
    if (profile) {
      profile.leavesGenerated += 1;
    }
    return;
  }

  const splitPointsStart = profile ? performance.now() : 0;
  const splitX = buildSplitPoints(bounds.min.x, bounds.max.x, divisions, rng, minLeafSize);
  const splitY = buildSplitPoints(bounds.min.y, bounds.max.y, divisions, rng, minLeafSize);
  const splitZ = buildSplitPoints(bounds.min.z, bounds.max.z, divisions, rng, minLeafSize);
  if (profile) {
    profile.splitPointsMs += performance.now() - splitPointsStart;
  }
  let childIndex = 0;
  for (let xi = 0; xi < divisions; xi += 1) {
    for (let yi = 0; yi < divisions; yi += 1) {
      for (let zi = 0; zi < divisions; zi += 1) {
        const childMin = new Vector3(splitX[xi], splitY[yi], splitZ[zi]);
        const childMax = new Vector3(splitX[xi + 1], splitY[yi + 1], splitZ[zi + 1]);
        split({ min: childMin, max: childMax }, depth + 1, `${id}-${childIndex}`, rng, leaves, seed, profile);
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

function computeFieldBias(bounds: AABB, seed: number): number {
  const center = bounds.min.clone().add(bounds.max).multiplyScalar(0.5);
  return sampleWorldField(center, seed).fieldBias;
}

function estimateDensity(bounds: AABB, fieldBias: number): number {
  if (GAME_CONFIG.world.generationProfile !== ('tunnel_field' as string)) {
    return 0.65;
  }

  const center = bounds.min.clone().add(bounds.max).multiplyScalar(0.5);
  const depthDanger = worldDangerLevel(center.y);
  if (depthDanger <= 0) {
    return 0;
  }
  const size = bounds.max.clone().sub(bounds.min);
  const minSize = Math.min(size.x, size.y, size.z);
  const maxLeafSize = getMaxLeafSize();
  const sizePressure = Math.min(1, minSize / maxLeafSize);
  const depthPressure = depthDanger * GAME_CONFIG.world.depthCellDensityBonus;

  if (fieldBias >= GAME_CONFIG.world.tunnelCoreThreshold) {
    return Math.min(0.22, 0.04 * sizePressure + depthPressure * 0.12);
  }
  if (fieldBias <= GAME_CONFIG.world.tunnelWallThreshold) {
    return Math.min(1, 0.85 + sizePressure * 0.15 + depthPressure * 0.1);
  }

  const transition = (GAME_CONFIG.world.tunnelCoreThreshold - fieldBias) / (GAME_CONFIG.world.tunnelCoreThreshold - GAME_CONFIG.world.tunnelWallThreshold);
  return Math.min(1, 0.28 + transition * 0.48 + sizePressure * 0.18 + depthPressure);
}
