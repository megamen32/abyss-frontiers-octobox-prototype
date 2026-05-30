import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { BoidsCPUSimulation } from '../src/boids/BoidsCPUSimulation'
import { BoidsOctoBoxAdapter } from '../src/boids/BoidsOctoBoxAdapter'
import { AMBIENT_FISH_TYPE, COMPANION_FISH_TYPE, MINE_TYPE, UNIFIED_WORLD_BOIDS_CONFIG } from '../src/boids/BoidsConfig'
import { BoidBehavior } from '../src/boids/BoidsTypes'
import type { AABB, ChunkData, LeafCell } from '../src/game/types'
import { SeededRandom } from '../src/game/utils/rng'

interface BoidsProfileScenario {
  label: string
  ambient: number
  companion: number
  mines: number
}

interface BoidsProfileFrame {
  frame: number
  totalMs: number
  neighborSearchMs: number
  steeringMs: number
  avoidanceMs: number
  integrationMs: number
  mineUpdateMs: number
  avgNeighbors: number
}

interface BoidsProfileSummary {
  label: string
  count: number
  p50TotalMs: number
  p95TotalMs: number
  p99TotalMs: number
  p95NeighborSearchMs: number
  p95SteeringMs: number
  p95AvoidanceMs: number
  p95IntegrationMs: number
  p95MineUpdateMs: number
  avgNeighbors: number
}

