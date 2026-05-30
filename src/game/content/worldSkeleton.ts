import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { ChunkCoord } from '../types';
import { hashInts } from '../utils/hash';
import { WORLD_SIZE, wrapPosition } from '../utils/worldTopology';

export interface SkeletonNode {
  id: number;
  coord: ChunkCoord;
  position: Vector3;
  radius: number;
}

export interface SkeletonEdge {
  a: SkeletonNode;
  b: SkeletonNode;
  radius: number;
}

export interface WorldSkeletonSample {
  nearestPoint: Vector3;
  distance: number;
  radius: number;
}

export interface WorldSkeletonFieldSample {
  distance: number;
  radius: number;
}

export interface WorldSkeletonProfile {
  skeletonCandidatesTested: number;
}

interface SkeletonCandidateSet {
  nodes: SkeletonNode[];
  edges: SkeletonEdgeRef[];
}

interface SkeletonEdgeRef {
  edge: SkeletonEdge;
  sx: number;
  sy: number;
  sz: number;
  vx: number;
  vy: number;
  vz: number;
  lenSq: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

const _nearest = new Vector3();
const _candidate = new Vector3();
const nodeCache = new Map<string, SkeletonNode>();
const edgeCache = new Map<string, SkeletonEdge[]>();
const candidateCache = new Map<string, SkeletonCandidateSet>();

export function skeletonMacroCellSize(): number {
  return WORLD_SIZE / GAME_CONFIG.world.skeletonMacroCellsPerAxis;
}

export function skeletonMacroCoordForPosition(position: Vector3): ChunkCoord {
  const wrapped = wrapPosition(position);
  const size = skeletonMacroCellSize();
  return wrapSkeletonCoord({
    x: Math.floor(wrapped.x / size),
    y: Math.floor(wrapped.y / size),
    z: Math.floor(wrapped.z / size),
  });
}

export function skeletonNodeAt(coord: ChunkCoord, seed: number): SkeletonNode {
  const wrapped = wrapSkeletonCoord(coord);
  const key = nodeCacheKey(seed, wrapped);
  const cached = nodeCache.get(key);
  if (cached) return cached;
  const size = skeletonMacroCellSize();
  const jitter = size * 0.26;
  const center = new Vector3(
    wrapped.x * size + size * 0.5,
    wrapped.y * size + size * 0.5,
    wrapped.z * size + size * 0.5,
  );
  if (wrapped.x === 0 && wrapped.y === 0 && wrapped.z === 0) {
    center.set(GAME_CONFIG.world.spawn.x, GAME_CONFIG.world.spawn.y, GAME_CONFIG.world.spawn.z);
  } else {
    center.x += (seededUnit(seed, wrapped, 11) - 0.5) * jitter;
    center.y += (seededUnit(seed, wrapped, 13) - 0.5) * jitter;
    center.z += (seededUnit(seed, wrapped, 17) - 0.5) * jitter;
  }
  const node = {
    id: linearIndex(wrapped),
    coord: wrapped,
    position: wrapPosition(center),
    radius: GAME_CONFIG.world.chunkSize * (0.75 + seededUnit(seed, wrapped, 19) * 0.5),
  };
  nodeCache.set(key, node);
  return node;
}

export function skeletonEdgesForMacroCoord(coord: ChunkCoord, seed: number): SkeletonEdge[] {
  const wrapped = wrapSkeletonCoord(coord);
  const cacheKey = nodeCacheKey(seed, wrapped);
  const cached = edgeCache.get(cacheKey);
  if (cached) return cached;
  const node = skeletonNodeAt(wrapped, seed);
  const result: SkeletonEdge[] = [];
  for (const other of connectedMacroCoords(wrapped, seed)) {
    const otherNode = skeletonNodeAt(other, seed);
    if (node.id <= otherNode.id || isWrappedBackbone(coord, other)) {
      result.push({
        a: node,
        b: otherNode,
        radius: GAME_CONFIG.world.chunkSize * (0.45 + seededUnit(seed, canonicalCoord(node.coord, otherNode.coord), 29) * 0.3),
      });
    }
  }
  edgeCache.set(cacheKey, result);
  return result;
}

export function sampleWorldSkeleton(position: Vector3, seed: number, profile?: WorldSkeletonProfile): WorldSkeletonSample {
  const sample = sampleWorldSkeletonInternal(position, seed, profile);
  return {
    nearestPoint: sample.nearestPoint.clone(),
    distance: sample.distance,
    radius: sample.radius,
  };
}

export function sampleWorldSkeletonField(position: Vector3, seed: number, profile?: WorldSkeletonProfile): WorldSkeletonFieldSample {
  const sample = sampleWorldSkeletonInternal(position, seed, profile);
  return {
    distance: sample.distance,
    radius: sample.radius,
  };
}

function sampleWorldSkeletonInternal(position: Vector3, seed: number, profile?: WorldSkeletonProfile): WorldSkeletonSample {
  const macro = skeletonMacroCoordForPosition(position);
  const candidates = skeletonCandidatesForMacroCoord(macro, seed);
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  let bestRadius = GAME_CONFIG.world.chunkSize * 3;
  _nearest.copy(position);

  for (const node of candidates.nodes) {
    if (profile) {
      profile.skeletonCandidatesTested += 1;
    }
    considerPoint(position, node.position, node.radius);
  }
  for (const edge of candidates.edges) {
    if (distanceSqToPreparedSegmentBounds(position, edge) >= bestDistanceSq) {
      continue;
    }
    if (profile) {
      profile.skeletonCandidatesTested += 1;
    }
    closestPointOnPreparedSegment(_candidate, position, edge);
    considerPoint(position, _candidate, edge.edge.radius);
  }

  return {
    nearestPoint: _nearest,
    distance: Math.sqrt(bestDistanceSq),
    radius: bestRadius,
  };

  function considerPoint(p: Vector3, candidate: Vector3, radius: number): void {
    const d2 = wrappedDistanceSq(p, candidate);
    if (d2 < bestDistanceSq) {
      bestDistanceSq = d2;
      bestRadius = radius;
      _nearest.copy(candidate);
    }
  }
}

function skeletonCandidatesForMacroCoord(macro: ChunkCoord, seed: number): SkeletonCandidateSet {
  const wrapped = wrapSkeletonCoord(macro);
  const key = `candidates:${nodeCacheKey(seed, wrapped)}`;
  const cached = candidateCache.get(key);
  if (cached) return cached;
  const nodes: SkeletonNode[] = [];
  const edges: SkeletonEdgeRef[] = [];
  const nodeIds = new Set<number>();
  const edgeKeys = new Set<string>();

  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        const coord = wrapSkeletonCoord({ x: wrapped.x + x, y: wrapped.y + y, z: wrapped.z + z });
        const node = skeletonNodeAt(coord, seed);
        if (!nodeIds.has(node.id)) {
          nodeIds.add(node.id);
          nodes.push(node);
        }
        for (const edge of skeletonEdgesForMacroCoord(coord, seed)) {
          const edgeKey = edge.a.id <= edge.b.id ? `${edge.a.id}:${edge.b.id}` : `${edge.b.id}:${edge.a.id}`;
          if (edgeKeys.has(edgeKey)) {
            continue;
          }
          edgeKeys.add(edgeKey);
          edges.push(prepareEdge(edge));
        }
      }
    }
  }

  const candidates = { nodes, edges };
  candidateCache.set(key, candidates);
  return candidates;
}

