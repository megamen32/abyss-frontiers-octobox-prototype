import { MathUtils, Vector3 } from 'three';
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

const _nearest = new Vector3();
const _candidate = new Vector3();

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
  return {
    id: linearIndex(wrapped),
    coord: wrapped,
    position: wrapPosition(center),
    radius: GAME_CONFIG.world.chunkSize * (0.75 + seededUnit(seed, wrapped, 19) * 0.5),
  };
}

export function skeletonEdgesForMacroCoord(coord: ChunkCoord, seed: number): SkeletonEdge[] {
  const node = skeletonNodeAt(coord, seed);
  const result: SkeletonEdge[] = [];
  for (const other of connectedMacroCoords(coord, seed)) {
    const otherNode = skeletonNodeAt(other, seed);
    if (node.id <= otherNode.id || isWrappedBackbone(coord, other)) {
      result.push({
        a: node,
        b: otherNode,
        radius: GAME_CONFIG.world.chunkSize * (0.45 + seededUnit(seed, canonicalCoord(node.coord, otherNode.coord), 29) * 0.3),
      });
    }
  }
  return result;
}

export function sampleWorldSkeleton(position: Vector3, seed: number): WorldSkeletonSample {
  const macro = skeletonMacroCoordForPosition(position);
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  let bestRadius = GAME_CONFIG.world.chunkSize * 3;
  _nearest.copy(position);

  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        const coord = wrapSkeletonCoord({ x: macro.x + x, y: macro.y + y, z: macro.z + z });
        const node = skeletonNodeAt(coord, seed);
        considerPoint(position, node.position, node.radius);
        const edges = skeletonEdgesForMacroCoord(coord, seed);
        for (const edge of edges) {
          closestPointOnWrappedSegment(_candidate, position, edge.a.position, edge.b.position);
          considerPoint(position, _candidate, edge.radius);
        }
      }
    }
  }

  return {
    nearestPoint: _nearest.clone(),
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

function canonicalCoord(a: ChunkCoord, b: ChunkCoord): ChunkCoord {
  return linearIndex(a) <= linearIndex(b) ? wrapSkeletonCoord(a) : wrapSkeletonCoord(b);
}

function axisSalt(axis: 'x' | 'y' | 'z'): number {
  if (axis === 'x') return 41;
  if (axis === 'y') return 43;
  return 47;
}

function closestPointOnWrappedSegment(out: Vector3, point: Vector3, start: Vector3, end: Vector3): Vector3 {
  const sx = start.x;
  const sy = start.y;
  const sz = start.z;
  const ex = unwrapAxis(end.x, sx);
  const ey = unwrapAxis(end.y, sy);
  const ez = unwrapAxis(end.z, sz);
  const px = unwrapAxis(point.x, sx);
  const py = unwrapAxis(point.y, sy);
  const pz = unwrapAxis(point.z, sz);
  const vx = ex - sx;
  const vy = ey - sy;
  const vz = ez - sz;
  const lenSq = vx * vx + vy * vy + vz * vz;
  if (lenSq <= 0.000001) {
    return out.copy(start);
  }
  const t = MathUtils.clamp(((px - sx) * vx + (py - sy) * vy + (pz - sz) * vz) / lenSq, 0, 1);
  return out.set(wrapAxis(sx + vx * t), wrapAxis(sy + vy * t), wrapAxis(sz + vz * t));
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
