import type { AABB, LeafCell, Portal } from '../types';
import { GAME_CONFIG } from '../config';
import { aabbCenter, aabbSize, clamp, containsPoint, intersectsAabb } from '../utils/chunk';
import { SeededRandom } from '../utils/rng';

export interface AdjacencyProfile {
  pairsTested: number;
  exactChecks?: number;
  duplicatePairsSkipped?: number;
  planesVisited?: number;
  bucketLookups?: number;
  maxPlanePairs?: number;
  maxBucketLoad?: number;
}

type Axis = 'x' | 'y' | 'z';

interface CellRef {
  cell: LeafCell;
  index: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

interface FaceIndex {
  xMin: Map<number, CellRef[]>;
  xMax: Map<number, CellRef[]>;
  yMin: Map<number, CellRef[]>;
  yMax: Map<number, CellRef[]>;
  zMin: Map<number, CellRef[]>;
  zMax: Map<number, CellRef[]>;
}

const FACE_QUANTUM = 0.0001;
const DIRECT_FACE_PAIR_LIMIT = 24;

export function buildAdjacency(cells: LeafCell[], profile?: AdjacencyProfile): [string, string][] {
  const edges: [string, string][] = [];
  const minOpening = GAME_CONFIG.world.minPassageRadius * 2;
  if (profile) {
    profile.pairsTested = 0;
    profile.exactChecks = 0;
    profile.duplicatePairsSkipped = 0;
    profile.planesVisited = 0;
    profile.bucketLookups = 0;
    profile.maxPlanePairs = 0;
    profile.maxBucketLoad = 0;
  }

  const refs = cells.map(toCellRef);
  const minOverlapQ = Math.max(1, Math.floor(minOpening / FACE_QUANTUM) - 1);
  const index = buildFaceIndex(refs, minOverlapQ);
  connectAxis(index.xMax, index.xMin, 'x', minOverlapQ, minOpening, edges, profile);
  connectAxis(index.yMax, index.yMin, 'y', minOverlapQ, minOpening, edges, profile);
  connectAxis(index.zMax, index.zMin, 'z', minOverlapQ, minOpening, edges, profile);

  return edges;
}

function toCellRef(cell: LeafCell, index: number): CellRef {
  return {
    cell,
    index,
    minX: quantize(cell.bounds.min.x),
    maxX: quantize(cell.bounds.max.x),
    minY: quantize(cell.bounds.min.y),
    maxY: quantize(cell.bounds.max.y),
    minZ: quantize(cell.bounds.min.z),
    maxZ: quantize(cell.bounds.max.z),
  };
}

function quantize(value: number): number {
  return Math.round(value / FACE_QUANTUM);
}

function buildFaceIndex(refs: CellRef[], minOverlapQ: number): FaceIndex {
  const index: FaceIndex = {
    xMin: new Map(),
    xMax: new Map(),
    yMin: new Map(),
    yMax: new Map(),
    zMin: new Map(),
    zMax: new Map(),
  };
  for (const ref of refs) {
    if (projectedLength(ref, 'y') >= minOverlapQ && projectedLength(ref, 'z') >= minOverlapQ) {
      pushFace(index.xMin, ref.minX, ref);
      pushFace(index.xMax, ref.maxX, ref);
    }
    if (projectedLength(ref, 'x') >= minOverlapQ && projectedLength(ref, 'z') >= minOverlapQ) {
      pushFace(index.yMin, ref.minY, ref);
      pushFace(index.yMax, ref.maxY, ref);
    }
    if (projectedLength(ref, 'x') >= minOverlapQ && projectedLength(ref, 'y') >= minOverlapQ) {
      pushFace(index.zMin, ref.minZ, ref);
      pushFace(index.zMax, ref.maxZ, ref);
    }
  }
  return index;
}

function pushFace(map: Map<number, CellRef[]>, key: number, ref: CellRef): void {
  const refs = map.get(key);
  if (refs) {
    refs.push(ref);
    return;
  }
  map.set(key, [ref]);
}

function connectAxis(
  maxFaces: Map<number, CellRef[]>,
  minFaces: Map<number, CellRef[]>,
  axis: Axis,
  minOverlapQ: number,
  minOpening: number,
  edges: [string, string][],
  profile?: AdjacencyProfile,
): void {
  for (const [plane, maxCells] of maxFaces) {
    const minCells = minFaces.get(plane);
    if (!minCells) {
      continue;
    }
    if (profile) {
      profile.planesVisited = (profile.planesVisited ?? 0) + 1;
    }
    const checksBefore = profile?.exactChecks ?? 0;
    connectFaceGroups(maxCells, minCells, axis, minOverlapQ, minOpening, edges, profile);
    if (profile) {
      const planePairs = (profile.exactChecks ?? 0) - checksBefore;
      profile.maxPlanePairs = Math.max(profile.maxPlanePairs ?? 0, planePairs);
    }
  }
}

function connectFaceGroups(
  aCells: CellRef[],
  bCells: CellRef[],
  axis: Axis,
  minOverlapQ: number,
  minOpening: number,
  edges: [string, string][],
  profile?: AdjacencyProfile,
): void {
  if (aCells.length * bCells.length <= DIRECT_FACE_PAIR_LIMIT) {
    connectFaceGroupsDirect(aCells, bCells, axis, minOverlapQ, minOpening, edges, profile);
    return;
  }

  const first = chooseSweepAxis(aCells, bCells, axis);
  const second = otherProjectedAxis(axis, first);
  const scanCells = aCells.length >= bCells.length ? aCells : bCells;
  const candidateCells = aCells.length >= bCells.length ? bCells : aCells;
  const scan = [...scanCells].sort((a, b) => getMin(a, first) - getMin(b, first));
  const candidates = [...candidateCells].sort((a, b) => getMin(a, first) - getMin(b, first));
  const active: CellRef[] = [];
  let cursor = 0;

  for (const cell of scan) {
    if (projectedLength(cell, first) < minOverlapQ || projectedLength(cell, second) < minOverlapQ) {
      continue;
    }
    const maxCandidateMin = getMax(cell, first) - minOverlapQ;
    while (cursor < candidates.length && getMin(candidates[cursor], first) <= maxCandidateMin) {
      const candidate = candidates[cursor];
      if (projectedLength(candidate, first) >= minOverlapQ && projectedLength(candidate, second) >= minOverlapQ) {
        active.push(candidate);
      }
      cursor += 1;
    }

    const minCandidateMax = getMin(cell, first) + minOverlapQ;
    let write = 0;
    for (let index = 0; index < active.length; index += 1) {
      const other = active[index];
      if (getMax(other, first) < minCandidateMax) {
        continue;
      }
      active[write] = other;
      write += 1;
      if (intervalOverlapQ(cell, other, second) < minOverlapQ) {
        continue;
      }
      if (profile) {
        profile.pairsTested += 1;
        profile.exactChecks = (profile.exactChecks ?? 0) + 1;
      }
      const overlap = overlapForAxis(cell.cell.bounds, other.cell.bounds, axis);
      if (overlap.x < minOpening || overlap.y < minOpening) {
        continue;
      }
      edges.push(edgeForPair(cell, other));
    }
    active.length = write;
  }
}

function connectFaceGroupsDirect(
  aCells: CellRef[],
  bCells: CellRef[],
  axis: Axis,
  minOverlapQ: number,
  minOpening: number,
  edges: [string, string][],
  profile?: AdjacencyProfile,
): void {
  const first = firstRangeAxis(axis);
  const second = secondRangeAxis(axis);
  for (const a of aCells) {
    if (projectedLength(a, first) < minOverlapQ || projectedLength(a, second) < minOverlapQ) {
      continue;
    }
    for (const b of bCells) {
      if (
        projectedLength(b, first) < minOverlapQ
        || projectedLength(b, second) < minOverlapQ
        || intervalOverlapQ(a, b, first) < minOverlapQ
        || intervalOverlapQ(a, b, second) < minOverlapQ
      ) {
        continue;
      }
      if (profile) {
        profile.pairsTested += 1;
        profile.exactChecks = (profile.exactChecks ?? 0) + 1;
      }
      const overlap = overlapForAxis(a.cell.bounds, b.cell.bounds, axis);
      if (overlap.x < minOpening || overlap.y < minOpening) {
        continue;
      }
      edges.push(edgeForPair(a, b));
    }
  }
}

function chooseSweepAxis(aCells: CellRef[], bCells: CellRef[], axis: Axis): Axis {
  const first = firstRangeAxis(axis);
  const second = secondRangeAxis(axis);
  return sweepDensity(aCells, bCells, first) <= sweepDensity(aCells, bCells, second) ? first : second;
}

function sweepDensity(aCells: CellRef[], bCells: CellRef[], axis: Axis): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let totalLength = 0;
  let count = 0;
  for (const cell of aCells) {
    min = Math.min(min, getMin(cell, axis));
    max = Math.max(max, getMax(cell, axis));
    totalLength += projectedLength(cell, axis);
    count += 1;
  }
  for (const cell of bCells) {
    min = Math.min(min, getMin(cell, axis));
    max = Math.max(max, getMax(cell, axis));
    totalLength += projectedLength(cell, axis);
    count += 1;
  }
  return totalLength / Math.max(1, count) / Math.max(1, max - min);
}

