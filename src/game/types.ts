import { Vector3 } from 'three';

export type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
export type ObstacleType = 'sphere' | 'box';
export type ObstacleMotion = 'static' | 'slow_rotate' | 'linear_drift';
export type CellKind = 'free' | 'obstacle' | 'empty';
export type GenerationProfile = 'scatter' | 'tunnel_field';
export type MineState = 'idle' | 'targeting' | 'launched' | 'dead' | 'rocket';
export type GauntletType =
  | 'left_passage'
  | 'right_passage'
  | 'center_ring'
  | 'rotating_cylinders'
  | 'slalom'
  | 'squeeze'
  | 'cross_bars';

export interface CavePathNode {
  position: Vector3;
  radius: number;
}

export interface CaveTunnel {
  id: string;
  nodes: CavePathNode[];
  gauntletType: GauntletType;
  children: CaveTunnel[];
  depth: number;
}

export interface CaveSample {
  position: Vector3;
  tangent: Vector3;
  normal: Vector3;
  binormal: Vector3;
  radius: number;
}

export interface CaveCollisionSample {
  position: Vector3;
  radius: number;
  tangent: Vector3;
}

export interface CaveSystem {
  seed: number;
  entrancePosition: Vector3;
  mainTunnel: CaveTunnel;
}

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
  fieldBias: number;
}

export interface WorldFieldSample {
  density: number;
  clearance: number;
  danger: number;
  spawnWeight: number;
  profileId: GenerationProfile;
  avoidance: Vector3;
  fieldBias: number;
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
  anchorPosition?: Vector3;
}

export interface StaticChunkMeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface ChunkData {
  key: string;
  coord: ChunkCoord;
  seed: number;
  bounds: AABB;
  isCaveChunk?: boolean;
  caveEntranceCenter?: { x: number; y: number; z: number };
  caveEntranceFace?: Face;
  caveEntranceRadius?: number;
  cells: LeafCell[];
  portals: Portal[];
  adjacency: [string, string][];
  obstacles: Obstacle[];
  staticMeshData?: StaticChunkMeshData;
  staticMeshRepresentsObstacles?: boolean;
  caveCollisionSamples?: CaveCollisionSample[];
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
  octoboxFieldSampleMs?: number;
  octoboxSkeletonCandidatesTested?: number;
  octoboxSplitPointsMs?: number;
  octoboxNodesVisited?: number;
  octoboxLeavesGenerated?: number;
  octoboxMaxDepthReached?: number;
  octoboxSolidWallEarlyStops?: number;
  navigationMs: number;
  adjacencyBuildMs?: number;
  adjacencyPairsTested?: number;
  adjacencyExactChecks?: number;
  adjacencyDuplicatePairsSkipped?: number;
  adjacencyPlanesVisited?: number;
  adjacencyBucketLookups?: number;
  adjacencyMaxPlanePairs?: number;
  adjacencyMaxBucketLoad?: number;
  navigableSetMs?: number;
  portalConnectivityMs?: number;
  adjacencyEdges?: number;
  obstaclesMs: number;
  staticMeshMs: number;
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
  workerStaticMeshMs: number;
  workerSerializeMs: number;
  drawCalls: number;
  drawTriangles: number;
  drawLines: number;
  drawPoints: number;
  visibleChunks: number;
  staticMeshChunks: number;
}

export interface InputState {
  forward: number;
  right: number;
  vertical: number;
  boost: boolean;
  brake: boolean;
  accelerationAdjust: number;
  dragAdjust: number;
  turnAdjust: number;
  restartPressed: boolean;
  debugTogglePressed: boolean;
  chunkDebugTogglePressed: boolean;
  fogTogglePressed: boolean;
  debugUiTogglePressed: boolean;
  pausePressed: boolean;
  autopilotTogglePressed: boolean;
  cameraYaw: number;
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
