import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { BoidsSpatialGrid } from '../src/boids/BoidsSpatialGrid'
import { BoidsOctoBoxAdapter } from '../src/boids/BoidsOctoBoxAdapter'
import { BoidsCPUSimulation } from '../src/boids/BoidsCPUSimulation'
import { AMBIENT_FISH_TYPE, DEFAULT_BOIDS_CONFIG, MINE_TYPE } from '../src/boids/BoidsConfig'
import { BoidBehavior, BoidFlags } from '../src/boids/BoidsTypes'
import type { BoidState } from '../src/boids/BoidsTypes'
import type { ChunkData, LeafCell, AABB } from '../src/game/types'
import { WORLD_SIZE } from '../src/game/utils/worldTopology'

function makeBounds(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): AABB {
  return {
    min: new Vector3(minX, minY, minZ),
    max: new Vector3(maxX, maxY, maxZ),
  }
}

function makeChunk(
  cells: LeafCell[],
  adjacency: [string, string][] = [],
  key = '0,0,0',
): ChunkData {
  return {
    key,
    coord: { x: 0, y: 0, z: 0 },
    seed: 1,
    bounds: makeBounds(0, 0, 0, 64, 64, 64),
    cells,
    portals: [],
    adjacency,
    obstacles: [],
    loot: [],
    mines: [],
  }
}

function makeFreeCell(id: string, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): LeafCell {
  return {
    id,
    depth: 0,
    bounds: makeBounds(minX, minY, minZ, maxX, maxY, maxZ),
    kind: 'free',
    fieldBias: 0.5,
  }
}

