import { Vector3 } from 'three';
import type { ChunkData, ChunkCoord, LeafCell, Loot, Obstacle, Portal } from '../types';

export interface SerializedChunkData {
  key: string;
  coord: ChunkCoord;
  seed: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  cells: Array<{
    id: string;
    depth: number;
    kind: LeafCell['kind'];
    bounds: { min: [number, number, number]; max: [number, number, number] };
  }>;
  portals: Array<{
    id: string;
    face: Portal['face'];
    center: [number, number, number];
    radius: number;
    bounds: { min: [number, number, number]; max: [number, number, number] };
    neighbor: ChunkCoord;
  }>;
  adjacency: [string, string][];
  obstacles: Array<{
    id: string;
    type: Obstacle['type'];
    motion: Obstacle['motion'];
    bounds: { min: [number, number, number]; max: [number, number, number] };
    position: [number, number, number];
    basePosition: [number, number, number];
    radius?: number;
    size?: [number, number, number];
    damage: number;
    cellId: string;
    axis: [number, number, number];
    angularSpeed: number;
    driftAmplitude: number;
    phase: number;
  }>;
  loot: Array<{
    id: string;
    type: Loot['type'];
    position: [number, number, number];
    radius: number;
    value: number;
    collected: boolean;
    cellId: string;
  }>;
}

export function dehydrateChunk(chunk: ChunkData): SerializedChunkData {
  return {
    key: chunk.key,
    coord: chunk.coord,
    seed: chunk.seed,
    bounds: dehydrateBounds(chunk.bounds),
    cells: chunk.cells.map((cell) => ({
      id: cell.id,
      depth: cell.depth,
      kind: cell.kind,
      bounds: dehydrateBounds(cell.bounds),
    })),
    portals: chunk.portals.map((portal) => ({
      id: portal.id,
      face: portal.face,
      center: vecToTuple(portal.center),
      radius: portal.radius,
      bounds: dehydrateBounds(portal.bounds),
      neighbor: portal.neighbor,
    })),
    adjacency: chunk.adjacency,
    obstacles: chunk.obstacles.map((obstacle) => ({
      id: obstacle.id,
      type: obstacle.type,
      motion: obstacle.motion,
      bounds: dehydrateBounds(obstacle.bounds),
      position: vecToTuple(obstacle.position),
      basePosition: vecToTuple(obstacle.basePosition),
      radius: obstacle.radius,
      size: obstacle.size ? vecToTuple(obstacle.size) : undefined,
      damage: obstacle.damage,
      cellId: obstacle.cellId,
      axis: vecToTuple(obstacle.axis),
      angularSpeed: obstacle.angularSpeed,
      driftAmplitude: obstacle.driftAmplitude,
      phase: obstacle.phase,
    })),
    loot: chunk.loot.map((item) => ({
      id: item.id,
      type: item.type,
      position: vecToTuple(item.position),
      radius: item.radius,
      value: item.value,
      collected: item.collected,
      cellId: item.cellId,
    })),
  };
}

export function hydrateChunk(data: SerializedChunkData): ChunkData {
  return {
    key: data.key,
    coord: data.coord,
    seed: data.seed,
    bounds: hydrateBounds(data.bounds),
    cells: data.cells.map((cell) => ({
      id: cell.id,
      depth: cell.depth,
      kind: cell.kind,
      bounds: hydrateBounds(cell.bounds),
    })),
    portals: data.portals.map((portal) => ({
      id: portal.id,
      face: portal.face,
      center: tupleToVec(portal.center),
      radius: portal.radius,
      bounds: hydrateBounds(portal.bounds),
      neighbor: portal.neighbor,
    })),
    adjacency: data.adjacency,
    obstacles: data.obstacles.map((obstacle) => ({
      id: obstacle.id,
      type: obstacle.type,
      motion: obstacle.motion,
      bounds: hydrateBounds(obstacle.bounds),
      position: tupleToVec(obstacle.position),
      basePosition: tupleToVec(obstacle.basePosition),
      radius: obstacle.radius,
      size: obstacle.size ? tupleToVec(obstacle.size) : undefined,
      damage: obstacle.damage,
      cellId: obstacle.cellId,
      axis: tupleToVec(obstacle.axis),
      angularSpeed: obstacle.angularSpeed,
      driftAmplitude: obstacle.driftAmplitude,
      phase: obstacle.phase,
    })),
    loot: data.loot.map((item) => ({
      id: item.id,
      type: item.type,
      position: tupleToVec(item.position),
      radius: item.radius,
      value: item.value,
      collected: item.collected,
      cellId: item.cellId,
    })),
  };
}

function dehydrateBounds(bounds: ChunkData['bounds']): { min: [number, number, number]; max: [number, number, number] } {
  return {
    min: vecToTuple(bounds.min),
    max: vecToTuple(bounds.max),
  };
}

function hydrateBounds(bounds: { min: [number, number, number]; max: [number, number, number] }) {
  return {
    min: tupleToVec(bounds.min),
    max: tupleToVec(bounds.max),
  };
}

function vecToTuple(vector: Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function tupleToVec(tuple: [number, number, number]): Vector3 {
  return new Vector3(tuple[0], tuple[1], tuple[2]);
}