function prepareEdge(edge: SkeletonEdge): SkeletonEdgeRef {
  const sx = edge.a.position.x;
  const sy = edge.a.position.y;
  const sz = edge.a.position.z;
  const ex = unwrapAxis(edge.b.position.x, sx);
  const ey = unwrapAxis(edge.b.position.y, sy);
  const ez = unwrapAxis(edge.b.position.z, sz);
  const vx = ex - sx;
  const vy = ey - sy;
  const vz = ez - sz;
  const minX = Math.min(sx, ex);
  const maxX = Math.max(sx, ex);
  const minY = Math.min(sy, ey);
  const maxY = Math.max(sy, ey);
  const minZ = Math.min(sz, ez);
  const maxZ = Math.max(sz, ez);
  return {
    edge,
    sx,
    sy,
    sz,
    vx,
    vy,
    vz,
    lenSq: vx * vx + vy * vy + vz * vz,
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
  };
}

export function isSkeletonGraphConnected(): boolean {
  return GAME_CONFIG.world.skeletonMacroCellsPerAxis > 1;
}

function connectedMacroCoords(coord: ChunkCoord, seed: number): ChunkCoord[] {
  const wrapped = wrapSkeletonCoord(coord);
  const result: ChunkCoord[] = [];
  const index = linearIndex(wrapped);
  const total = skeletonTotalCells();
  result.push(coordFromLinearIndex((index + 1) % total));
  result.push(coordFromLinearIndex((index - 1 + total) % total));
  result.push(wrapSkeletonCoord({ x: wrapped.x + 1, y: wrapped.y, z: wrapped.z }));
  result.push(wrapSkeletonCoord({ x: wrapped.x, y: wrapped.y + 1, z: wrapped.z }));
  result.push(wrapSkeletonCoord({ x: wrapped.x, y: wrapped.y, z: wrapped.z + 1 }));
  for (const axis of ['x', 'y', 'z'] as const) {
    const next = { ...wrapped };
    next[axis] += 1;
    const candidate = wrapSkeletonCoord(next);
    if (seededUnit(seed, canonicalCoord(wrapped, candidate), axisSalt(axis)) < GAME_CONFIG.world.skeletonLoopProbability) {
      result.push(candidate);
    }
  }
  return uniqueCoords(result);
}

function isWrappedBackbone(a: ChunkCoord, b: ChunkCoord): boolean {
  const max = GAME_CONFIG.world.skeletonMacroCellsPerAxis - 1;
  return (
    (a.x === 0 && b.x === max) || (a.x === max && b.x === 0) ||
    (a.y === 0 && b.y === max) || (a.y === max && b.y === 0) ||
    (a.z === 0 && b.z === max) || (a.z === max && b.z === 0)
  );
}

