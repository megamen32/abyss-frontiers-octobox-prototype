import { Vector3 } from 'three'
import type { BoidState, BoidTypeConfig, BoidsConfig, BoidsFollowPredictor, BoidTypeInteraction } from './BoidsTypes'
import { BoidBehavior, BoidFlags } from './BoidsTypes'
import { BoidsSpatialGrid } from './BoidsSpatialGrid'
import { BoidsOctoBoxAdapter } from './BoidsOctoBoxAdapter'
import { GAME_CONFIG } from '../game/config'
import { WORLD_SIZE, wrapPositionInPlace } from '../game/utils/worldTopology'

const _v = new Vector3()
const _sep = new Vector3()
const _ali = new Vector3()
const _coh = new Vector3()
const _pursuit = new Vector3()
const _flee = new Vector3()
const _wall = new Vector3()
const _flow = new Vector3()
const _avoid = new Vector3()
const _follow = new Vector3()
const _force = new Vector3()
const _target = new Vector3()
const _wander = new Vector3()

const MINE_TARGETING_MAX_SPEED = 9
const MINE_TARGETING_ACCEL = 18
const DEFAULT_INTERACTION: BoidTypeInteraction = { separation: 1, alignment: 1, cohesion: 1, pursuit: 0, flee: 0, ignore: false }

export class BoidsCPUSimulation {
  private boids: BoidState[]
  private grid: BoidsSpatialGrid
  private config: BoidsConfig
  private adapter: BoidsOctoBoxAdapter
  private maxBoids: number
  private readonly typeById: BoidTypeConfig[] = []
  private readonly interactionByTypeId: BoidTypeInteraction[][] = []
  private readonly externalSlots = new Map<string, number>()
  private readonly dirtyExternalSlots = new Set<number>()
  private readonly connectedCellIds = new Set<number>()
  activeCount = 0
  private spawnCount = 0
  private despawnCount = 0
  private neighborSearchMs = 0
  private steeringMs = 0
  private avoidanceMs = 0
  private integrationMs = 0
  private mineUpdateMs = 0
  private neighborSamples = 0
  private neighborTotal = 0

  private lastPlayerPos = new Vector3()
  private lastPlayerVel = new Vector3()
  private lastPlayerFwd = new Vector3(0, 0, 1)

  constructor(config: BoidsConfig, adapter: BoidsOctoBoxAdapter) {
    this.config = config
    this.adapter = adapter
    this.maxBoids = Math.min(config.maxBoids, config.fallback.cpuMaxBoids)
    for (let i = 0; i < config.boidTypes.length; i++) {
      const type = config.boidTypes[i]
      this.typeById[type.typeId] = type
      const row = config.interactions[i] ?? []
      this.interactionByTypeId[type.typeId] = this.interactionByTypeId[type.typeId] ?? []
      for (let j = 0; j < config.boidTypes.length; j++) {
        const targetType = config.boidTypes[j]
        const interaction = row[j]
        if (interaction) {
          this.interactionByTypeId[type.typeId][targetType.typeId] = interaction
        }
      }
    }
    this.boids = new Array(this.maxBoids)
    for (let i = 0; i < this.maxBoids; i++) {
      this.boids[i] = {
        position: [0, 0, 0],
        velocity: [0, 0, 0],
        seed: 0,
        typeId: 0,
        behavior: BoidBehavior.NONE,
        stateTimer: 0,
        life: 0,
        cellId: -1,
        flags: BoidFlags.DEAD,
        age: 0,
      }
    }
    this.grid = new BoidsSpatialGrid(config.gridCellSize)
  }

  getBoids(): readonly BoidState[] { return this.boids }
  getActiveCount(): number { return this.activeCount }
  getGrid(): BoidsSpatialGrid { return this.grid }

