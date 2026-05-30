import type { Vector3 } from 'three'

export type BoidVisualType = 'fish' | 'drone' | 'plankton' | 'triangle'

export interface BoidsFollowPredictor {
  predict(t: number): Vector3
}

/** Per-type soft attractor ahead of the ship.
 *  Each boid oscillates its personal target distance between
 *  [minSeconds * shipSpeed … maxSeconds * shipSpeed] using its seed as phase.
 *  period controls how slowly the boid drifts between near and far.
 *  weight is how strongly the attractor pulls relative to flocking forces.
 *  Set weight = 0 to disable (ambient fish that ignore the ship direction).
 */
export interface FollowTargetConfig {
  minSeconds: number   // closest target distance expressed as travel-seconds
  maxSeconds: number   // farthest target distance
  period: number       // oscillation period in seconds
  spread: number       // lateral spread radius around the target point
  weight: number       // force weight (0 = disabled)
}

/** Pairwise interaction weights from one boid type toward another.
 *  This is the cheap ABZU-style control surface: one shared neighbor query,
 *  then different responses per type pair.
 */
export interface BoidTypeInteraction {
  separation: number
  alignment: number
  cohesion: number
  pursuit: number
  flee: number
  ignore: boolean
}

export interface BoidTypeConfig {
  typeId: number
  name: string
  targetCount: number
  // movement
  maxSpeed: number
  minSpeed: number
  maxForce: number
  turnRate: number
  // perception
  perceptionRadius: number
  separationRadius: number
  // flocking weights
  separationWeight: number
  alignmentWeight: number
  cohesionWeight: number
  wallAvoidanceWeight: number
  flowWeight: number
  playerAvoidanceWeight: number
  avoidPlayerRadius: number
  // optional soft attractor ahead of the ship (null = no follow)
  followTarget: FollowTargetConfig | null
  // visual
  scale: number
  color: number
  emissiveStrength: number
  scaleVariation: number
}

export interface BoidLODConfig {
  nearDistance: number
  midDistance: number
  farDistance: number
  cullDistance: number
}

export type BoidSimLevel = 'full' | 'cluster' | 'pooled' | 'culled'
export type BoidShaderLod = 'near' | 'cluster' | 'hidden'

export interface BoidCluster {
  id: number
  center: [number, number, number]
  velocity: [number, number, number]
  count: number
  spread: number
  seed: number
  lastFullSolveFrame: number
}

export interface DormantBoidGroup {
  chunkId: string
  species: 'companionFish' | 'smallShip' | 'ambient'
  count: number
  seed: number
  lastKnownCenter: [number, number, number]
  trendVelocity: [number, number, number]
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
  forceCPU?: boolean
  cpuUpdateStride?: number
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
  interactions: BoidTypeInteraction[][]
}

export enum BoidFlags {
  ACTIVE = 0,
  SPAWNING = 1,
  DESPAWNING = 2,
  SLEEPING = 3,
  DEAD = 4,
  KINEMATIC = 5,
}

export enum BoidBehavior {
  NONE = 0,
  IDLE = 1,
  TARGETING = 2,
  ROCKET = 3,
  LAUNCHED = 4,
}

export interface BoidState {
  position: [number, number, number]
  velocity: [number, number, number]
  seed: number
  typeId: number
  simLevel?: BoidSimLevel
  clusterId?: number
  behavior: BoidBehavior
  stateTimer: number
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
  neighborSearchMs: number
  steeringMs: number
  avoidanceMs: number
  integrationMs: number
  mineUpdateMs: number
  spawnCount: number
  despawnCount: number
  avgNeighbors: number
  neighborResultAllocations: number
  heavyUpdates: number
  cheapUpdates: number
  boidsFullCount: number
  boidsClusterCount: number
  boidsPooledCount: number
  boidsCulledCount: number
  activeClusterCount: number
  clusterSplits: number
  clusterMerges: number
  boidsSkippedFrames: number
  boidsEffectiveUpdateHz: number
  boidsCollisionQueries: number
  boidsShaderLodCounts: {
    near: number
    cluster: number
    hidden: number
  }
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
