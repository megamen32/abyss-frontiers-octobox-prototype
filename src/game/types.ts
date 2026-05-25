import { Vector3 } from 'three';

export type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
export type ObstacleType = 'sphere' | 'box';
export type ObstacleMotion = 'static' | 'slow_rotate' | 'linear_drift';
export type CellKind = 'free' | 'obstacle' | 'empty';

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
}

export interface InputState {
  forward: number;
  right: number;
  vertical: number;
  boost: boolean;
  restartPressed: boolean;
  debugTogglePressed: boolean;
}

export interface CameraState {
  yaw: number;
  pitch: number;
}

export interface PlayerState {
  position: Vector3;
  velocity: Vector3;
  lookDirection: Vector3;
  speed: number;
  radius: number;
  hp: number;
  loot: number;
  alive: boolean;
  invulnerabilityTimer: number;
}