describe('BoidsSpatialGrid', () => {
  it('inserts and queries neighbors within radius', () => {
    const grid = new BoidsSpatialGrid(18)
    const boids: BoidState[] = [
      { position: [10, 10, 10], velocity: [1, 0, 0], seed: 0, typeId: 0, behavior: BoidBehavior.NONE, stateTimer: 0, life: 1, cellId: 0, flags: BoidFlags.ACTIVE, age: 0 },
      { position: [12, 10, 10], velocity: [1, 0, 0], seed: 1, typeId: 0, behavior: BoidBehavior.NONE, stateTimer: 0, life: 1, cellId: 0, flags: BoidFlags.ACTIVE, age: 0 },
      { position: [100, 100, 100], velocity: [1, 0, 0], seed: 2, typeId: 0, behavior: BoidBehavior.NONE, stateTimer: 0, life: 1, cellId: 1, flags: BoidFlags.ACTIVE, age: 0 },
    ]

    grid.clear()
    grid.insert(0, boids[0].position)
    grid.insert(1, boids[1].position)
    grid.insert(2, boids[2].position)

    const neighbors = grid.queryNeighbors([11, 10, 10], 5, boids, -1, 10, null)
    expect(neighbors.length).toBe(2)
  })

  it('respects connected cell filter', () => {
    const grid = new BoidsSpatialGrid(18)
    const boids: BoidState[] = [
      { position: [10, 10, 10], velocity: [1, 0, 0], seed: 0, typeId: 0, behavior: BoidBehavior.NONE, stateTimer: 0, life: 1, cellId: 0, flags: BoidFlags.ACTIVE, age: 0 },
      { position: [12, 10, 10], velocity: [1, 0, 0], seed: 1, typeId: 0, behavior: BoidBehavior.NONE, stateTimer: 0, life: 1, cellId: 1, flags: BoidFlags.ACTIVE, age: 0 },
    ]

    grid.clear()
    grid.insert(0, boids[0].position)
    grid.insert(1, boids[1].position)

    const connectedOnly0 = new Set([0])
    const neighbors = grid.queryNeighbors([11, 10, 10], 5, boids, -1, 10, connectedOnly0)
    expect(neighbors.length).toBe(1)
    expect(neighbors[0]).toBe(0)
  })

  it('queries neighbors across wrapped world boundaries', () => {
    const grid = new BoidsSpatialGrid(18)
    const boids: BoidState[] = [
      { position: [WORLD_SIZE - 2, 10, 10], velocity: [1, 0, 0], seed: 0, typeId: 0, behavior: BoidBehavior.NONE, stateTimer: 0, life: 1, cellId: 0, flags: BoidFlags.ACTIVE, age: 0 },
      { position: [3, 10, 10], velocity: [1, 0, 0], seed: 1, typeId: 0, behavior: BoidBehavior.NONE, stateTimer: 0, life: 1, cellId: 0, flags: BoidFlags.ACTIVE, age: 0 },
    ]

    grid.clear()
    grid.insert(0, boids[0].position)
    grid.insert(1, boids[1].position)

    const neighbors = grid.queryNeighbors([WORLD_SIZE - 1, 10, 10], 6, boids, -1, 10, null)
    expect(neighbors.length).toBe(2)
  })

  it('returns empty for empty grid', () => {
    const grid = new BoidsSpatialGrid(18)
    grid.clear()
    const neighbors = grid.queryNeighbors([0, 0, 0], 10, [], -1, 10, null)
    expect(neighbors.length).toBe(0)
  })

  it('can reuse a caller-owned neighbor result buffer', () => {
    const grid = new BoidsSpatialGrid(18)
    const boids: BoidState[] = [
      { position: [10, 10, 10], velocity: [1, 0, 0], seed: 0, typeId: 0, behavior: BoidBehavior.NONE, stateTimer: 0, life: 1, cellId: 0, flags: BoidFlags.ACTIVE, age: 0 },
      { position: [12, 10, 10], velocity: [1, 0, 0], seed: 1, typeId: 0, behavior: BoidBehavior.NONE, stateTimer: 0, life: 1, cellId: 0, flags: BoidFlags.ACTIVE, age: 0 },
    ]
    grid.insert(0, boids[0].position)
    grid.insert(1, boids[1].position)

    const buffer = [99]
    const first = grid.queryNeighborsInto([11, 10, 10], 5, boids, -1, 10, null, buffer)
    const second = grid.queryNeighborsInto([100, 100, 100], 5, boids, -1, 10, null, buffer)
    expect(first).toBe(buffer)
    expect(second).toBe(buffer)
    expect(second.length).toBe(0)
  })

  it('inserts predicted swept occupancy for cheap LOD updates', () => {
    const grid = new BoidsSpatialGrid(18)
    const boids: BoidState[] = [
      { position: [10, 10, 10], velocity: [40, 0, 0], seed: 0, typeId: 0, behavior: BoidBehavior.NONE, stateTimer: 0, life: 1, cellId: 0, flags: BoidFlags.ACTIVE, age: 0 },
    ]

    grid.insertSwept(0, boids[0].position, boids[0].velocity, 0.5)

    const neighbors = grid.queryNeighbors([30, 10, 10], 3, boids, -1, 10, null)
    expect(neighbors).toEqual([0])
  })
})