function wrapSkeletonCoord(coord: ChunkCoord): ChunkCoord {
  const size = GAME_CONFIG.world.skeletonMacroCellsPerAxis;
  return {
    x: wrapIndex(coord.x, size),
    y: wrapIndex(coord.y, size),
    z: wrapIndex(coord.z, size),
  };
}

function skeletonTotalCells(): number {
  return GAME_CONFIG.world.skeletonMacroCellsPerAxis ** 3;
}

function linearIndex(coord: ChunkCoord): number {
  const size = GAME_CONFIG.world.skeletonMacroCellsPerAxis;
  const wrapped = wrapSkeletonCoord(coord);
  return (wrapped.x * size + wrapped.y) * size + wrapped.z;
}

function coordFromLinearIndex(index: number): ChunkCoord {
  const size = GAME_CONFIG.world.skeletonMacroCellsPerAxis;
  const x = Math.floor(index / (size * size));
  const rem = index - x * size * size;
  const y = Math.floor(rem / size);
  const z = rem - y * size;
  return { x, y, z };
}

function uniqueCoords(coords: ChunkCoord[]): ChunkCoord[] {
  const seen = new Set<string>();
  const result: ChunkCoord[] = [];
  for (const coord of coords) {
    const wrapped = wrapSkeletonCoord(coord);
    const key = `${wrapped.x},${wrapped.y},${wrapped.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(wrapped);
  }
  return result;
}

function seededUnit(seed: number, coord: ChunkCoord, salt: number): number {
  return hashInts(seed, salt, coord.x, coord.y, coord.z) / 0xffffffff;
}

function nodeCacheKey(seed: number, coord: ChunkCoord): string {
  return `${seed}:${coord.x},${coord.y},${coord.z}`;
}

function canonicalCoord(a: ChunkCoord, b: ChunkCoord): ChunkCoord {
  return linearIndex(a) <= linearIndex(b) ? wrapSkeletonCoord(a) : wrapSkeletonCoord(b);
}

function axisSalt(axis: 'x' | 'y' | 'z'): number {
  if (axis === 'x') return 41;
  if (axis === 'y') return 43;
  return 47;
}

function closestPointOnPreparedSegment(out: Vector3, point: Vector3, edge: SkeletonEdgeRef): Vector3 {
  if (edge.lenSq <= 0.000001) {
    return out.copy(edge.edge.a.position);
  }
  const px = unwrapAxis(point.x, edge.sx);
  const py = unwrapAxis(point.y, edge.sy);
  const pz = unwrapAxis(point.z, edge.sz);
  let t = ((px - edge.sx) * edge.vx + (py - edge.sy) * edge.vy + (pz - edge.sz) * edge.vz) / edge.lenSq;
  if (t < 0) {
    t = 0;
  } else if (t > 1) {
    t = 1;
  }
  return out.set(
    wrapAxis(edge.sx + edge.vx * t),
    wrapAxis(edge.sy + edge.vy * t),
    wrapAxis(edge.sz + edge.vz * t),
  );
}

function distanceSqToPreparedSegmentBounds(point: Vector3, edge: SkeletonEdgeRef): number {
  const px = unwrapAxis(point.x, edge.sx);
  const py = unwrapAxis(point.y, edge.sy);
  const pz = unwrapAxis(point.z, edge.sz);
  const dx = axisDistanceToRange(px, edge.minX, edge.maxX);
  const dy = axisDistanceToRange(py, edge.minY, edge.maxY);
  const dz = axisDistanceToRange(pz, edge.minZ, edge.maxZ);
  return dx * dx + dy * dy + dz * dz;
}

function axisDistanceToRange(value: number, min: number, max: number): number {
  if (value < min) {
    return min - value;
  }
  if (value > max) {
    return value - max;
  }
  return 0;
}

function wrappedDistanceSq(a: Vector3, b: Vector3): number {
  const dx = axisDelta(a.x, b.x);
  const dy = axisDelta(a.y, b.y);
  const dz = axisDelta(a.z, b.z);
  return dx * dx + dy * dy + dz * dz;
}

function unwrapAxis(value: number, reference: number): number {
  let result = value;
  const delta = result - reference;
  if (delta > WORLD_SIZE * 0.5) {
    result -= WORLD_SIZE;
  } else if (delta < -WORLD_SIZE * 0.5) {
    result += WORLD_SIZE;
  }
  return result;
}

function wrapAxis(value: number): number {
  return ((value % WORLD_SIZE) + WORLD_SIZE) % WORLD_SIZE;
}

function axisDelta(from: number, to: number): number {
  let delta = to - from;
  if (delta > WORLD_SIZE * 0.5) {
    delta -= WORLD_SIZE;
  } else if (delta < -WORLD_SIZE * 0.5) {
    delta += WORLD_SIZE;
  }
  return delta;
}

function wrapIndex(value: number, size: number): number {
  return ((value % size) + size) % size;
}
