import { Vector3 } from 'three'
import type { BoidState, BoidsConfig } from './BoidsTypes'
import { BoidFlags } from './BoidsTypes'
import { BoidsSpatialGrid } from './BoidsSpatialGrid'
import { BoidsOctoBoxAdapter } from './BoidsOctoBoxAdapter'

const _v = new Vector3()
const _sep = new Vector3()
const _ali = new Vector3()
const _coh = new Vector3()
const _wall = new Vector3()
const _flow = new Vector3()
const _player = new Vector3()
const _force = new Vector3()

export class BoidsCPUSimulation {
  private boids: BoidState[]
  private grid: BoidsSpatialGrid
  private config: BoidsConfig
  private adapter: BoidsOctoBoxAdapter
  private maxBoids: number
  private activeCount = 0
  private spawnCount = 0
  private despawnCount = 0

  constructor(config: BoidsConfig, adapter: BoidsOctoBoxAdapter) {
    this.config = config
    this.adapter = adapter
    this.maxBoids = Math.min(config.maxBoids, config.fallback.cpuMaxBoids)
    this.boids = new Array(this.maxBoids)
    for (let i = 0; i < this.maxBoids; i++) {
      this.boids[i] = {
        position: [0, 0, 0],
        velocity: [0, 0, 0],
        seed: 0,
        typeId: 0,
        life: 0,
        cellId: -1,
        flags: BoidFlags.DEAD,
        age: 0,
      }
    }
    this.grid = new BoidsSpatialGrid(config.gridCellSize)
  }

  getBoids(): readonly BoidState[] {
    return this.boids
  }

  getActiveCount(): number {
    return this.activeCount
  }

  getGrid(): BoidsSpatialGrid {
    return this.grid
  }

