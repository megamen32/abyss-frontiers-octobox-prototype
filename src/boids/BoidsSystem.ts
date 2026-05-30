import { Vector3, Color } from 'three'
import type { Object3D } from 'three'
import type { BoidsConfig, BoidsDebugStats, BoidsFollowPredictor, BoidState } from './BoidsTypes'
import { BoidBehavior } from './BoidsTypes'
import { DEFAULT_BOIDS_CONFIG } from './BoidsConfig'
import { BoidsRenderer } from './BoidsRenderer'
import { BoidsCPUSimulation } from './BoidsCPUSimulation'
import { BoidsOctoBoxAdapter } from './BoidsOctoBoxAdapter'
import {
  initGPUResources,
  uploadUniforms,
  uploadBoids,
  uploadBoidSubset,
  uploadCellMetadata,
  uploadNeighborData,
  runComputePass,
  readbackPositions,
  readbackOverflow,
  disposeGPUResources,
  type BoidsGPUResources,
} from './BoidsCompute'
import type { ChunkData } from '../game/types'

export class BoidsSystem {
  private config: BoidsConfig
  private renderer: BoidsRenderer
  private adapter: BoidsOctoBoxAdapter
  private cpuSim: BoidsCPUSimulation
  private gpuResources: BoidsGPUResources | null = null
  private gpuInitializing = false
  private useGPU = false
  private enabled = true
  private pingPong = false
  private time = 0
  private debugStats: BoidsDebugStats = {
    boidCount: 0,
    activeBoidCount: 0,
    gpuMode: false,
    activeCells: 0,
    gridOverflow: 0,
    avgBoidsPerCell: 0,
    simulationMs: 0,
    renderMs: 0,
    neighborSearchMs: 0,
    steeringMs: 0,
    avoidanceMs: 0,
    integrationMs: 0,
    mineUpdateMs: 0,
    spawnCount: 0,
    despawnCount: 0,
    avgNeighbors: 0,
    neighborResultAllocations: 0,
    heavyUpdates: 0,
    cheapUpdates: 0,
    boidsFullCount: 0,
    boidsClusterCount: 0,
    boidsPooledCount: 0,
    boidsCulledCount: 0,
    activeClusterCount: 0,
    clusterSplits: 0,
    clusterMerges: 0,
    boidsSkippedFrames: 0,
    boidsEffectiveUpdateHz: 0,
    boidsCollisionQueries: 0,
    boidsShaderLodCounts: { near: 0, cluster: 0, hidden: 0 },
  }
  private gpuBoidsUploaded = false
  private cellDataDirty = true

  constructor(params?: Partial<BoidsConfig>) {
    this.config = { ...DEFAULT_BOIDS_CONFIG, ...params }
    this.adapter = new BoidsOctoBoxAdapter()
    this.cpuSim = new BoidsCPUSimulation(this.config, this.adapter)
    this.renderer = new BoidsRenderer(this.config)

    if (!this.config.forceCPU) {
      this.tryInitGPU()
    }
  }

  private async tryInitGPU(): Promise<void> {
    if (this.gpuInitializing) return
    this.gpuInitializing = true
    try {
      const res = await initGPUResources(this.config)
      if (res) {
        this.gpuResources = res
        this.useGPU = true
      }
    } catch (e) {
      this.useGPU = false
      console.warn('[Boids] WebGPU init failed, using CPU:', e)
    }
    this.gpuInitializing = false
  }

  get object3d(): Object3D {
    return this.renderer.getObject3D()
  }

  get debug(): BoidsDebugStats {
    return { ...this.debugStats }
  }

  get octoBoxAdapter(): BoidsOctoBoxAdapter {
    return this.adapter
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.renderer.setEnabled(enabled)
  }