describe('BoidsOctoBoxAdapter', () => {
  it('finds free cells and builds adjacency', () => {
    const adapter = new BoidsOctoBoxAdapter()
    const cells = [
      makeFreeCell('a', 0, 0, 0, 20, 20, 20),
      makeFreeCell('b', 20, 0, 0, 40, 20, 20),
      { id: 'c', depth: 0, bounds: makeBounds(40, 0, 0, 64, 20, 20), kind: 'obstacle' as const, fieldBias: 0.1 },
    ]
    const chunk = makeChunk(cells, [['a', 'b']])
    adapter.syncChunks([chunk], [])
    adapter.rebuild()

    const active = adapter.getActiveBoidCells(new Vector3(20, 10, 10), 100)
    expect(active.length).toBe(2)

    const cellId = adapter.findCellByPosition(new Vector3(10, 10, 10))
    expect(cellId).toBeGreaterThanOrEqual(0)

    const neighbors = adapter.getConnectedNeighborCellIds(cellId)
    expect(neighbors.length).toBe(1)
  })

  it('returns -1 for position outside any cell', () => {
    const adapter = new BoidsOctoBoxAdapter()
    adapter.syncChunks([makeChunk([makeFreeCell('a', 0, 0, 0, 10, 10, 10)])], [])
    const cellId = adapter.findCellByPosition(new Vector3(50, 50, 50))
    expect(cellId).toBe(-1)
  })

  it('returns empty neighbors for non-free cells', () => {
    const adapter = new BoidsOctoBoxAdapter()
    adapter.syncChunks([makeChunk([{ id: 'x', depth: 0, bounds: makeBounds(0, 0, 0, 10, 10, 10), kind: 'obstacle' as const, fieldBias: 0.1 }])], [])
    const active = adapter.getActiveBoidCells(new Vector3(5, 5, 5), 50)
    expect(active.length).toBe(0)
  })

  it('filters active cells by radius', () => {
    const adapter = new BoidsOctoBoxAdapter()
    const cells = [
      makeFreeCell('near', 0, 0, 0, 20, 20, 20),
      makeFreeCell('far', 200, 200, 200, 220, 220, 220),
    ]
    adapter.syncChunks([makeChunk(cells)], [])
    adapter.rebuild()

    const active = adapter.getActiveBoidCells(new Vector3(10, 10, 10), 50)
    expect(active.length).toBe(1)
  })

  it('isCellFree returns false for invalid cell id', () => {
    const adapter = new BoidsOctoBoxAdapter()
    expect(adapter.isCellFree(-1)).toBe(false)
    expect(adapter.isCellFree(999)).toBe(false)
  })

  it('getCellBounds returns null for invalid cell id', () => {
    const adapter = new BoidsOctoBoxAdapter()
    expect(adapter.getCellBounds(-1)).toBeNull()
  })
})