  update(
    dt: number,
    playerPosition: Vector3,
    cameraPosition: Vector3,
  ): void {
    const cfg = this.config
    this.grid.clear()

    for (let i = 0; i < this.maxBoids; i++) {
      const b = this.boids[i]
      if (b.flags === BoidFlags.DEAD) continue

      b.age += dt

      _v.set(b.position[0], b.position[1], b.position[2])
      const distToCamera = _v.distanceTo(cameraPosition)

      if (b.flags === BoidFlags.ACTIVE && distToCamera > cfg.despawnRadius) {
        b.flags = BoidFlags.DESPAWNING
      }

      if (b.flags === BoidFlags.DESPAWNING) {
        b.life -= dt * 2
        if (b.life <= 0) {
          b.flags = BoidFlags.DEAD
          this.activeCount--
          continue
        }
      }

      if (b.flags === BoidFlags.SPAWNING) {
        b.life += dt * 2
        if (b.life >= 1) {
          b.life = 1
          b.flags = BoidFlags.ACTIVE
        }
      }

      this.grid.insert(i, b.position)
    }

    this.spawnAround(playerPosition)

    const simR2 = cfg.simulationRadius * cfg.simulationRadius

    for (let i = 0; i < this.maxBoids; i++) {
      const b = this.boids[i]
      if (b.flags === BoidFlags.DEAD || b.flags === BoidFlags.SLEEPING) continue

      _v.set(b.position[0], b.position[1], b.position[2])
      const distToPlayer = _v.distanceTo(playerPosition)
      if (distToPlayer > simR2 * 1.5) continue

      const cellId = this.adapter.findCellByPosition(_v)
      b.cellId = cellId

      const connectedIds = this.buildConnectedSet(cellId)

      const neighbors = this.grid.queryNeighbors(
        b.position,
        cfg.perceptionRadius,
        this.boids,
        i,
        50,
        connectedIds,
      )

      _sep.set(0, 0, 0)
      _ali.set(0, 0, 0)
      _coh.set(0, 0, 0)
      let count = 0

      for (let n = 0; n < neighbors.length; n++) {
        const other = this.boids[neighbors[n]]
        const dx = b.position[0] - other.position[0]
        const dy = b.position[1] - other.position[1]
        const dz = b.position[2] - other.position[2]
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

        if (dist < cfg.separationRadius && dist > 0.001) {
          _sep.x += dx / dist / dist
          _sep.y += dy / dist / dist
          _sep.z += dz / dist / dist
        }

        _ali.x += other.velocity[0]
        _ali.y += other.velocity[1]
        _ali.z += other.velocity[2]

        _coh.x += other.position[0]
        _coh.y += other.position[1]
        _coh.z += other.position[2]
        count++
      }

      if (count > 0) {
        _ali.divideScalar(count)
        const aliLen = _ali.length()
        if (aliLen > 0) _ali.divideScalar(aliLen)

        _coh.x = _coh.x / count - b.position[0]
        _coh.y = _coh.y / count - b.position[1]
        _coh.z = _coh.z / count - b.position[2]
        const cohLen = _coh.length()
        if (cohLen > 0) _coh.divideScalar(cohLen)
      }

      _wall.set(0, 0, 0)
      if (cellId >= 0) {
        const bounds = this.adapter.getCellBounds(cellId)
        if (bounds) {
          const margin = 3
          const lookAhead = 4
          const px = b.position[0] + b.velocity[0] * lookAhead * dt
          const py = b.position[1] + b.velocity[1] * lookAhead * dt
          const pz = b.position[2] + b.velocity[2] * lookAhead * dt

          if (px < bounds.min.x + margin) _wall.x += (bounds.min.x + margin - px) * 0.5
          if (px > bounds.max.x - margin) _wall.x += (bounds.max.x - margin - px) * 0.5
          if (py < bounds.min.y + margin) _wall.y += (bounds.min.y + margin - py) * 0.5
          if (py > bounds.max.y - margin) _wall.y += (bounds.max.y - margin - py) * 0.5
          if (pz < bounds.min.z + margin) _wall.z += (bounds.min.z + margin - pz) * 0.5
          if (pz > bounds.max.z - margin) _wall.z += (bounds.max.z - margin - pz) * 0.5
        }
      }

      _flow.set(0, 0, 0)
      if (cellId >= 0) {
        const flow = this.adapter.getCellFlow(cellId)
        _flow.copy(flow)
      }

      _player.set(0, 0, 0)
      const pdx = b.position[0] - playerPosition.x
      const pdy = b.position[1] - playerPosition.y
      const pdz = b.position[2] - playerPosition.z
      const playerDist = Math.sqrt(pdx * pdx + pdy * pdy + pdz * pdz)
      if (playerDist < cfg.avoidPlayerRadius && playerDist > 0.001) {
        const strength = 1 - playerDist / cfg.avoidPlayerRadius
        _player.set(pdx / playerDist * strength, pdy / playerDist * strength, pdz / playerDist * strength)
      }

      _force.set(0, 0, 0)
      _force.addScaledVector(_sep, cfg.separationWeight)
      _force.addScaledVector(_ali, cfg.alignmentWeight)
      _force.addScaledVector(_coh, cfg.cohesionWeight)
      _force.addScaledVector(_wall, cfg.wallAvoidanceWeight)
      _force.addScaledVector(_flow, cfg.flowWeight)
      _force.addScaledVector(_player, cfg.playerAvoidanceWeight)

      const forceLen = _force.length()
      if (forceLen > cfg.maxForce) {
        _force.multiplyScalar(cfg.maxForce / forceLen)
      }

      const vx = b.velocity[0] + _force.x * dt
      const vy = b.velocity[1] + _force.y * dt
      const vz = b.velocity[2] + _force.z * dt
      let speed = Math.sqrt(vx * vx + vy * vy + vz * vz)

      const prevVx = b.velocity[0]
      const prevVy = b.velocity[1]
      const prevVz = b.velocity[2]
      if (speed > 0.001) {
        const prevSpeed = Math.sqrt(prevVx * prevVx + prevVy * prevVy + prevVz * prevVz)
        if (prevSpeed > 0.001) {
          const dot = (vx * prevVx + vy * prevVy + vz * prevVz) / (speed * prevSpeed)
          const angle = Math.acos(Math.min(1, Math.max(-1, dot)))
          const maxAngle = cfg.turnRate * dt
          if (angle > maxAngle) {
            const t = maxAngle / angle
            const nx = prevVx + (vx - prevVx) * t
            const ny = prevVy + (vy - prevVy) * t
            const nz = prevVz + (vz - prevVz) * t
            b.velocity[0] = nx
            b.velocity[1] = ny
            b.velocity[2] = nz
            speed = Math.sqrt(nx * nx + ny * ny + nz * nz)
          } else {
            b.velocity[0] = vx
            b.velocity[1] = vy
            b.velocity[2] = vz
          }
        } else {
          b.velocity[0] = vx
          b.velocity[1] = vy
          b.velocity[2] = vz
        }
      }

      speed = Math.sqrt(b.velocity[0] ** 2 + b.velocity[1] ** 2 + b.velocity[2] ** 2)
      if (speed > cfg.maxSpeed) {
        const s = cfg.maxSpeed / speed
        b.velocity[0] *= s
        b.velocity[1] *= s
        b.velocity[2] *= s
      } else if (speed < cfg.minSpeed && speed > 0.001) {
        const s = cfg.minSpeed / speed
        b.velocity[0] *= s
        b.velocity[1] *= s
        b.velocity[2] *= s
      }

      b.position[0] += b.velocity[0] * dt
      b.position[1] += b.velocity[1] * dt
      b.position[2] += b.velocity[2] * dt

      if (cellId >= 0) {
        const bounds = this.adapter.getCellBounds(cellId)
        if (bounds) {
          b.position[0] = Math.max(bounds.min.x + 1, Math.min(bounds.max.x - 1, b.position[0]))
          b.position[1] = Math.max(bounds.min.y + 1, Math.min(bounds.max.y - 1, b.position[1]))
          b.position[2] = Math.max(bounds.min.z + 1, Math.min(bounds.max.z - 1, b.position[2]))
        }
      }
    }
  }