  setFog(color: { r: number; g: number; b: number }, near: number, far: number): void {
    const c = new Color()
    c.setRGB(color.r, color.g, color.b)
    this.renderer.setFog(c, near, far)
  }
  update(
    dt: number,
    cameraPosition: Vector3,
    playerPosition: Vector3,
    playerVelocity?: Vector3,
    playerForward?: Vector3,
    predictor?: BoidsFollowPredictor,
  ): void {
    if (!this.enabled) return
    this.time += dt

    const simStart = performance.now()

    if (this.useGPU && this.gpuResources) {
      this.updateGPU(dt, cameraPosition, playerPosition, playerVelocity, playerForward, predictor)
    } else {
      this.updateCPU(dt, cameraPosition, playerPosition, playerVelocity, playerForward, predictor)
    }

    this.debugStats.simulationMs = performance.now() - simStart
  }

  private updateCPU(
    dt: number,
    cameraPosition: Vector3,
    playerPosition: Vector3,
    playerVelocity?: Vector3,
    playerForward?: Vector3,
    predictor?: BoidsFollowPredictor,
  ): void {
    this.debugStats.gpuMode = false

    this.cpuSim.update(dt, playerPosition, cameraPosition, playerVelocity, playerForward, predictor)

    const renderStart = performance.now()
    const boids = this.cpuSim.getBoids()
    const visible = this.renderer.updateFromCPUStates(boids, this.time)
    this.debugStats.renderMs = performance.now() - renderStart

    const stats = this.cpuSim.getStats()
    this.debugStats.boidCount = visible
    this.debugStats.activeBoidCount = this.cpuSim.getActiveCount()
    this.debugStats.spawnCount = stats.spawnCount
    this.debugStats.despawnCount = stats.despawnCount
    this.debugStats.neighborSearchMs = stats.neighborSearchMs
    this.debugStats.steeringMs = stats.steeringMs
    this.debugStats.avoidanceMs = stats.avoidanceMs
    this.debugStats.integrationMs = stats.integrationMs
    this.debugStats.mineUpdateMs = stats.mineUpdateMs
    this.debugStats.avgNeighbors = stats.avgNeighbors
    this.debugStats.neighborResultAllocations = stats.neighborResultAllocations
    this.debugStats.heavyUpdates = stats.heavyUpdates
    this.debugStats.cheapUpdates = stats.cheapUpdates
    this.debugStats.boidsFullCount = stats.boidsFullCount
    this.debugStats.boidsClusterCount = stats.boidsClusterCount
    this.debugStats.boidsPooledCount = stats.boidsPooledCount
    this.debugStats.boidsCulledCount = stats.boidsCulledCount
    this.debugStats.activeClusterCount = stats.activeClusterCount
    this.debugStats.clusterSplits = stats.clusterSplits
    this.debugStats.clusterMerges = stats.clusterMerges
    this.debugStats.boidsSkippedFrames = stats.boidsSkippedFrames
    this.debugStats.boidsEffectiveUpdateHz = stats.boidsEffectiveUpdateHz
    this.debugStats.boidsCollisionQueries = stats.boidsCollisionQueries
    this.debugStats.boidsShaderLodCounts = stats.boidsShaderLodCounts
    this.debugStats.activeCells = this.adapter.getActiveBoidCells(playerPosition, this.config.simulationRadius).length
    this.debugStats.gridOverflow = 0
    this.debugStats.avgBoidsPerCell = this.cpuSim.getActiveCount() > 0 && this.debugStats.activeCells > 0
      ? Math.round(this.cpuSim.getActiveCount() / this.debugStats.activeCells)
      : 0
  }