  update(
    dt: number,
    playerPosition: Vector3,
    cameraPosition: Vector3,
    playerVelocity?: Vector3,
    playerForward?: Vector3,
    predictor?: BoidsFollowPredictor,
  ): void {
    const cfg = this.config
    this.neighborSearchMs = 0
    this.steeringMs = 0
    this.avoidanceMs = 0
    this.integrationMs = 0
    this.mineUpdateMs = 0
    this.neighborSamples = 0
    this.neighborTotal = 0
    this.lastPlayerPos.copy(playerPosition)
    if (playerVelocity) this.lastPlayerVel.copy(playerVelocity)
    if (playerForward) this.lastPlayerFwd.copy(playerForward)

    this.grid.clear()

    // Phase 1: lifecycle + insert into grid
    for (let i = 0; i < this.maxBoids; i++) {
      const b = this.boids[i]
      if (b.flags === BoidFlags.DEAD) continue

      if (b.flags === BoidFlags.KINEMATIC) {
        this.grid.insert(i, b.position)
        continue
      }

      b.age += dt
      _v.set(b.position[0], b.position[1], b.position[2])

      if (b.flags === BoidFlags.ACTIVE && wrappedDistance3(
        b.position[0], b.position[1], b.position[2],
        cameraPosition.x, cameraPosition.y, cameraPosition.z,
      ) > cfg.despawnRadius) {
        b.flags = BoidFlags.DESPAWNING
        this.despawnCount++
      }

      if (b.flags === BoidFlags.DESPAWNING) {
        b.life -= dt * 2
        if (b.life <= 0) { b.flags = BoidFlags.DEAD; this.activeCount--; continue }
      }

      if (b.flags === BoidFlags.SPAWNING) {
        b.life += dt * 2
        if (b.life >= 1) { b.life = 1; b.flags = BoidFlags.ACTIVE }
      }

      this.grid.insert(i, b.position)
    }

    // Phase 2: spawn new boids
    this.trySpawn(playerPosition)

    // Phase 3: simulate forces

    for (let i = 0; i < this.maxBoids; i++) {
      const b = this.boids[i]
      if (b.flags === BoidFlags.DEAD || b.flags === BoidFlags.SLEEPING || b.flags === BoidFlags.KINEMATIC) continue

      _v.set(b.position[0], b.position[1], b.position[2])
      if (wrappedDistance3(
        b.position[0], b.position[1], b.position[2],
        playerPosition.x, playerPosition.y, playerPosition.z,
      ) > cfg.simulationRadius) continue

      const tc = this.typeOf(b.typeId)
      const neighborStart = performance.now()
      const cellId = this.adapter.findCellByPosition(_v)
      b.cellId = cellId

      const connectedIds = this.buildConnectedSet(cellId)
      const neighbors = this.grid.queryNeighbors(b.position, tc.perceptionRadius, this.boids, i, 50, connectedIds)
      this.neighborSearchMs += performance.now() - neighborStart
      this.neighborSamples += 1
      this.neighborTotal += neighbors.length

      const steeringStart = performance.now()
      _sep.set(0, 0, 0)
      _ali.set(0, 0, 0)
      _coh.set(0, 0, 0)
      _pursuit.set(0, 0, 0)
      _flee.set(0, 0, 0)
      let count = 0

      for (let n = 0; n < neighbors.length; n++) {
        const other = this.boids[neighbors[n]]
        const rel = this.interactionOf(b.typeId, other.typeId)
        if (rel.ignore) continue
        const dx = shortestAxisDelta(other.position[0], b.position[0])
        const dy = shortestAxisDelta(other.position[1], b.position[1])
        const dz = shortestAxisDelta(other.position[2], b.position[2])
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist < tc.separationRadius && dist > 0.001) {
          _sep.x += (dx / dist / dist) * rel.separation
          _sep.y += (dy / dist / dist) * rel.separation
          _sep.z += (dz / dist / dist) * rel.separation
        }
        if (rel.alignment > 0) {
          _ali.x += other.velocity[0] * rel.alignment
          _ali.y += other.velocity[1] * rel.alignment
          _ali.z += other.velocity[2] * rel.alignment
        }
        if (rel.cohesion > 0) {
          _coh.x += (b.position[0] - dx) * rel.cohesion
          _coh.y += (b.position[1] - dy) * rel.cohesion
          _coh.z += (b.position[2] - dz) * rel.cohesion
        }
        if (rel.pursuit > 0) {
          _pursuit.x += -dx * rel.pursuit
          _pursuit.y += -dy * rel.pursuit
          _pursuit.z += -dz * rel.pursuit
        }
        if (rel.flee > 0) {
          _flee.x += dx * rel.flee
          _flee.y += dy * rel.flee
          _flee.z += dz * rel.flee
        }
        count += 1
      }

      if (count > 0) {
        _ali.divideScalar(count)
        const al = _ali.length(); if (al > 0.001) _ali.divideScalar(al)
        _coh.x = _coh.x / count - b.position[0]
        _coh.y = _coh.y / count - b.position[1]
        _coh.z = _coh.z / count - b.position[2]
        const cl = _coh.length(); if (cl > 0.001) _coh.divideScalar(cl)
      }
      if (_pursuit.lengthSq() > 0.0001) _pursuit.normalize()
      if (_flee.lengthSq() > 0.0001) _flee.normalize()
      this.steeringMs += performance.now() - steeringStart

      const avoidanceStart = performance.now()
      _wall.set(0, 0, 0)
      if (cellId >= 0) {
        const bounds = this.adapter.getCellBounds(cellId)
        if (bounds) {
          const m = 6, la = 4
          const px = b.position[0] + b.velocity[0] * la * dt
          const py = b.position[1] + b.velocity[1] * la * dt
          const pz = b.position[2] + b.velocity[2] * la * dt
          const dxMin = px - bounds.min.x
          const dxMax = bounds.max.x - px
          const dyMin = py - bounds.min.y
          const dyMax = bounds.max.y - py
          const dzMin = pz - bounds.min.z
          const dzMax = bounds.max.z - pz
          if (dxMin < m) _wall.x += ((1 - dxMin / m) ** 2) * 4
          if (dxMax < m) _wall.x -= ((1 - dxMax / m) ** 2) * 4
          if (dyMin < m) _wall.y += ((1 - dyMin / m) ** 2) * 4
          if (dyMax < m) _wall.y -= ((1 - dyMax / m) ** 2) * 4
          if (dzMin < m) _wall.z += ((1 - dzMin / m) ** 2) * 4
          if (dzMax < m) _wall.z -= ((1 - dzMax / m) ** 2) * 4
        }
      }

      _flow.set(0, 0, 0)
      if (cellId >= 0) _flow.copy(this.adapter.getCellFlow(cellId))

      _avoid.set(0, 0, 0)
      if (tc.avoidPlayerRadius > 0) {
        const pdx = shortestAxisDelta(playerPosition.x, b.position[0])
        const pdy = shortestAxisDelta(playerPosition.y, b.position[1])
        const pdz = shortestAxisDelta(playerPosition.z, b.position[2])
        const pd = Math.sqrt(pdx * pdx + pdy * pdy + pdz * pdz)
        if (pd < tc.avoidPlayerRadius && pd > 0.001) {
          const s = (1 - pd / tc.avoidPlayerRadius) / pd
          _avoid.set(pdx * s, pdy * s, pdz * s)
        }
      }
      this.avoidanceMs += performance.now() - avoidanceStart

      _follow.set(0, 0, 0)
      if (tc.followTarget !== null && predictor) {
        const ft = tc.followTarget
        const phase = (b.seed * 0.01 + b.age / ft.period) * Math.PI * 2
        const t = (Math.sin(phase) + 1) * 0.5
        const aheadSeconds = ft.minSeconds + t * (ft.maxSeconds - ft.minSeconds)
        const predicted = predictor.predict(aheadSeconds)
        const lateralAngle = b.seed * 6.283
        const targetX = predicted.x
          + Math.cos(lateralAngle) * ft.spread
        const targetY = predicted.y
          + Math.sin(b.seed * 2.718) * ft.spread * 0.5
        const targetZ = predicted.z
          + Math.sin(lateralAngle) * ft.spread

        const fdx = shortestAxisDelta(b.position[0], targetX)
        const fdy = shortestAxisDelta(b.position[1], targetY)
        const fdz = shortestAxisDelta(b.position[2], targetZ)
        const fd = Math.sqrt(fdx * fdx + fdy * fdy + fdz * fdz)
        if (fd > 0.001) {
          const pull = Math.min(fd / 8, 2.0)
          _follow.set(fdx / fd * pull, fdy / fd * pull, fdz / fd * pull)
        }
      }

      _force.set(0, 0, 0)
      _force.addScaledVector(_sep, tc.separationWeight)
      _force.addScaledVector(_ali, tc.alignmentWeight)
      _force.addScaledVector(_coh, tc.cohesionWeight)
      _force.addScaledVector(_wall, tc.wallAvoidanceWeight)
      _force.addScaledVector(_flow, tc.flowWeight)
      _force.addScaledVector(_avoid, tc.playerAvoidanceWeight)
      _force.addScaledVector(_pursuit, 1.0)
      _force.addScaledVector(_flee, 1.0)
      if (tc.followTarget !== null) {
        _force.addScaledVector(_follow, tc.followTarget.weight)
      }
      if (tc.name === 'mine') {
        const mineStart = performance.now()
        this.applyMineBehavior(b, _force)
        this.mineUpdateMs += performance.now() - mineStart
      }

      const fl = _force.length()
      if (fl > tc.maxForce) _force.multiplyScalar(tc.maxForce / fl)

      const integrationStart = performance.now()
      const vx = b.velocity[0] + _force.x * dt
      const vy = b.velocity[1] + _force.y * dt
      const vz = b.velocity[2] + _force.z * dt
      const newSpeed = Math.sqrt(vx * vx + vy * vy + vz * vz)
      const prevSpeed = Math.sqrt(b.velocity[0] ** 2 + b.velocity[1] ** 2 + b.velocity[2] ** 2)

      if (newSpeed > 0.001 && prevSpeed > 0.001) {
        const dot = (vx * b.velocity[0] + vy * b.velocity[1] + vz * b.velocity[2]) / (newSpeed * prevSpeed)
        const angle = Math.acos(Math.min(1, Math.max(-1, dot)))
        const maxAngle = tc.turnRate * dt
        if (angle > maxAngle) {
          const blend = maxAngle / angle
          b.velocity[0] += (vx - b.velocity[0]) * blend
          b.velocity[1] += (vy - b.velocity[1]) * blend
          b.velocity[2] += (vz - b.velocity[2]) * blend
        } else {
          b.velocity[0] = vx; b.velocity[1] = vy; b.velocity[2] = vz
        }
      } else {
        b.velocity[0] = vx; b.velocity[1] = vy; b.velocity[2] = vz
      }

      let spd = Math.sqrt(b.velocity[0] ** 2 + b.velocity[1] ** 2 + b.velocity[2] ** 2)
      if (spd > tc.maxSpeed) {
        const s = tc.maxSpeed / spd
        b.velocity[0] *= s; b.velocity[1] *= s; b.velocity[2] *= s
      } else if (spd < tc.minSpeed && spd > 0.001) {
        const s = tc.minSpeed / spd
        b.velocity[0] *= s; b.velocity[1] *= s; b.velocity[2] *= s
      }

      b.position[0] += b.velocity[0] * dt
      b.position[1] += b.velocity[1] * dt
      b.position[2] += b.velocity[2] * dt
      _v.set(b.position[0], b.position[1], b.position[2])
      wrapPositionInPlace(_v)
      b.position[0] = _v.x; b.position[1] = _v.y; b.position[2] = _v.z

      if (tc.followTarget === null && cellId >= 0) {
        const bounds = this.adapter.getCellBounds(cellId)
        if (bounds) {
          b.position[0] = Math.max(bounds.min.x + 1, Math.min(bounds.max.x - 1, b.position[0]))
          b.position[1] = Math.max(bounds.min.y + 1, Math.min(bounds.max.y - 1, b.position[1]))
          b.position[2] = Math.max(bounds.min.z + 1, Math.min(bounds.max.z - 1, b.position[2]))
        }
      }
      this.integrationMs += performance.now() - integrationStart
    }
  }

  private trySpawn(playerPosition: Vector3): void {
    if (this.activeCount >= this.maxBoids) return
    const cfg = this.config
    const needed = Math.min(cfg.initialBoids - this.activeCount, this.maxBoids - this.activeCount)
    if (needed <= 0) return

    const perFrame = Math.min(needed, 20)
    this.spawnInFreeCells(playerPosition, perFrame)
  }

  /** Spawn in random free OctoBox cells near the player. */
  private spawnInFreeCells(playerPosition: Vector3, count: number): void {
    const cfg = this.config
    const cells = this.adapter.getActiveBoidCells(playerPosition, cfg.spawnRadius)
    if (cells.length === 0) return

    const countsByType = new Map<number, number>()
    for (let i = 0; i < this.boids.length; i++) {
      const b = this.boids[i]
      if (b.flags === BoidFlags.DEAD) continue
      countsByType.set(b.typeId, (countsByType.get(b.typeId) ?? 0) + 1)
    }

    let spawned = 0
    for (let attempt = 0; attempt < count * 3 && spawned < count; attempt++) {
      let tc = cfg.boidTypes[0]
      let bestDeficit = -Infinity
      for (const type of cfg.boidTypes) {
        const current = countsByType.get(type.typeId) ?? 0
        const deficit = type.targetCount - current
        if (deficit > bestDeficit) {
          bestDeficit = deficit
          tc = type
        }
      }
      if (bestDeficit <= 0) break

      const cell = cells[Math.floor(Math.random() * cells.length)]
      _v.set(
        cell.boundsMin.x + Math.random() * (cell.boundsMax.x - cell.boundsMin.x),
        cell.boundsMin.y + Math.random() * (cell.boundsMax.y - cell.boundsMin.y),
        cell.boundsMin.z + Math.random() * (cell.boundsMax.z - cell.boundsMin.z),
      )
      if (tc.avoidPlayerRadius > 0 && wrappedDistance3(
        _v.x, _v.y, _v.z,
        playerPosition.x, playerPosition.y, playerPosition.z,
      ) < tc.avoidPlayerRadius) continue

      const slot = this.findDeadSlot()
      if (slot < 0) break

      const angle = Math.random() * Math.PI * 2
      const pitch = (Math.random() - 0.5) * 0.5
      const spd = tc.minSpeed + Math.random() * (tc.maxSpeed - tc.minSpeed) * 0.5
      this.initBoid(
        slot,
        _v.x,
        _v.y,
        _v.z,
        Math.cos(angle) * Math.cos(pitch) * spd,
        Math.sin(pitch) * spd,
        Math.sin(angle) * Math.cos(pitch) * spd,
        tc.typeId,
        cell.id,
      )
      countsByType.set(tc.typeId, (countsByType.get(tc.typeId) ?? 0) + 1)
      spawned++
    }
  }

  private initBoid(
    slot: number,
    px: number, py: number, pz: number,
    vx: number, vy: number, vz: number,
    typeId: number, cellId: number,
  ): void {
    const b = this.boids[slot]
    b.position[0] = px; b.position[1] = py; b.position[2] = pz
    b.velocity[0] = vx; b.velocity[1] = vy; b.velocity[2] = vz
    b.seed = Math.random() * 65536
    b.typeId = typeId
    b.behavior = BoidBehavior.NONE
    b.stateTimer = 0
    b.life = 0
    b.cellId = cellId
    b.flags = BoidFlags.SPAWNING
    b.age = 0
    this.activeCount++
    this.spawnCount++
  }

  private findDeadSlot(): number {
    for (let i = 0; i < this.maxBoids; i++) {
      if (this.boids[i].flags === BoidFlags.DEAD) return i
    }
    return -1
  }

  getStats() {
    return {
      spawnCount: this.spawnCount,
      despawnCount: this.despawnCount,
      neighborSearchMs: this.neighborSearchMs,
      steeringMs: this.steeringMs,
      avoidanceMs: this.avoidanceMs,
      integrationMs: this.integrationMs,
      mineUpdateMs: this.mineUpdateMs,
      avgNeighbors: this.neighborSamples > 0 ? this.neighborTotal / this.neighborSamples : 0,
    }
  }
  resetStats(): void { this.spawnCount = 0; this.despawnCount = 0 }
  dispose(): void { this.boids.length = 0 }

  private applyMineBehavior(b: BoidState, force: Vector3): void {
    const currentPos = _v.set(b.position[0], b.position[1], b.position[2])
    const currentVel = _target.set(b.velocity[0], b.velocity[1], b.velocity[2])

    if (b.behavior === BoidBehavior.IDLE) {
      const t = b.age + b.seed * 0.01
      _wander.set(
        Math.sin(t * 0.7) * 0.9,
        Math.cos(t * 0.5) * 0.45,
        Math.sin(t * 0.9) * 0.9,
      )
      force.addScaledVector(_wander, 2.3)
      return
    }

    _follow.copy(this.lastPlayerPos).sub(currentPos)
    const distance = _follow.length()
    if (distance <= 0.0001) return
    _follow.multiplyScalar(1 / distance)
    _avoid.copy(this.lastPlayerVel).sub(currentVel)
    const closingSpeed = Math.max(_avoid.dot(_follow), 0.001)
    const leadTime = Math.min(2.5, Math.max(0.15, distance / closingSpeed))
    _target.copy(this.lastPlayerPos).addScaledVector(this.lastPlayerVel, leadTime)
    _target.sub(currentPos)
    if (_target.lengthSq() <= 0.0001) return
    _target.normalize()

    if (b.behavior === BoidBehavior.TARGETING) {
      const elapsed = GAME_CONFIG.mines.telegraphDuration - Math.max(0, b.stateTimer)
      const progress = Math.max(0, Math.min(1, GAME_CONFIG.mines.telegraphDuration > 0 ? elapsed / GAME_CONFIG.mines.telegraphDuration : 1))
      const ease = progress * progress * (3 - 2 * progress)
      const desiredSpeed = MINE_TARGETING_MAX_SPEED * ease
      _target.multiplyScalar(desiredSpeed)
      _target.sub(currentVel)
      const steerLen = _target.length()
      if (steerLen > MINE_TARGETING_ACCEL) {
        _target.multiplyScalar(MINE_TARGETING_ACCEL / steerLen)
      }
      force.add(_target)
      return
    }

    if (b.behavior === BoidBehavior.ROCKET) {
      force.addScaledVector(_target, GAME_CONFIG.mines.rocketAcceleration * 18)
      return
    }

    if (b.behavior === BoidBehavior.LAUNCHED) {
      const desiredSpeed = GAME_CONFIG.mines.launchSpeed
      _target.multiplyScalar(desiredSpeed)
      _target.sub(currentVel)
      force.addScaledVector(_target, 1.8)
    }
  }

  upsertKinematicBoid(
    id: string,
    px: number,
    py: number,
    pz: number,
    vx: number,
    vy: number,
    vz: number,
    typeId: number,
    cellId: number,
  ): void {
    let slot = this.externalSlots.get(id) ?? -1
    if (slot < 0) {
      slot = this.findDeadSlot()
      if (slot < 0) return
      this.externalSlots.set(id, slot)
      this.activeCount++
    }
    const b = this.boids[slot]
    b.position[0] = px; b.position[1] = py; b.position[2] = pz
    b.velocity[0] = vx; b.velocity[1] = vy; b.velocity[2] = vz
    b.seed = slot + typeId * 1024
    b.typeId = typeId
    b.behavior = BoidBehavior.NONE
    b.stateTimer = 0
    b.life = 1
    b.cellId = cellId
    b.flags = BoidFlags.KINEMATIC
    this.dirtyExternalSlots.add(slot)
  }

  upsertManagedBoid(
    id: string,
    px: number,
    py: number,
    pz: number,
    vx: number,
    vy: number,
    vz: number,
    typeId: number,
    behavior: BoidBehavior,
    stateTimer: number,
    cellId: number,
  ): void {
    let slot = this.externalSlots.get(id) ?? -1
    if (slot < 0) {
      slot = this.findDeadSlot()
      if (slot < 0) return
      this.externalSlots.set(id, slot)
      this.activeCount++
    }
    const b = this.boids[slot]
    b.position[0] = px; b.position[1] = py; b.position[2] = pz
    b.velocity[0] = vx; b.velocity[1] = vy; b.velocity[2] = vz
    b.seed = b.seed || slot + typeId * 1024
    b.typeId = typeId
    b.behavior = behavior
    b.stateTimer = stateTimer
    b.life = 1
    b.cellId = cellId
    b.flags = BoidFlags.ACTIVE
    this.dirtyExternalSlots.add(slot)
  }

  updateManagedBoid(id: string, behavior: BoidBehavior, stateTimer: number): void {
    const slot = this.externalSlots.get(id)
    if (slot === undefined) return
    const b = this.boids[slot]
    b.behavior = behavior
    b.stateTimer = stateTimer
    if (b.flags === BoidFlags.KINEMATIC) b.flags = BoidFlags.ACTIVE
    this.dirtyExternalSlots.add(slot)
  }

  getManagedBoid(id: string): BoidState | null {
    const slot = this.externalSlots.get(id)
    return slot === undefined ? null : this.boids[slot]
  }

  removeKinematicBoid(id: string): void {
    const slot = this.externalSlots.get(id)
    if (slot === undefined) return
    this.externalSlots.delete(id)
    const b = this.boids[slot]
    b.life = 0
    b.cellId = -1
    b.flags = BoidFlags.DEAD
    this.dirtyExternalSlots.add(slot)
    this.activeCount = Math.max(0, this.activeCount - 1)
  }

  consumeDirtyExternalBoids(): Array<{ slot: number; boid: BoidState }> {
    const dirty: Array<{ slot: number; boid: BoidState }> = []
    for (const slot of this.dirtyExternalSlots) {
      dirty.push({ slot, boid: this.boids[slot] })
    }
    this.dirtyExternalSlots.clear()
    return dirty
  }

  private typeOf(typeId: number): BoidTypeConfig {
    return this.typeById[typeId] ?? this.config.boidTypes[0]
  }

  private interactionOf(fromTypeId: number, toTypeId: number): BoidTypeInteraction {
    return this.interactionByTypeId[fromTypeId]?.[toTypeId]
      ?? this.interactionByTypeId[fromTypeId]?.[fromTypeId]
      ?? DEFAULT_INTERACTION
  }

  private buildConnectedSet(cellId: number): Set<number> | null {
    if (cellId < 0) return null
    this.connectedCellIds.clear()
    this.connectedCellIds.add(cellId)
    const neighbors = this.adapter.getConnectedNeighborCellIds(cellId)
    for (let i = 0; i < neighbors.length; i++) {
      this.connectedCellIds.add(neighbors[i])
    }
    return this.connectedCellIds
  }
}

function wrappedDistance3(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = shortestAxisDelta(ax, bx)
  const dy = shortestAxisDelta(ay, by)
  const dz = shortestAxisDelta(az, bz)
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
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
