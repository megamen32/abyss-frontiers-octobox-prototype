import { Vector3 } from 'three'
import type { ChunkData, LeafCell } from '../game/types'
import type { BoidWorldCell } from './BoidsTypes'
import { aabbCenter, aabbSize } from '../game/utils/chunk'

export class BoidsOctoBoxAdapter {
  private chunks = new Map<string, ChunkData>()
  private cellCache = new Map<string, { cell: LeafCell; chunkKey: string }>()
  private worldCells: BoidWorldCell[] = []
  private cellIdMap = new Map<string, number>()
  private adjacencyMap = new Map<string, Set<string>>()
  private dirty = true

  syncChunks(added: ChunkData[], removed: string[]): void {
    for (const key of removed) {
      this.chunks.delete(key)
    }
    for (const chunk of added) {
      this.chunks.set(chunk.key, chunk)
    }
    this.dirty = true
  }

  rebuild(): void {
    if (!this.dirty) return
    this.dirty = false

    this.cellCache.clear()
    this.worldCells = []
    this.cellIdMap.clear()
    this.adjacencyMap.clear()

    let cellIndex = 0
    for (const [chunkKey, chunk] of this.chunks) {
      for (const cell of chunk.cells) {
        if (cell.kind !== 'free') continue
        const globalId = `${chunkKey}:${cell.id}`
        this.cellCache.set(globalId, { cell, chunkKey })
        this.cellIdMap.set(globalId, cellIndex)

        const center = aabbCenter(cell.bounds)
        const size = aabbSize(cell.bounds)
        const openness = Math.min(size.x, size.y, size.z) / Math.max(size.x, size.y, size.z, 1)

        const flow = new Vector3()
        flow.copy(cell.bounds.max).add(cell.bounds.min).multiplyScalar(0.5)
        flow.y -= center.y
        flow.normalize().multiplyScalar(0.5)

        this.worldCells.push({
          id: cellIndex,
          boundsMin: cell.bounds.min.clone(),
          boundsMax: cell.bounds.max.clone(),
          flow,
          openness,
          danger: 0,
          targetDensity: Math.floor(openness * 15) + 3,
          maxDensity: Math.floor(openness * 30) + 5,
          isFree: true,
          connectedNeighborIds: [],
        })

        if (!this.adjacencyMap.has(globalId)) {
          this.adjacencyMap.set(globalId, new Set())
        }

        cellIndex++
      }
    }

    for (const [, chunk] of this.chunks) {
      for (const [a, b] of chunk.adjacency) {
        const aGlobal = `${chunk.key}:${a}`
        const bGlobal = `${chunk.key}:${b}`
        if (this.adjacencyMap.has(aGlobal)) {
          this.adjacencyMap.get(aGlobal)!.add(bGlobal)
        }
        if (this.adjacencyMap.has(bGlobal)) {
          this.adjacencyMap.get(bGlobal)!.add(aGlobal)
        }
      }
    }

    for (const [globalId, neighbors] of this.adjacencyMap) {
      const cellId = this.cellIdMap.get(globalId)
      if (cellId === undefined) continue
      const neighborIds: number[] = []
      for (const nId of neighbors) {
        const nCellId = this.cellIdMap.get(nId)
        if (nCellId !== undefined) neighborIds.push(nCellId)
      }
      this.worldCells[cellId].connectedNeighborIds = neighborIds
    }
  }

  getActiveBoidCells(center: Vector3, radius: number): BoidWorldCell[] {
    this.rebuild()
    const r2 = radius * radius
    return this.worldCells.filter(c => {
      const cx = (c.boundsMin.x + c.boundsMax.x) * 0.5
      const cy = (c.boundsMin.y + c.boundsMax.y) * 0.5
      const cz = (c.boundsMin.z + c.boundsMax.z) * 0.5
      const dx = cx - center.x
      const dy = cy - center.y
      const dz = cz - center.z
      return dx * dx + dy * dy + dz * dz <= r2
    })
  }

  findCellByPosition(position: Vector3): number {
    this.rebuild()
    for (let i = 0; i < this.worldCells.length; i++) {
      const c = this.worldCells[i]
      if (!c.isFree) continue
      if (
        position.x >= c.boundsMin.x && position.x <= c.boundsMax.x &&
        position.y >= c.boundsMin.y && position.y <= c.boundsMax.y &&
        position.z >= c.boundsMin.z && position.z <= c.boundsMax.z
      ) {
        return i
      }
    }
    return -1
  }

  getConnectedNeighborCellIds(cellId: number): number[] {
    if (cellId < 0 || cellId >= this.worldCells.length) return []
    return this.worldCells[cellId].connectedNeighborIds
  }

  getCellBounds(cellId: number): { min: Vector3; max: Vector3 } | null {
    if (cellId < 0 || cellId >= this.worldCells.length) return null
    const c = this.worldCells[cellId]
    return { min: c.boundsMin, max: c.boundsMax }
  }

  getCellFlow(cellId: number): Vector3 {
    if (cellId < 0 || cellId >= this.worldCells.length) return new Vector3()
    return this.worldCells[cellId].flow
  }

  getCellDanger(cellId: number): number {
    if (cellId < 0 || cellId >= this.worldCells.length) return 1
    return this.worldCells[cellId].danger
  }

  isCellFree(cellId: number): boolean {
    if (cellId < 0 || cellId >= this.worldCells.length) return false
    return this.worldCells[cellId].isFree
  }

  getCellCount(): number {
    return this.worldCells.length
  }

  getWorldCells(): readonly BoidWorldCell[] {
    return this.worldCells
  }

  dispose(): void {
    this.chunks.clear()
    this.cellCache.clear()
    this.worldCells = []
    this.cellIdMap.clear()
    this.adjacencyMap.clear()
  }
}
