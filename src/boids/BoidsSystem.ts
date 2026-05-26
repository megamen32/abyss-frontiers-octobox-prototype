import { Vector3, Color } from 'three'
import type { Object3D } from 'three'
import type { BoidsConfig, BoidsDebugStats, BoidState } from './BoidsTypes'
import { DEFAULT_BOIDS_CONFIG } from './BoidsConfig'
import { BoidsRenderer } from './BoidsRenderer'
import { BoidsCPUSimulation } from './BoidsCPUSimulation'
import { BoidsOctoBoxAdapter } from './BoidsOctoBoxAdapter'
import {
  initGPUResources,
  uploadUniforms,
  uploadBoids,
  uploadCellMetadata,
  uploadNeighborData,
  runComputePass,
  readbackPositions,
  readbackOverflow,
  disposeGPUResources,
  type BoidsGPUResources,
} from './BoidsCompute'
import type { ChunkData } from '../game/types'
import { BoidFlags } from './BoidsTypes'

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
    spawnCount: 0,
    despawnCount: 0,
    avgNeighbors: 0,
  }
  private gpuBoidsUploaded = false
  private cellDataDirty = true

  constructor(params?: Partial<BoidsConfig>) {
    this.config = { ...DEFAULT_BOIDS_CONFIG, ...params }
    this.adapter = new BoidsOctoBoxAdapter()
    this.cpuSim = new BoidsCPUSimulation(this.config, this.adapter)
    this.renderer = new BoidsRenderer(this.config)

    this.tryInitGPU()
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
    } catch {
      this.useGPU = false
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
  update(dt: number, cameraPosition: Vector3, playerPosition: Vector3): void {
    if (!this.enabled) return
    this.time += dt

    const simStart = performance.now()

    if (this.useGPU && this.gpuResources) {
      this.updateGPU(dt, cameraPosition, playerPosition)
    } else {
      this.updateCPU(dt, cameraPosition, playerPosition)
    }

    this.debugStats.simulationMs = performance.now() - simStart
  }

  private updateCPU(dt: number, cameraPosition: Vector3, playerPosition: Vector3): void {
    this.debugStats.gpuMode = false

    this.cpuSim.update(dt, playerPosition, cameraPosition)

    const renderStart = performance.now()
    const boids = this.cpuSim.getBoids()
    const visible = this.renderer.updateFromCPUStates(boids, this.time)
    this.debugStats.renderMs = performance.now() - renderStart

    const stats = this.cpuSim.getStats()
    this.debugStats.boidCount = visible
    this.debugStats.activeBoidCount = this.cpuSim.getActiveCount()
    this.debugStats.spawnCount = stats.spawnCount
    this.debugStats.despawnCount = stats.despawnCount
    this.debugStats.activeCells = this.adapter.getActiveBoidCells(playerPosition, this.config.simulationRadius).length
    this.debugStats.gridOverflow = 0
    this.debugStats.avgBoidsPerCell = this.cpuSim.getActiveCount() > 0 && this.debugStats.activeCells > 0
      ? Math.round(this.cpuSim.getActiveCount() / this.debugStats.activeCells)
      : 0
  }

  private updateGPU(dt: number, cameraPosition: Vector3, playerPosition: Vector3): void {
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
      const activeBoids: BoidState[] = []
      for (let i = 0; i < allBoids.length; i++) {
        if (allBoids[i].flags !== BoidFlags.DEAD) activeBoids.push(allBoids[i])
      }
      if (activeBoids.length > 0) {
        uploadBoids(res, activeBoids, 'A')
        this.gpuBoidsUploaded = true
        this.debugStats.activeBoidCount = activeBoids.length
      }
    }

    if (!this.gpuBoidsUploaded) {
      this.updateCPU(dt, cameraPosition, playerPosition)
      return
    }

    const activeBoids = this.debugStats.activeBoidCount

    uploadUniforms(
      res, dt, activeBoids, this.config,
      playerPosition.x, playerPosition.y, playerPosition.z,
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
    this.adapter.syncChunks(added, removed)
    this.cellDataDirty = true
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