  private spawnAround(playerPosition: Vector3): void {
    if (this.activeCount >= this.maxBoids) return
    const cfg = this.config
    const activeCells = this.adapter.getActiveBoidCells(playerPosition, cfg.spawnRadius)
    if (activeCells.length === 0) return

    const needed = Math.min(
      cfg.initialBoids - this.activeCount,
      this.maxBoids - this.activeCount,
    )
    if (needed <= 0) return

    const spawnPerFrame = Math.min(needed, 20)
    let spawned = 0

    for (let attempt = 0; attempt < spawnPerFrame * 3 && spawned < spawnPerFrame; attempt++) {
      const cellIdx = Math.floor(Math.random() * activeCells.length)
      const cell = activeCells[cellIdx]

      _v.set(
        cell.boundsMin.x + Math.random() * (cell.boundsMax.x - cell.boundsMin.x),
        cell.boundsMin.y + Math.random() * (cell.boundsMax.y - cell.boundsMin.y),
        cell.boundsMin.z + Math.random() * (cell.boundsMax.z - cell.boundsMin.z),
      )

      if (_v.distanceTo(playerPosition) < cfg.avoidPlayerRadius) continue

      const slot = this.findDeadSlot()
      if (slot < 0) break

      const angle = Math.random() * Math.PI * 2
      const pitch = (Math.random() - 0.5) * 0.5
      const spd = cfg.minSpeed + Math.random() * (cfg.maxSpeed - cfg.minSpeed) * 0.5

      this.boids[slot].position[0] = _v.x
      this.boids[slot].position[1] = _v.y
      this.boids[slot].position[2] = _v.z
      this.boids[slot].velocity[0] = Math.cos(angle) * Math.cos(pitch) * spd
      this.boids[slot].velocity[1] = Math.sin(pitch) * spd
      this.boids[slot].velocity[2] = Math.sin(angle) * Math.cos(pitch) * spd
      this.boids[slot].seed = Math.random() * 65536
      this.boids[slot].typeId = 0
      this.boids[slot].life = 0
      this.boids[slot].cellId = cell.id
      this.boids[slot].flags = BoidFlags.SPAWNING
      this.boids[slot].age = 0

      this.activeCount++
      this.spawnCount++
      spawned++
    }
  }

  private findDeadSlot(): number {
    for (let i = 0; i < this.maxBoids; i++) {
      if (this.boids[i].flags === BoidFlags.DEAD) return i
    }
    return -1
  }

  private buildConnectedSet(cellId: number): Set<number> | null {
    if (cellId < 0) return null
    const connected = new Set<number>()
    connected.add(cellId)
    const neighbors = this.adapter.getConnectedNeighborCellIds(cellId)
    for (let i = 0; i < neighbors.length; i++) {
      connected.add(neighbors[i])
    }
    return connected
  }

  getStats() {
    return {
      spawnCount: this.spawnCount,
      despawnCount: this.despawnCount,
    }
  }

  resetStats(): void {
    this.spawnCount = 0
    this.despawnCount = 0
  }

  dispose(): void {
    this.boids.length = 0
  }
}
