import type { BoidState } from './BoidsTypes'
import { WORLD_SIZE } from '../game/utils/worldTopology'

export class BoidsSpatialGrid {
  private invCellSize: number
  private worldCellCount: number
  private cells = new Map<number, number[]>()

  constructor(_cellSize: number) {
    this.invCellSize = 1 / _cellSize
    this.worldCellCount = Math.ceil(WORLD_SIZE / _cellSize)
  }

  clear(): void {
    this.cells.clear()
  }

  insert(boidIndex: number, position: [number, number, number]): number {
    const key = this.cellKey(position[0], position[1], position[2])
    let cell = this.cells.get(key)
    if (!cell) {
      cell = []
      this.cells.set(key, cell)
    }
    cell.push(boidIndex)
    return key
  }

  queryNeighbors(
    position: [number, number, number],
    radius: number,
    boids: BoidState[],
    excludeIndex: number,
    maxResults: number,
    connectedCellIds: Set<number> | null,
  ): number[] {
    const results: number[] = []
    const r2 = radius * radius
    const inv = this.invCellSize
    const cx = Math.floor(position[0] * inv)
    const cy = Math.floor(position[1] * inv)
    const cz = Math.floor(position[2] * inv)
    const range = Math.ceil(radius * inv) + 1

    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        for (let dz = -range; dz <= range; dz++) {
          const key = this.packCell(cx + dx, cy + dy, cz + dz)
          const cell = this.cells.get(key)
          if (!cell) continue

          for (let i = 0; i < cell.length; i++) {
            const idx = cell[i]
            if (idx === excludeIndex) continue
            const other = boids[idx]
            const ddx = shortestAxisDelta(position[0], other.position[0])
            const ddy = shortestAxisDelta(position[1], other.position[1])
            const ddz = shortestAxisDelta(position[2], other.position[2])
            const dist2 = ddx * ddx + ddy * ddy + ddz * ddz
            if (dist2 > r2) continue
            if (connectedCellIds !== null && other.cellId >= 0 && !connectedCellIds.has(other.cellId)) continue
            results.push(idx)
            if (results.length >= maxResults) return results
          }
        }
      }
    }

    return results
  }

  getCellCount(): number {
    return this.cells.size
  }

  private cellKey(x: number, y: number, z: number): number {
    return this.packCell(Math.floor(x * this.invCellSize), Math.floor(y * this.invCellSize), Math.floor(z * this.invCellSize))
  }

  private packCell(cx: number, cy: number, cz: number): number {
    const x = wrapCell(cx, this.worldCellCount)
    const y = wrapCell(cy, this.worldCellCount)
    const z = wrapCell(cz, this.worldCellCount)
    return (x * this.worldCellCount + y) * this.worldCellCount + z
  }
}

function wrapCell(value: number, size: number): number {
  return ((value % size) + size) % size
}

function shortestAxisDelta(from: number, to: number): number {
  let delta = to - from
  if (delta > WORLD_SIZE * 0.5) {
    delta -= WORLD_SIZE
  } else if (delta < -WORLD_SIZE * 0.5) {
    delta += WORLD_SIZE
  }
  return delta
}
