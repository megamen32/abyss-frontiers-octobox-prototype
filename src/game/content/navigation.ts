import type { AABB, LeafCell, Portal } from '../types';
import { GAME_CONFIG } from '../config';
import { aabbCenter, aabbSize, clamp, containsPoint, intersectsAabb } from '../utils/chunk';
import { SeededRandom } from '../utils/rng';

export function buildAdjacency(cells: LeafCell[]): [string, string][] {
  const edges: [string, string][] = [];
  const minOpening = GAME_CONFIG.world.minPassageRadius * 2;

  for (let i = 0; i < cells.length; i += 1) {
    for (let j = i + 1; j < cells.length; j += 1) {
      const a = cells[i];
      const b = cells[j];
      const axis = touchingAxis(a.bounds, b.bounds);
      if (!axis) {
        continue;
      }

      const overlap = overlapForAxis(a.bounds, b.bounds, axis);
      if (overlap.x < minOpening || overlap.y < minOpening) {
        continue;
      }
      edges.push([a.id, b.id]);
    }
  }

  return edges;
}

export function buildNavigableSet(
  cells: LeafCell[],
  portals: Portal[],
  adjacency: [string, string][],
  rng: SeededRandom,
  bounds: AABB,
): Set<string> {
  const isCaveMode = GAME_CONFIG.world.generationMode === ('cave' as string);
  const adjacencyMap = toAdjacencyMap(adjacency);
  const minPassage = GAME_CONFIG.world.minPassageRadius * 2;
  const center = bounds.min.clone().add(bounds.max).multiplyScalar(0.5);
  const passableIds = new Set(
    cells
      .filter((cell) => {
        const size = aabbSize(cell.bounds);
        return Math.min(size.x, size.y, size.z) >= minPassage;
      })
      .map((cell) => cell.id),
  );

  const root = cells.find((cell) => passableIds.has(cell.id) && containsPoint(cell.bounds, center)) ?? cells[0];
  const freeIds = new Set<string>([root.id]);

  if (isCaveMode) {
    for (const cell of cells) {
      if (!passableIds.has(cell.id)) {
        continue;
      }
      if (cell.caveBias >= GAME_CONFIG.world.caveCoreBias) {
        freeIds.add(cell.id);
      }
    }
  }

  for (const portal of portals) {
    const portalCell = findBestPortalCell(cells, portal, passableIds);
    if (!portalCell) {
      continue;
    }
    markPath(root.id, portalCell.id, adjacencyMap, passableIds, freeIds);
  }

  const viableCells = cells.filter((cell) => passableIds.has(cell.id));
  const candidates = viableCells
    .map((cell) => {
      const cellCenter = aabbCenter(cell.bounds);
      const distance = cellCenter.distanceTo(center) / GAME_CONFIG.world.chunkSize;
      const size = aabbSize(cell.bounds);
      const sizeFactor = clamp(Math.min(size.x, size.y, size.z) / 16, 0.25, 1.4);
      const centerBias = 1 - Math.min(distance, 1);
      const caveBias = isCaveMode ? cell.caveBias : 0.5;
      return { cell, weight: sizeFactor * 0.45 + centerBias * 0.2 + caveBias * 0.35 };
    })
    .sort((a, b) => b.weight - a.weight);

  for (const candidate of candidates) {
    if (freeIds.has(candidate.cell.id)) {
      continue;
    }
    const thresholdBase = isCaveMode
      ? GAME_CONFIG.world.freeBoxProbability * 0.35
      : GAME_CONFIG.world.freeBoxProbability;
    const threshold = thresholdBase * (0.45 + candidate.weight * 0.9);
    if (rng.next() > threshold) {
      continue;
    }
    const nearestFree = findNearestFree(candidate.cell.id, cells, freeIds);
    if (!nearestFree) {
      continue;
    }
    markPath(nearestFree, candidate.cell.id, adjacencyMap, passableIds, freeIds);
  }

  return freeIds;
}

function touchingAxis(a: AABB, b: AABB): 'x' | 'y' | 'z' | null {
  const epsilon = 0.0001;
  const touchX = Math.abs(a.max.x - b.min.x) < epsilon || Math.abs(b.max.x - a.min.x) < epsilon;
  const overlapY = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const overlapZ = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  if (touchX && overlapY > 0 && overlapZ > 0) {
    return 'x';
  }

  const touchY = Math.abs(a.max.y - b.min.y) < epsilon || Math.abs(b.max.y - a.min.y) < epsilon;
  const overlapX = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  if (touchY && overlapX > 0 && overlapZ > 0) {
    return 'y';
  }

  const touchZ = Math.abs(a.max.z - b.min.z) < epsilon || Math.abs(b.max.z - a.min.z) < epsilon;
  if (touchZ && overlapX > 0 && overlapY > 0) {
    return 'z';
  }

  return null;
}

