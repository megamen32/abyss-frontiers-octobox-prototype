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
  const divisions = GAME_CONFIG.world.splitDivisions;
  const shouldStop =
    depth >= GAME_CONFIG.world.octoboxMaxDepth ||
    minSize < GAME_CONFIG.world.octoboxMinCellSize ||
    (depth > 0 && rng.next() > GAME_CONFIG.world.octoboxSplitProbability);

  if (shouldStop) {
    leaves.push({ id, depth, bounds, kind: 'empty', caveBias: computeCaveBias(bounds) });
    return;
  }

  const splitX = buildSplitPoints(bounds.min.x, bounds.max.x, divisions, rng);
  const splitY = buildSplitPoints(bounds.min.y, bounds.max.y, divisions, rng);
  const splitZ = buildSplitPoints(bounds.min.z, bounds.max.z, divisions, rng);
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

function buildSplitPoints(min: number, max: number, divisions: number, rng: SeededRandom): number[] {
  const size = max - min;
  const points = [min];
  if (divisions === 2) {
    points.push(min + size * rng.range(0.34, 0.66), max);
    return points;
  }

  for (let index = 1; index < divisions; index += 1) {
    const base = index / divisions;
    const jitterWindow = 0.08 / divisions;
    const normalized = rng.range(Math.max(0.05, base - jitterWindow), Math.min(0.95, base + jitterWindow));
    points.push(min + size * normalized);
  }
  points.push(max);
  return points;
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