  private updateGPU(
    dt: number,
    cameraPosition: Vector3,
    playerPosition: Vector3,
    playerVelocity?: Vector3,
    playerForward?: Vector3,
    predictor?: BoidsFollowPredictor,
  ): void {
    this.debugStats.gpuMode = true

    const res = this.gpuResources!
    const activeCells = this.adapter.getActiveBoidCells(playerPosition, this.config.simulationRadius)
    this.debugStats.activeCells = activeCells.length

    if (this.cellDataDirty || activeCells.length > 0) {
      this.uploadCellData(activeCells)
      this.cellDataDirty = false
    }

    if (!this.gpuBoidsUploaded && this.cpuSim.getActiveCount() > 0) {
      const allBoids = this.cpuSim.getBoids()
      if (allBoids.length > 0) {
        uploadBoids(res, [...allBoids], 'A')
        this.gpuBoidsUploaded = true
        this.debugStats.activeBoidCount = this.cpuSim.getActiveCount()
      }
    }

    if (!this.gpuBoidsUploaded) {
      this.updateCPU(dt, cameraPosition, playerPosition, playerVelocity, playerForward, predictor)
      return
    }

    const activeBoids = this.cpuSim.getBoids().length
    this.debugStats.activeBoidCount = this.cpuSim.getActiveCount()
    const dirtyExternalBoids = this.cpuSim.consumeDirtyExternalBoids()
    if (dirtyExternalBoids.length > 0) {
      uploadBoidSubset(res, dirtyExternalBoids, 'both')
    }

    uploadUniforms(
      res, dt, activeBoids, this.config,
      playerPosition.x, playerPosition.y, playerPosition.z,
      playerVelocity?.x ?? 0,
      playerVelocity?.y ?? 0,
      playerVelocity?.z ?? 0,
      playerForward?.x ?? 0,
      playerForward?.y ?? 0,
      playerForward?.z ?? 1,
      this.time, activeCells.length,
    )

    runComputePass(res, activeBoids, this.pingPong)
    this.pingPong = !this.pingPong

    readbackPositions(res, activeBoids).then(data => {
      if (!data) return
      const renderStart = performance.now()
      const visible = this.renderer.updateFromGPUBuffer(data, activeBoids, this.time)
      this.debugStats.renderMs = performance.now() - renderStart
      this.debugStats.boidCount = visible
    })

    readbackOverflow(res).then(v => {
      this.debugStats.gridOverflow = v
    })

    this.debugStats.avgBoidsPerCell = activeBoids > 0 && activeCells.length > 0
      ? Math.round(activeBoids / activeCells.length)
      : 0
    this.debugStats.neighborSearchMs = 0
    this.debugStats.steeringMs = 0
    this.debugStats.avoidanceMs = 0
    this.debugStats.integrationMs = 0
    this.debugStats.mineUpdateMs = 0
    this.debugStats.avgNeighbors = 0
    this.debugStats.neighborResultAllocations = 0
    this.debugStats.heavyUpdates = 0
    this.debugStats.cheapUpdates = 0
    this.debugStats.boidsFullCount = activeBoids
    this.debugStats.boidsClusterCount = 0
    this.debugStats.boidsPooledCount = 0
    this.debugStats.boidsCulledCount = 0
    this.debugStats.activeClusterCount = 0
    this.debugStats.clusterSplits = 0
    this.debugStats.clusterMerges = 0
    this.debugStats.boidsSkippedFrames = 0
    this.debugStats.boidsEffectiveUpdateHz = activeBoids > 0 ? 60 : 0
    this.debugStats.boidsCollisionQueries = 0
    this.debugStats.boidsShaderLodCounts = { near: activeBoids, cluster: 0, hidden: 0 }
  }

  private uploadCellData(cells: ReturnType<typeof this.adapter.getActiveBoidCells>): void {
    if (!this.gpuResources || cells.length === 0) return

    const metadata: { boundsMin: Float32Array; boundsMax: Float32Array; flow: Float32Array; data: Float32Array }[] = []
    const ranges: { start: number; count: number }[] = []
    const ids: number[] = []

    let idOffset = 0
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]
      metadata.push({
        boundsMin: new Float32Array([c.boundsMin.x, c.boundsMin.y, c.boundsMin.z, 0]),
        boundsMax: new Float32Array([c.boundsMax.x, c.boundsMax.y, c.boundsMax.z, 0]),
        flow: new Float32Array([c.flow.x, c.flow.y, c.flow.z, 0]),
        data: new Float32Array([c.id, c.isFree ? 1 : 0, c.danger, c.openness]),
      })