function overlapForAxis(a: AABB, b: AABB, axis: 'x' | 'y' | 'z'): { x: number; y: number } {
  if (axis === 'x') {
    return {
      x: Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y),
      y: Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z),
    };
  }
  if (axis === 'y') {
    return {
      x: Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x),
      y: Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z),
    };
  }
  return {
    x: Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x),
    y: Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y),
  };
}

function toAdjacencyMap(adjacency: [string, string][]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [a, b] of adjacency) {
    const listA = map.get(a) ?? [];
    listA.push(b);
    map.set(a, listA);
    const listB = map.get(b) ?? [];
    listB.push(a);
    map.set(b, listB);
  }
  return map;
}

function findBestPortalCell(cells: LeafCell[], portal: Portal, passableIds: Set<string>): LeafCell | undefined {
  return cells
    .filter((cell) => passableIds.has(cell.id) && intersectsAabb(cell.bounds, portal.bounds))
    .sort((a, b) => aabbCenter(a.bounds).distanceTo(portal.center) - aabbCenter(b.bounds).distanceTo(portal.center))[0];
}

function markPath(
  start: string,
  target: string,
  adjacency: Map<string, string[]>,
  allowed: Set<string>,
  freeIds: Set<string>,
): void {
  const queue = [start];
  const previous = new Map<string, string | null>([[start, null]]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (current === target) {
      let cursor: string | null = target;
      while (cursor) {
        freeIds.add(cursor);
        cursor = previous.get(cursor) ?? null;
      }
      return;
    }
    const neighbors = adjacency.get(current) ?? [];
    for (const next of neighbors) {
      if (!allowed.has(next) || previous.has(next)) {
        continue;
      }
      previous.set(next, current);
      queue.push(next);
    }
  }
}

export function ensurePortalConnectivity(
  cells: LeafCell[],
  portals: Portal[],
  adjacency: [string, string][],
  freeIds: Set<string>,
): void {
  const adjMap = toAdjacencyMap(adjacency);
  const minPassage = GAME_CONFIG.world.minPassageRadius * 2;
  const passableIds = new Set(
    cells
      .filter((cell) => {
        const size = aabbSize(cell.bounds);
        return Math.min(size.x, size.y, size.z) >= minPassage;
      })
      .map((cell) => cell.id),
  );

  const portalCellIds: string[] = [];
  for (const portal of portals) {
    const best = findBestPortalCell(cells, portal, passableIds);
    if (best) {
      portalCellIds.push(best.id);
      freeIds.add(best.id);
    }
  }

  if (portalCellIds.length < 2) {
    return;
  }

  const anchor = portalCellIds[0];
  for (let iteration = 0; iteration < portalCellIds.length; iteration++) {
    const reachable = bfsFreeReachable(anchor, adjMap, freeIds);
    let disconnected: string | null = null;
    for (const pid of portalCellIds) {
      if (!reachable.has(pid)) {
        disconnected = pid;
        break;
      }
    }
    if (disconnected === null) {
      return;
    }
    const path = bfsPathToSet(disconnected, reachable, adjMap);
    if (path) {
      for (const id of path) {
        freeIds.add(id);
      }
    }
  }
}

function bfsFreeReachable(
  start: string,
  adjMap: Map<string, string[]>,
  freeIds: Set<string>,
): Set<string> {
  const visited = new Set<string>();
  const queue = [start];
  visited.add(start);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjMap.get(current) ?? []) {
      if (freeIds.has(next) && !visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

function bfsPathToSet(
  start: string,
  targets: Set<string>,
  adjMap: Map<string, string[]>,
): string[] | null {
  if (targets.has(start)) {
    return [];
  }
  const previous = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current !== start && targets.has(current)) {
      const path: string[] = [];
      let cursor: string | null = current;
      while (cursor !== null) {
        path.push(cursor);
        cursor = previous.get(cursor) ?? null;
      }
      return path;
    }
    for (const next of adjMap.get(current) ?? []) {
      if (!previous.has(next)) {
        previous.set(next, current);
        queue.push(next);
      }
    }
  }
  return null;
}

function findNearestFree(cellId: string, cells: LeafCell[], freeIds: Set<string>): string | null {
  const source = cells.find((cell) => cell.id === cellId);
  if (!source) {
    return null;
  }

  const sourceCenter = aabbCenter(source.bounds);
  let best: { id: string; distance: number } | null = null;

  for (const cell of cells) {
    if (!freeIds.has(cell.id)) {
      continue;
    }
    const distance = aabbCenter(cell.bounds).distanceTo(sourceCenter);
    if (!best || distance < best.distance) {
      best = { id: cell.id, distance };
    }
  }

  return best?.id ?? null;
}
