import { Vector3 } from 'three';

export type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
export type ObstacleType = 'sphere' | 'box';
export type ObstacleMotion = 'static' | 'slow_rotate' | 'linear_drift';
export type CellKind = 'free' | 'obstacle' | 'empty';
export type GenerationMode = 'scatter' | 'cave';
export type MineState = 'idle' | 'targeting' | 'launched' | 'dead';

export interface ChunkCoord {
  x: number;
  y: number;
  z: number;
}

export interface AABB {
  min: Vector3;
  max: Vector3;
}

export interface Portal {
  id: string;
  face: Face;
  center: Vector3;
  radius: number;
  bounds: AABB;
  neighbor: ChunkCoord;
}

export interface LeafCell {
  id: string;
  depth: number;
  bounds: AABB;
  kind: CellKind;
  caveBias: number;
}

export interface Obstacle {
  id: string;
  type: ObstacleType;
  motion: ObstacleMotion;
  bounds: AABB;
  position: Vector3;
  basePosition: Vector3;
  radius?: number;
  size?: Vector3;
  damage: number;
  cellId: string;
  axis: Vector3;
  angularSpeed: number;
  driftAmplitude: number;
  phase: number;
}

export interface Loot {
  id: string;
  type: 'coin' | 'chest';
  position: Vector3;
  radius: number;
  value: number;
  collected: boolean;
  cellId: string;
}

export interface Mine {
  id: string;
  originChunkKey: string;
  anchorCellId: string;
  position: Vector3;
  velocity: Vector3;
  radius: number;
  triggerRadius: number;
  speed: number;
  damage: number;
  state: MineState;
  armed: boolean;
  targetPosition: Vector3 | null;
  telegraphTimer: number;
}

export interface ChunkData {
  key: string;
  coord: ChunkCoord;
  seed: number;
  bounds: AABB;
  cells: LeafCell[];
  portals: Portal[];
  adjacency: [string, string][];
  obstacles: Obstacle[];
  loot: Loot[];
  mines: Mine[];
}

export interface ChunkSyncResult {
  added: ChunkData[];
  removed: string[];
  currentCoord: ChunkCoord;
}

export interface ChunkBuildTimings {
  totalMs: number;
  octoboxMs: number;
  navigationMs: number;
  obstaclesMs: number;
  lootMs: number;
  minesMs: number;
  serializeMs: number;
}

export interface DebugTimingSnapshot {
  frameMs: number;
  inputMs: number;
  simulationMs: number;
  chunkSyncMs: number;
  worldMs: number;
  renderMs: number;
  renderSpawnQueueMs: number;
  renderChunkUpdateMs: number;
  renderDebugMs: number;
  renderHudCameraMs: number;
  renderDrawMs: number;
  hydrateMs: number;
  readyQueueMs: number;
  workerTotalMs: number;
  workerOctoboxMs: number;
  workerSerializeMs: number;
  drawCalls: number;
  drawTriangles: number;
  drawLines: number;
  drawPoints: number;
}

export interface InputState {
  forward: number;
  right: number;
  vertical: number;
  boost: boolean;
  accelerationAdjust: number;
  dragAdjust: number;
  turnAdjust: number;
  restartPressed: boolean;
  debugTogglePressed: boolean;
  chunkDebugTogglePressed: boolean;
  fogTogglePressed: boolean;
}

export interface CameraState {
  yaw: number;
  pitch: number;
  lastManualLookAt: number;
}

export interface PlayerState {
  position: Vector3;
  previousPosition: Vector3;
  velocity: Vector3;
  forward: Vector3;
  thrustForward: Vector3;
  targetThrustForward: Vector3;
  speed: number;
  stallAmount: number;
  radius: number;
  hp: number;
  loot: number;
  alive: boolean;
  invulnerabilityTimer: number;
}
