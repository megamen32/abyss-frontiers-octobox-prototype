import type { BoidState } from './BoidsTypes'

export class BoidsSpatialGrid {
  private invCellSize: number
  private cells = new Map<number, number[]>()

  constructor(_cellSize: number) {
    this.invCellSize = 1 / _cellSize
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
            const ddx = other.position[0] - position[0]
            const ddy = other.position[1] - position[1]
            const ddz = other.position[2] - position[2]
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
    return ((cx + 50000) * 100000 + (cy + 50000)) * 100000 + (cz + 50000)
  }
}