describe('Boids profiling', () => {
  it('writes deterministic CPU boids timing report for mobile and desktop scale targets', async () => {
    const scenarios: BoidsProfileScenario[] = [
      { label: 'mobile_1k', ambient: 720, companion: 240, mines: 40 },
      { label: 'desktop_6k', ambient: 4500, companion: 1200, mines: 300 },
    ]
    const summaries: BoidsProfileSummary[] = []
    const frames: Record<string, BoidsProfileFrame[]> = {}

    for (const scenario of scenarios) {
      const frameSamples = runScenario(scenario)
      frames[scenario.label] = frameSamples
      summaries.push(summarizeScenario(scenario.label, scenario.ambient + scenario.companion + scenario.mines, frameSamples))
    }

    const outputDirectory = resolve(process.cwd(), 'artifacts/performance')
    await mkdir(outputDirectory, { recursive: true })
    await writeFile(
      resolve(outputDirectory, 'boids-profile.json'),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), summaries, frames }, null, 2)}\n`,
      'utf8',
    )

    for (const summary of summaries) {
      console.log(
        `${summary.label}: count=${summary.count}`
        + ` p50=${summary.p50TotalMs.toFixed(2)}`
        + ` p95=${summary.p95TotalMs.toFixed(2)}`
        + ` p99=${summary.p99TotalMs.toFixed(2)}`
        + ` neighbor=${summary.p95NeighborSearchMs.toFixed(2)}`
        + ` steer=${summary.p95SteeringMs.toFixed(2)}`
        + ` avoid=${summary.p95AvoidanceMs.toFixed(2)}`
        + ` integrate=${summary.p95IntegrationMs.toFixed(2)}`
        + ` mine=${summary.p95MineUpdateMs.toFixed(2)}`
        + ` avgNeighbors=${summary.avgNeighbors.toFixed(1)}`,
      )
    }

    expect(summaries[0].count).toBe(1000)
    expect(summaries[1].count).toBe(6000)
    expect(summaries.every((summary) => Number.isFinite(summary.p95TotalMs))).toBe(true)
    expect(summaries[0].p95TotalMs).toBeLessThan(33)
  }, 30_000)
})

function runScenario(scenario: BoidsProfileScenario): BoidsProfileFrame[] {
  const adapter = new BoidsOctoBoxAdapter()
  adapter.syncChunks([makeProfileChunk()], [])
  adapter.rebuild()
  const count = scenario.ambient + scenario.companion + scenario.mines
  const sim = new BoidsCPUSimulation({
    ...UNIFIED_WORLD_BOIDS_CONFIG,
    maxBoids: count,
    initialBoids: 0,
    simulationRadius: 900,
    fallback: { cpuMaxBoids: count },
  }, adapter)
  seedBoids(sim, scenario)

  const player = new Vector3(256, 256, 256)
  const camera = new Vector3(256, 256, 120)
  const playerVelocity = new Vector3(0, 0, 18)
  const playerForward = new Vector3(0, 0, 1)
  const predictor = {
    predict: (seconds: number) => player.clone().addScaledVector(playerVelocity, seconds),
  }

  for (let frame = 0; frame < 4; frame += 1) {
    sim.update(1 / 60, player, camera, playerVelocity, playerForward, predictor)
  }

  const samples: BoidsProfileFrame[] = []
  for (let frame = 0; frame < 12; frame += 1) {
    const start = performance.now()
    sim.update(1 / 60, player, camera, playerVelocity, playerForward, predictor)
    const totalMs = performance.now() - start
    const stats = sim.getStats()
    samples.push({
      frame,
      totalMs,
      neighborSearchMs: stats.neighborSearchMs,
      steeringMs: stats.steeringMs,
      avoidanceMs: stats.avoidanceMs,
      integrationMs: stats.integrationMs,
      mineUpdateMs: stats.mineUpdateMs,
      avgNeighbors: stats.avgNeighbors,
    })
  }
  return samples
}

function seedBoids(sim: BoidsCPUSimulation, scenario: BoidsProfileScenario): void {
  const rng = new SeededRandom(908172)
  let index = 0
  for (let i = 0; i < scenario.ambient; i += 1) {
    upsertProfileBoid(sim, rng, index, AMBIENT_FISH_TYPE.typeId, BoidBehavior.NONE)
    index += 1
  }
  for (let i = 0; i < scenario.companion; i += 1) {
    upsertProfileBoid(sim, rng, index, COMPANION_FISH_TYPE.typeId, BoidBehavior.NONE)
    index += 1
  }
  for (let i = 0; i < scenario.mines; i += 1) {
    upsertProfileBoid(sim, rng, index, MINE_TYPE.typeId, BoidBehavior.IDLE)
    index += 1
  }
}

function upsertProfileBoid(
  sim: BoidsCPUSimulation,
  rng: SeededRandom,
  index: number,
  typeId: number,
  behavior: BoidBehavior,
): void {
  const angle = rng.range(0, Math.PI * 2)
  const pitch = rng.range(-0.45, 0.45)
  const speed = rng.range(3, 18)
  sim.upsertManagedBoid(
    `profile-${index}`,
    rng.range(96, 416),
    rng.range(96, 416),
    rng.range(96, 416),
    Math.cos(angle) * Math.cos(pitch) * speed,
    Math.sin(pitch) * speed,
    Math.sin(angle) * Math.cos(pitch) * speed,
    typeId,
    behavior,
    0,
    0,
  )
}

function summarizeScenario(label: string, count: number, frames: BoidsProfileFrame[]): BoidsProfileSummary {
  return {
    label,
    count,
    p50TotalMs: percentile(frames.map((frame) => frame.totalMs), 0.5),
    p95TotalMs: percentile(frames.map((frame) => frame.totalMs), 0.95),
    p99TotalMs: percentile(frames.map((frame) => frame.totalMs), 0.99),
    p95NeighborSearchMs: percentile(frames.map((frame) => frame.neighborSearchMs), 0.95),
    p95SteeringMs: percentile(frames.map((frame) => frame.steeringMs), 0.95),
    p95AvoidanceMs: percentile(frames.map((frame) => frame.avoidanceMs), 0.95),
    p95IntegrationMs: percentile(frames.map((frame) => frame.integrationMs), 0.95),
    p95MineUpdateMs: percentile(frames.map((frame) => frame.mineUpdateMs), 0.95),
    avgNeighbors: frames.reduce((sum, frame) => sum + frame.avgNeighbors, 0) / frames.length,
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
  return sorted[index]
}

function makeProfileChunk(): ChunkData {
  const cells = [makeFreeCell('profile', 0, 0, 0, 512, 512, 512)]
  return {
    key: '0,0,0',
    coord: { x: 0, y: 0, z: 0 },
    seed: 133742,
    bounds: makeBounds(0, 0, 0, 512, 512, 512),
    cells,
    portals: [],
    adjacency: [],
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
    fieldBias: 0.8,
  }
}

function makeBounds(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): AABB {
  return {
    min: new Vector3(minX, minY, minZ),
    max: new Vector3(maxX, maxY, maxZ),
  }
}
