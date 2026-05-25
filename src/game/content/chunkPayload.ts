import { Vector3 } from 'three';
import type { ChunkData, ChunkCoord, LeafCell, Loot, Mine, Obstacle, Portal, StaticChunkMeshData } from '../types';

export interface SerializedChunkData {
  key: string;
  coord: ChunkCoord;
  seed: number;
  isCaveChunk?: boolean;
  caveEntranceCenter?: [number, number, number];
  caveEntranceFace?: Portal['face'];
  caveEntranceRadius?: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  cells: Array<{
    id: string;
    depth: number;
    kind: LeafCell['kind'];
    caveBias: number;
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
  staticMeshData?: StaticChunkMeshData;
  staticMeshRepresentsObstacles?: boolean;
  caveCollisionSamples?: Array<{
    position: [number, number, number];
    radius: number;
    tangent: [number, number, number];
  }>;
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
  mines: Array<{
    id: string;
    originChunkKey: string;
    anchorCellId: string;
    position: [number, number, number];
    velocity: [number, number, number];
    radius: number;
    triggerRadius: number;
    speed: number;
    damage: number;
    state: Mine['state'];
    armed: boolean;
    targetPosition: [number, number, number] | null;
    telegraphTimer: number;
  }>;
}

export function dehydrateChunk(chunk: ChunkData): SerializedChunkData {
  return {
    key: chunk.key,
    coord: chunk.coord,
    seed: chunk.seed,
    isCaveChunk: chunk.isCaveChunk,
    caveEntranceCenter: chunk.caveEntranceCenter ? vecToTuple(new Vector3(chunk.caveEntranceCenter.x, chunk.caveEntranceCenter.y, chunk.caveEntranceCenter.z)) : undefined,
    caveEntranceFace: chunk.caveEntranceFace,
    caveEntranceRadius: chunk.caveEntranceRadius,
    bounds: dehydrateBounds(chunk.bounds),
    cells: chunk.cells.map((cell) => ({
      id: cell.id,
      depth: cell.depth,
      kind: cell.kind,
      caveBias: cell.caveBias,
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
    staticMeshData: chunk.staticMeshData,
    staticMeshRepresentsObstacles: chunk.staticMeshRepresentsObstacles,
    caveCollisionSamples: chunk.caveCollisionSamples?.map((sample) => ({
      position: vecToTuple(sample.position),
      radius: sample.radius,
      tangent: vecToTuple(sample.tangent),
    })),
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
    mines: chunk.mines.map((mine) => ({
      id: mine.id,
      originChunkKey: mine.originChunkKey,
      anchorCellId: mine.anchorCellId,
      position: vecToTuple(mine.position),
      velocity: vecToTuple(mine.velocity),
      radius: mine.radius,
      triggerRadius: mine.triggerRadius,
      speed: mine.speed,
      damage: mine.damage,
      state: mine.state,
      armed: mine.armed,
      targetPosition: mine.targetPosition ? vecToTuple(mine.targetPosition) : null,
      telegraphTimer: mine.telegraphTimer,
    })),
  };
}

export function hydrateChunk(data: SerializedChunkData): ChunkData {
  return {
    key: data.key,
    coord: data.coord,
    seed: data.seed,
    isCaveChunk: data.isCaveChunk,
    caveEntranceCenter: data.caveEntranceCenter ? { x: data.caveEntranceCenter[0], y: data.caveEntranceCenter[1], z: data.caveEntranceCenter[2] } : undefined,
    caveEntranceFace: data.caveEntranceFace,
    caveEntranceRadius: data.caveEntranceRadius,
    bounds: hydrateBounds(data.bounds),
    cells: data.cells.map((cell) => ({
      id: cell.id,
      depth: cell.depth,
      kind: cell.kind,
      caveBias: cell.caveBias,
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
    staticMeshData: data.staticMeshData,
    staticMeshRepresentsObstacles: data.staticMeshRepresentsObstacles,
    caveCollisionSamples: data.caveCollisionSamples?.map((sample) => ({
      position: tupleToVec(sample.position),
      radius: sample.radius,
      tangent: tupleToVec(sample.tangent),
    })),
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
    mines: data.mines.map((mine) => ({
      id: mine.id,
      originChunkKey: mine.originChunkKey,
      anchorCellId: mine.anchorCellId,
      position: tupleToVec(mine.position),
      velocity: tupleToVec(mine.velocity),
      radius: mine.radius,
      triggerRadius: mine.triggerRadius,
      speed: mine.speed,
      damage: mine.damage,
      state: mine.state,
      armed: mine.armed,
      targetPosition: mine.targetPosition ? tupleToVec(mine.targetPosition) : null,
      telegraphTimer: mine.telegraphTimer,
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
