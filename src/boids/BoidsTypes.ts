import type { Vector3 } from 'three'

export type BoidVisualType = 'fish' | 'drone' | 'plankton' | 'triangle'

export interface BoidTypeConfig {
  typeId: number
  name: string
  maxSpeed: number
  minSpeed: number
  perceptionRadius: number
  separationRadius: number
  separationWeight: number
  alignmentWeight: number
  cohesionWeight: number
  scale: number
}

export interface BoidLODConfig {
  nearDistance: number
  midDistance: number
  farDistance: number
  cullDistance: number
}

export interface BoidVisualConfig {
  type: BoidVisualType
  scale: number
  animate: boolean
  baseColor: number
  emissiveStrength: number
  scaleVariation: number
  speedColoring: boolean
  fogAware: boolean
}

export interface BoidFallbackConfig {
  cpuMaxBoids: number
}

export interface BoidsConfig {
  enabled: boolean
  maxBoids: number
  initialBoids: number
  simulationRadius: number
  renderRadius: number
  spawnRadius: number
  despawnRadius: number
  perceptionRadius: number
  separationRadius: number
  minSpeed: number
  maxSpeed: number
  maxForce: number
  turnRate: number
  separationWeight: number
  alignmentWeight: number
  cohesionWeight: number
  wallAvoidanceWeight: number
  flowWeight: number
  playerAvoidanceWeight: number
  avoidPlayerRadius: number
  gridCellSize: number
  maxBoidsPerCell: number
  visual: BoidVisualConfig
  lod: BoidLODConfig
  fallback: BoidFallbackConfig
  boidTypes: BoidTypeConfig[]
}

export enum BoidFlags {
  ACTIVE = 0,
  SPAWNING = 1,
  DESPAWNING = 2,
  SLEEPING = 3,
  DEAD = 4,
}

export interface BoidState {
  position: [number, number, number]
  velocity: [number, number, number]
  seed: number
  typeId: number
  life: number
  cellId: number
  flags: BoidFlags
  age: number
}

export interface BoidWorldCell {
  id: number
  boundsMin: Vector3
  boundsMax: Vector3
  flow: Vector3
  openness: number
  danger: number
  targetDensity: number
  maxDensity: number
  isFree: boolean
  connectedNeighborIds: number[]
}

export interface BoidSpawnPoint {
  position: [number, number, number]
  velocity: [number, number, number]
  seed: number
  typeId: number
  cellId: number
}

export interface BoidsDebugStats {
  boidCount: number
  activeBoidCount: number
  gpuMode: boolean
  activeCells: number
  gridOverflow: number
  avgBoidsPerCell: number
  simulationMs: number
  renderMs: number
  spawnCount: number
  despawnCount: number
  avgNeighbors: number
}

export interface BoidsSystemParams {
  config: BoidsConfig
}

export interface CellMetadataGPU {
  boundsMinX: number
  boundsMinY: number
  boundsMinZ: number
  boundsMaxX: number
  boundsMaxY: number
  boundsMaxZ: number
  flowX: number
  flowY: number
  flowZ: number
  dataX: number
  dataY: number
  dataZ: number
  dataW: number
}

export interface CellNeighborRangeGPU {
  start: number
  count: number
}