      ranges.push({ start: idOffset, count: c.connectedNeighborIds.length })
      for (const nId of c.connectedNeighborIds) {
        ids.push(nId)
      }
      idOffset += c.connectedNeighborIds.length
    }

    uploadCellMetadata(this.gpuResources, metadata)
    uploadNeighborData(this.gpuResources, ranges, ids)
  }

  syncChunks(added: ChunkData[], removed: string[]): void {
    if (this.adapter.syncChunks(added, removed)) {
      this.cellDataDirty = true
    }
  }

  upsertKinematicBoid(
    id: string,
    position: Vector3,
    velocity: Vector3,
    typeId: number,
  ): void {
    const cellId = this.adapter.findCellByPosition(position)
    this.cpuSim.upsertKinematicBoid(
      id,
      position.x,
      position.y,
      position.z,
      velocity.x,
      velocity.y,
      velocity.z,
      typeId,
      cellId,
    )
  }

  removeKinematicBoid(id: string): void {
    this.cpuSim.removeKinematicBoid(id)
  }

  upsertManagedBoid(
    id: string,
    position: Vector3,
    velocity: Vector3,
    typeId: number,
    behavior: BoidBehavior,
    stateTimer: number,
  ): void {
    const cellId = this.adapter.findCellByPosition(position)
    this.cpuSim.upsertManagedBoid(
      id,
      position.x,
      position.y,
      position.z,
      velocity.x,
      velocity.y,
      velocity.z,
      typeId,
      behavior,
      stateTimer,
      cellId,
    )
  }

  updateManagedBoid(id: string, behavior: BoidBehavior, stateTimer: number): void {
    this.cpuSim.updateManagedBoid(id, behavior, stateTimer)
  }

  getManagedBoid(id: string): BoidState | null {
    return this.cpuSim.getManagedBoid(id)
  }

  removeManagedBoid(id: string): void {
    this.cpuSim.removeKinematicBoid(id)
  }

  getDebugHTML(): string {
    const s = this.debugStats
    return [
      `Boids: ${s.boidCount} / ${s.activeBoidCount}`,
      `Mode: ${s.gpuMode ? 'GPU' : 'CPU'}`,
      `Active cells: ${s.activeCells}`,
      `Grid overflow: ${s.gridOverflow}`,
      `Avg boids/cell: ${s.avgBoidsPerCell}`,
      `Sim: ${s.simulationMs.toFixed(1)}ms`,
      `Neighbor: ${s.neighborSearchMs.toFixed(1)}ms`,
      `Steer: ${s.steeringMs.toFixed(1)}ms`,
      `Avoid: ${s.avoidanceMs.toFixed(1)}ms`,
      `Integrate: ${s.integrationMs.toFixed(1)}ms`,
      `Mine: ${s.mineUpdateMs.toFixed(1)}ms`,
      `Neighbor allocs: ${s.neighborResultAllocations}`,
      `Heavy/Cheap: ${s.heavyUpdates}/${s.cheapUpdates}`,
      `LOD full/cluster/pool/cull: ${s.boidsFullCount}/${s.boidsClusterCount}/${s.boidsPooledCount}/${s.boidsCulledCount}`,
      `Clusters: ${s.activeClusterCount}`,
      `Hz: ${s.boidsEffectiveUpdateHz.toFixed(1)}`,
      `Render: ${s.renderMs.toFixed(1)}ms`,
    ].join('  |  ')
  }

  dispose(): void {
    this.cpuSim.dispose()
    this.renderer.dispose()
    this.adapter.dispose()
    if (this.gpuResources) {
      disposeGPUResources(this.gpuResources)
    }
  }
}
