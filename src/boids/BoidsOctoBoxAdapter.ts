import { Vector3 } from 'three'
import type { ChunkData, LeafCell } from '../game/types'
import type { BoidWorldCell } from './BoidsTypes'
import { aabbCenter, aabbSize, chunkKey, worldToChunkCoord } from '../game/utils/chunk'
import { shortestWrappedDelta } from '../game/utils/worldTopology'
import { buildWorldFieldCache, sampleCachedWorldField, type WorldFieldCache } from '../game/content/worldFieldCache'

export class BoidsOctoBoxAdapter {
  private chunks = new Map<string, ChunkData>()
  private cellCache = new Map<string, { cell: LeafCell; chunkKey: string }>()
  private worldCells: BoidWorldCell[] = []
  private cellIdMap = new Map<string, number>()
  private adjacencyMap = new Map<string, Set<string>>()
  private fieldCaches = new Map<string, WorldFieldCache>()
  private chunkCellIds = new Map<string, number[]>()
  private dirty = true

  syncChunks(added: ChunkData[], removed: string[]): boolean {
    if (added.length === 0 && removed.length === 0) return false
    for (const key of removed) {
      this.chunks.delete(key)
      this.fieldCaches.delete(key)
    }
    for (const chunk of added) {
      this.chunks.set(chunk.key, chunk)
    }
    this.dirty = true
    return true
  }

  rebuild(): void {
    if (!this.dirty) return
    this.dirty = false

    this.cellCache.clear()
    this.worldCells = []
    this.cellIdMap.clear()
    this.adjacencyMap.clear()
    this.chunkCellIds.clear()

    let cellIndex = 0
    for (const [chunkKey, chunk] of this.chunks) {
      let cache = this.fieldCaches.get(chunkKey)
      if (!cache) {
        cache = buildWorldFieldCache(chunk.bounds, chunk.seed)
        this.fieldCaches.set(chunkKey, cache)
      }
      const chunkCells: number[] = []
      this.fieldCaches.set(chunkKey, cache)
      for (const cell of chunk.cells) {
        if (cell.kind !== 'free') continue
        const globalId = `${chunkKey}:${cell.id}`
        this.cellCache.set(globalId, { cell, chunkKey })
        this.cellIdMap.set(globalId, cellIndex)

        const center = aabbCenter(cell.bounds)
        const size = aabbSize(cell.bounds)
        const openness = Math.min(size.x, size.y, size.z) / Math.max(size.x, size.y, size.z, 1)

        const field = sampleCachedWorldField(cache, center)
        const flow = field.avoidance

        this.worldCells.push({
          id: cellIndex,
          boundsMin: cell.bounds.min.clone(),
          boundsMax: cell.bounds.max.clone(),
          flow,
          openness,
          danger: field.danger,
          targetDensity: Math.floor(openness * 15) + 3,
          maxDensity: Math.floor(openness * 30) + 5,
          isFree: true,
          connectedNeighborIds: [],
        })
        chunkCells.push(cellIndex)

        if (!this.adjacencyMap.has(globalId)) {
          this.adjacencyMap.set(globalId, new Set())
        }

        cellIndex++
      }
      this.chunkCellIds.set(chunkKey, chunkCells)
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
      const delta = shortestWrappedDelta(center, new Vector3(cx, cy, cz))
      const dx = delta.x
      const dy = delta.y
      const dz = delta.z
      return dx * dx + dy * dy + dz * dz <= r2
    })
  }

  findCellByPosition(position: Vector3): number {
    this.rebuild()
    const ids = this.chunkCellIds.get(chunkKey(worldToChunkCoord(position))) ?? this.allCellIds()
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      const c = this.worldCells[id]
      if (!c.isFree) continue
      if (
        position.x >= c.boundsMin.x && position.x <= c.boundsMax.x &&
        position.y >= c.boundsMin.y && position.y <= c.boundsMax.y &&
        position.z >= c.boundsMin.z && position.z <= c.boundsMax.z
      ) {
        return id
      }
    }
    return -1
  }

  private allCellIds(): number[] {
    const ids: number[] = []
    for (let i = 0; i < this.worldCells.length; i++) ids.push(i)
    return ids
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
    this.fieldCaches.clear()
    this.chunkCellIds.clear()
  }
}