describe('BoidsCPUSimulation', () => {
  it('spawns boids around player position', () => {
    const config = { ...DEFAULT_BOIDS_CONFIG, maxBoids: 100, initialBoids: 50, fallback: { cpuMaxBoids: 100 } }
    const adapter = new BoidsOctoBoxAdapter()
    const cells = [makeFreeCell('a', -50, -50, -50, 50, 50, 50)]
    adapter.syncChunks([makeChunk(cells)], [])
    adapter.rebuild()

    const sim = new BoidsCPUSimulation(config, adapter)
    sim.update(0.016, new Vector3(0, 0, 0), new Vector3(0, 0, 0))

    expect(sim.getActiveCount()).toBeGreaterThan(0)
  })

  it('boids move after simulation step', () => {
    const config = { ...DEFAULT_BOIDS_CONFIG, maxBoids: 10, initialBoids: 5, fallback: { cpuMaxBoids: 10 } }
    const adapter = new BoidsOctoBoxAdapter()
    const cells = [makeFreeCell('a', -100, -100, -100, 100, 100, 100)]
    adapter.syncChunks([makeChunk(cells)], [])
    adapter.rebuild()

    const sim = new BoidsCPUSimulation(config, adapter)
    sim.update(0.016, new Vector3(0, 0, 0), new Vector3(0, 0, 0))

    const boids = sim.getBoids()
    const positionsBefore: [number, number, number][] = []
    for (let i = 0; i < boids.length; i++) {
      if (boids[i].flags !== BoidFlags.DEAD) {
        positionsBefore.push([...boids[i].position])
      }
    }

    sim.update(0.016, new Vector3(0, 0, 0), new Vector3(0, 0, 0))

    let moved = false
    let idx = 0
    for (let i = 0; i < boids.length; i++) {
      if (boids[i].flags === BoidFlags.DEAD) continue
      const dx = boids[i].position[0] - positionsBefore[idx][0]
      const dy = boids[i].position[1] - positionsBefore[idx][1]
      const dz = boids[i].position[2] - positionsBefore[idx][2]
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 0.001) moved = true
      idx++
    }
    expect(moved).toBe(true)
  })

  it('boids avoid player when close', () => {
    const config = { ...DEFAULT_BOIDS_CONFIG, maxBoids: 10, initialBoids: 5, fallback: { cpuMaxBoids: 10 }, avoidPlayerRadius: 50 }
    const adapter = new BoidsOctoBoxAdapter()
    const cells = [makeFreeCell('a', -100, -100, -100, 100, 100, 100)]
    adapter.syncChunks([makeChunk(cells)], [])
    adapter.rebuild()

    const sim = new BoidsCPUSimulation(config, adapter)
    const playerPos = new Vector3(0, 0, 0)

    for (let step = 0; step < 60; step++) {
      sim.update(0.016, playerPos, playerPos)
    }

    const boids = sim.getBoids()
    for (let i = 0; i < boids.length; i++) {
      if (boids[i].flags === BoidFlags.DEAD) continue
      const dx = boids[i].position[0] - playerPos.x
      const dy = boids[i].position[1] - playerPos.y
      const dz = boids[i].position[2] - playerPos.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      expect(dist).toBeGreaterThan(1)
    }
  })

  it('boids stay within cell bounds', () => {
    const config = { ...DEFAULT_BOIDS_CONFIG, maxBoids: 20, initialBoids: 10, fallback: { cpuMaxBoids: 20 } }
    const adapter = new BoidsOctoBoxAdapter()
    const cells = [makeFreeCell('a', -30, -30, -30, 30, 30, 30)]
    adapter.syncChunks([makeChunk(cells)], [])
    adapter.rebuild()

    const sim = new BoidsCPUSimulation(config, adapter)
    for (let step = 0; step < 120; step++) {
      sim.update(0.016, new Vector3(0, 0, 0), new Vector3(0, 0, 0))
    }

    const boids = sim.getBoids()
    for (let i = 0; i < boids.length; i++) {
      if (boids[i].flags === BoidFlags.DEAD) continue
      expect(boids[i].position[0]).toBeGreaterThanOrEqual(-31)
      expect(boids[i].position[0]).toBeLessThanOrEqual(31)
      expect(boids[i].position[1]).toBeGreaterThanOrEqual(-31)
      expect(boids[i].position[1]).toBeLessThanOrEqual(31)
      expect(boids[i].position[2]).toBeGreaterThanOrEqual(-31)
      expect(boids[i].position[2]).toBeLessThanOrEqual(31)
    }
  })

  it('keeps managed mine boids frozen when updated with zero dt', () => {
    const config = {
      ...DEFAULT_BOIDS_CONFIG,
      maxBoids: 10,
      initialBoids: 0,
      fallback: { cpuMaxBoids: 10 },
      boidTypes: [MINE_TYPE],
      interactions: [[]],
    }
    const adapter = new BoidsOctoBoxAdapter()
    const cells = [makeFreeCell('a', 0, 0, 0, 40, 40, 40)]
    adapter.syncChunks([makeChunk(cells)], [])
    adapter.rebuild()
    const sim = new BoidsCPUSimulation(config, adapter)
    sim.upsertManagedBoid('mine', 10, 10, 10, 0, 0, 0, MINE_TYPE.typeId, BoidBehavior.LAUNCHED, 0, 0)

    sim.update(0, new Vector3(12, 10, 10), new Vector3(0, 0, 0), new Vector3(0, 0, 0), new Vector3(0, 0, 1))

    const mine = sim.getManagedBoid('mine')
    expect(mine?.position).toEqual([10, 10, 10])
    expect(mine?.velocity).toEqual([0, 0, 0])
    expect(sim.getStats().mineUpdateMs).toBeGreaterThanOrEqual(0)

  })

  it('clusters visible mid-distance decorative boids without exact neighbor solves', () => {
    const config = {
      ...DEFAULT_BOIDS_CONFIG,
      maxBoids: 4,
      initialBoids: 0,
      simulationRadius: 200,
      renderRadius: 160,
      fallback: { cpuMaxBoids: 4 },
      lod: { nearDistance: 20, midDistance: 60, farDistance: 120, cullDistance: 160 },
    }
    const adapter = new BoidsOctoBoxAdapter()
    const cells = [makeFreeCell('a', -200, -200, -200, 200, 200, 200)]
    adapter.syncChunks([makeChunk(cells)], [])
    adapter.rebuild()
    const sim = new BoidsCPUSimulation(config, adapter)
    sim.upsertManagedBoid('fish', 70, 0, 0, 4, 0, 0, AMBIENT_FISH_TYPE.typeId, BoidBehavior.NONE, 0, 0)

    sim.update(1 / 60, new Vector3(0, 0, 0), new Vector3(0, 0, 0))

    const stats = sim.getStats()
    expect(stats.boidsClusterCount).toBe(1)
    expect(stats.activeClusterCount).toBe(1)
    expect(stats.heavyUpdates).toBe(0)
    expect(stats.cheapUpdates).toBe(1)
    expect(sim.getManagedBoid('fish')?.simLevel).toBe('cluster')
  })

  it('pools decorative boids outside fog instead of updating or drawing them', () => {
    const config = {
      ...DEFAULT_BOIDS_CONFIG,
      maxBoids: 4,
      initialBoids: 0,
      simulationRadius: 200,
      renderRadius: 160,
      fallback: { cpuMaxBoids: 4 },
      lod: { nearDistance: 20, midDistance: 60, farDistance: 120, cullDistance: 160 },
    }
    const adapter = new BoidsOctoBoxAdapter()
    const cells = [makeFreeCell('a', -200, -200, -200, 200, 200, 200)]
    adapter.syncChunks([makeChunk(cells)], [])
    adapter.rebuild()
    const sim = new BoidsCPUSimulation(config, adapter)
    sim.upsertManagedBoid('fish', 130, 0, 0, 4, 0, 0, AMBIENT_FISH_TYPE.typeId, BoidBehavior.NONE, 0, 0)

    sim.update(1 / 60, new Vector3(0, 0, 0), new Vector3(0, 0, 0))

    const stats = sim.getStats()
    expect(stats.boidsPooledCount).toBe(1)
    expect(stats.boidsSkippedFrames).toBe(1)
    expect(stats.heavyUpdates).toBe(0)
    expect(stats.cheapUpdates).toBe(0)
    expect(sim.getManagedBoid('fish')?.simLevel).toBe('pooled')
  })

  it('keeps gameplay-critical mines exact even outside fog', () => {
    const config = {
      ...DEFAULT_BOIDS_CONFIG,
      maxBoids: 4,
      initialBoids: 0,
      simulationRadius: 40,
      renderRadius: 80,
      fallback: { cpuMaxBoids: 4 },
      lod: { nearDistance: 10, midDistance: 20, farDistance: 40, cullDistance: 80 },
      boidTypes: [MINE_TYPE],
      interactions: [[]],
    }
    const adapter = new BoidsOctoBoxAdapter()
    const cells = [makeFreeCell('a', -200, -200, -200, 200, 200, 200)]
    adapter.syncChunks([makeChunk(cells)], [])
    adapter.rebuild()
    const sim = new BoidsCPUSimulation(config, adapter)
    sim.upsertManagedBoid('mine', 90, 0, 0, 0, 0, 0, MINE_TYPE.typeId, BoidBehavior.IDLE, 0, 0)

    sim.update(1 / 60, new Vector3(0, 0, 0), new Vector3(0, 0, 0))

    const stats = sim.getStats()
    expect(stats.boidsFullCount).toBe(1)
    expect(stats.heavyUpdates).toBe(1)
    expect(stats.boidsPooledCount + stats.boidsCulledCount).toBe(0)
    expect(sim.getManagedBoid('mine')?.simLevel).toBe('full')
  })
})

describe('BoidsConfig', () => {
  it('has valid default config values', () => {
    const c = DEFAULT_BOIDS_CONFIG
    expect(c.maxBoids).toBeGreaterThan(0)
    expect(c.initialBoids).toBeGreaterThan(0)
    expect(c.minSpeed).toBeGreaterThan(0)
    expect(c.maxSpeed).toBeGreaterThan(c.minSpeed)
    expect(c.perceptionRadius).toBeGreaterThan(0)
    expect(c.separationRadius).toBeLessThanOrEqual(c.perceptionRadius)
    expect(c.gridCellSize).toBeGreaterThan(0)
    expect(c.maxBoidsPerCell).toBeGreaterThan(0)
    expect(c.fallback.cpuMaxBoids).toBeGreaterThan(0)
    expect(c.boidTypes.length).toBeGreaterThan(0)
  })
})
