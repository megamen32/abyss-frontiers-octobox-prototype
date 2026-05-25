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
  const shouldStop =
    depth >= GAME_CONFIG.world.octoboxMaxDepth ||
    minSize < GAME_CONFIG.world.octoboxMinCellSize ||
    (depth > 0 && rng.next() > GAME_CONFIG.world.octoboxSplitProbability);

  if (shouldStop) {
    leaves.push({ id, depth, bounds, kind: 'empty' });
    return;
  }

  const center = new Vector3(
    jitteredSplit(bounds.min.x, bounds.max.x, rng),
    jitteredSplit(bounds.min.y, bounds.max.y, rng),
    jitteredSplit(bounds.min.z, bounds.max.z, rng),
  );
  let childIndex = 0;
  for (const x of [bounds.min.x, center.x]) {
    for (const y of [bounds.min.y, center.y]) {
      for (const z of [bounds.min.z, center.z]) {
        const childMin = new Vector3(x, y, z);
        const childMax = new Vector3(
          x === bounds.min.x ? center.x : bounds.max.x,
          y === bounds.min.y ? center.y : bounds.max.y,
          z === bounds.min.z ? center.z : bounds.max.z,
        );
        split({ min: childMin, max: childMax }, depth + 1, `${id}-${childIndex}`, rng, leaves);
        childIndex += 1;
      }
    }
  }
}

function jitteredSplit(min: number, max: number, rng: SeededRandom): number {
  const size = max - min;
  const normalized = rng.range(0.34, 0.66);
  return min + size * normalized;
}