function otherProjectedAxis(faceAxis: Axis, projectedAxis: Axis): Axis {
  const first = firstRangeAxis(faceAxis);
  const second = secondRangeAxis(faceAxis);
  return projectedAxis === first ? second : first;
}

function projectedLength(ref: CellRef, axis: Axis): number {
  return getMax(ref, axis) - getMin(ref, axis);
}

function intervalOverlapQ(a: CellRef, b: CellRef, axis: Axis): number {
  return Math.min(getMax(a, axis), getMax(b, axis)) - Math.max(getMin(a, axis), getMin(b, axis));
}

function firstRangeAxis(axis: Axis): Axis {
  return axis === 'x' ? 'y' : 'x';
}

function secondRangeAxis(axis: Axis): Axis {
  return axis === 'z' ? 'y' : 'z';
}

function getMin(ref: CellRef, axis: Axis): number {
  if (axis === 'x') {
    return ref.minX;
  }
  if (axis === 'y') {
    return ref.minY;
  }
  return ref.minZ;
}

function getMax(ref: CellRef, axis: Axis): number {
  if (axis === 'x') {
    return ref.maxX;
  }
  if (axis === 'y') {
    return ref.maxY;
  }
  return ref.maxZ;
}

function edgeForPair(a: CellRef, b: CellRef): [string, string] {
  return a.index < b.index ? [a.cell.id, b.cell.id] : [b.cell.id, a.cell.id];
}

export function buildNavigableSet(
  cells: LeafCell[],
  portals: Portal[],
  adjacency: [string, string][],
  rng: SeededRandom,
  bounds: AABB,
): Set<string> {
  const isTunnelField = GAME_CONFIG.world.generationProfile === ('tunnel_field' as string);
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

  if (isTunnelField) {
    for (const cell of cells) {
      if (!passableIds.has(cell.id)) {
        continue;
      }
      if (cell.fieldBias >= GAME_CONFIG.world.tunnelCoreThreshold) {
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
      const fieldBias = isTunnelField ? cell.fieldBias : 0.5;
      return { cell, weight: sizeFactor * 0.45 + centerBias * 0.2 + fieldBias * 0.35 };
    })
    .sort((a, b) => b.weight - a.weight);

  for (const candidate of candidates) {
    if (freeIds.has(candidate.cell.id)) {
      continue;
    }
    const thresholdBase = isTunnelField
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
