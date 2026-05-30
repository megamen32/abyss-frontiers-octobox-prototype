import { AmbientLight, Color, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { BoidsSystem } from '../boids/BoidsSystem'
import type { BoidsConfig, BoidTypeConfig, BoidTypeInteraction } from '../boids'
import { AMBIENT_FISH_TYPE, COMPANION_FISH_TYPE, DRONE_TYPE, PLANKTON_TYPE } from '../boids'
import { FpsPanel } from '../ui/FpsPanel'
import type { AABB, ChunkData, LeafCell } from '../game/types'
import { collectBenchmarkDeviceProfile } from './deviceProfile'
import { summarizeNumberSamples } from './reportUtils'
import type { BenchmarkFrameSample, BenchmarkPhaseReport, BenchmarkSessionReport } from './reportTypes'

const BENCHMARK_TYPE_ORDER = [AMBIENT_FISH_TYPE, COMPANION_FISH_TYPE, DRONE_TYPE, PLANKTON_TYPE] as const
const COUNT_STEP = 500
const MAX_BENCHMARK_BOIDS = 24000
const AUTORUN_SCENARIOS: Array<{ label: string; counts: number[]; settleMs: number; sampleMs: number }> = [
  { label: 'mobile_1k', counts: [720, 200, 40, 40], settleMs: 1500, sampleMs: 4000 },
  { label: 'mobile_2k', counts: [1440, 400, 80, 80], settleMs: 1500, sampleMs: 4000 },
  { label: 'mobile_4k', counts: [2880, 800, 160, 160], settleMs: 2000, sampleMs: 5000 },
  { label: 'mobile_6k', counts: [4320, 1200, 240, 240], settleMs: 2000, sampleMs: 5000 },
]

interface BenchmarkAutorunOptions {
  sessionLabel: string
  submit: boolean
}

function makeBounds(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): AABB {
  return {
    min: new Vector3(minX, minY, minZ),
    max: new Vector3(maxX, maxY, maxZ),
  }
}

function makeCell(id: string, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): LeafCell {
  return {
    id,
    depth: 0,
    bounds: makeBounds(minX, minY, minZ, maxX, maxY, maxZ),
    kind: 'free',
    fieldBias: 0.5,
  }
}

function interaction(partial: Partial<BoidTypeInteraction> = {}): BoidTypeInteraction {
  return {
    separation: 0,
    alignment: 0,
    cohesion: 0,
    pursuit: 0,
    flee: 0,
    ignore: false,
    ...partial,
  }
}

function makeBenchmarkChunk(): ChunkData {
  const cells = [
    makeCell('a', -180, -120, -180, 0, 120, 0),
    makeCell('b', 0, -120, -180, 180, 120, 0),
    makeCell('c', -180, -120, 0, 0, 120, 180),
    makeCell('d', 0, -120, 0, 180, 120, 180),
  ]
  return {
    key: 'benchmark',
    coord: { x: 0, y: 0, z: 0 },
    seed: 1,
    bounds: makeBounds(-180, -120, -180, 180, 120, 180),
    cells,
    portals: [],
    adjacency: [
      ['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd'],
    ],
    obstacles: [],
    loot: [],
    mines: [],
  }
}

function cloneType(base: BoidTypeConfig, targetCount: number): BoidTypeConfig {
  return { ...base, targetCount }
}

function createBenchmarkConfig(counts: number[]): BoidsConfig {
  const boidTypes = [
    cloneType(AMBIENT_FISH_TYPE, counts[0]),
    cloneType(COMPANION_FISH_TYPE, counts[1]),
    cloneType(DRONE_TYPE, counts[2]),
    cloneType(PLANKTON_TYPE, counts[3]),
  ]
  const total = counts.reduce((sum, value) => sum + value, 0)
  return {
    enabled: true,
    maxBoids: Math.max(total, 1000),
    initialBoids: total,
    simulationRadius: 420,
    renderRadius: 480,
    spawnRadius: 220,
    despawnRadius: 520,
    perceptionRadius: 18,
    separationRadius: 6,
    minSpeed: 2,
    maxSpeed: 20,
    maxForce: 10,
    turnRate: 4,
    separationWeight: 1.5,
    alignmentWeight: 0.8,
    cohesionWeight: 0.5,
    wallAvoidanceWeight: 2.6,
    flowWeight: 0,
    playerAvoidanceWeight: 0,
    avoidPlayerRadius: 0,
    gridCellSize: 16,
    maxBoidsPerCell: 128,
    visual: {
      type: 'fish',
      scale: 1,
      animate: true,
      baseColor: 0x88ccff,
      emissiveStrength: 0.25,
      scaleVariation: 0.35,
      speedColoring: true,
      fogAware: false,
    },
    lod: {
      nearDistance: 120,
      midDistance: 260,
      farDistance: 480,
      cullDistance: 520,
    },
    fallback: { cpuMaxBoids: Math.max(total, 1000) },
    boidTypes,
    interactions: [
      [interaction({ separation: 1, alignment: 1, cohesion: 1 }), interaction({ separation: 0.85, alignment: 0.8, cohesion: 0.7 }), interaction({ separation: 1.1, flee: 0.15 }), interaction({ separation: 0.6, cohesion: 0.4 })],
      [interaction({ separation: 0.9, alignment: 0.9, cohesion: 0.8 }), interaction({ separation: 1, alignment: 1, cohesion: 1 }), interaction({ separation: 0.8, alignment: 0.4, cohesion: 0.25 }), interaction({ separation: 0.4, cohesion: 0.6 })],
      [interaction({ separation: 0.9, pursuit: 0.12 }), interaction({ separation: 0.8, pursuit: 0.12 }), interaction({ separation: 1, alignment: 0.6, cohesion: 0.2 }), interaction({ separation: 0.6, pursuit: 0.1 })],
      [interaction({ separation: 0.8, cohesion: 0.6 }), interaction({ separation: 0.4, cohesion: 0.7 }), interaction({ separation: 0.7, flee: 0.08 }), interaction({ separation: 1, alignment: 0.2, cohesion: 0.9 })],
    ],
  }
}

export class BoidsBenchmark {
  private readonly shell = document.createElement('div')
  private readonly viewport = document.createElement('div')
  private readonly overlay = document.createElement('div')
  private readonly typesEl = document.createElement('div')
  private readonly statsEl = document.createElement('div')
  private readonly hintEl = document.createElement('div')
  private readonly fpsPanel = new FpsPanel('Boids Benchmark FPS')
  private readonly renderer = new WebGLRenderer({ antialias: true })
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 2000)
  private readonly playerPosition = new Vector3(0, 0, 0)
  private readonly playerVelocity = new Vector3(0, 0, 0)
  private readonly playerForward = new Vector3(0, 0, 1)
  private readonly chunk = makeBenchmarkChunk()
  private counts = [4000, 1500, 500, 2000]
  private selectedType = 0
  private boids = this.createSystem()
  private running = false
  private lastTime = 0
  private sampleBuffer: BenchmarkFrameSample[] | null = null
  private autorunPromise: Promise<void> | null = null

  constructor(parent: HTMLElement) {
    this.shell.className = 'shell benchmark-shell'
    this.viewport.className = 'viewport'
    this.overlay.className = 'benchmark-overlay'
    this.typesEl.className = 'benchmark-types'
    this.statsEl.className = 'benchmark-stats'
    this.hintEl.className = 'benchmark-hints'
    this.hintEl.textContent = '1-4 select type  +/- change selected type by 500  autorun uses ?autorun=1'
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(new Color('#02070c'))
    this.viewport.append(this.renderer.domElement)
    this.scene.add(new AmbientLight(0xffffff, 1.6))
    this.camera.position.set(0, 70, 290)
    this.camera.lookAt(0, 0, 0)
    this.overlay.append(this.fpsPanel.root, this.statsEl, this.typesEl, this.hintEl)
    this.shell.append(this.viewport, this.overlay)
    parent.append(this.shell)
    this.scene.add(this.boids.object3d)
    this.rebuildTypeControls()
    window.addEventListener('resize', this.onResize)
    window.addEventListener('keydown', this.onKeyDown)
  }

  start(): void {
    this.running = true
    requestAnimationFrame(this.loop)
  }

  runAutorun(options: BenchmarkAutorunOptions): Promise<void> {
    if (this.autorunPromise) {
      return this.autorunPromise
    }
    this.autorunPromise = this.executeAutorun(options).finally(() => {
      this.autorunPromise = null
    })
    return this.autorunPromise
  }

  dispose(): void {
    this.running = false
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('keydown', this.onKeyDown)
    this.scene.remove(this.boids.object3d)
    this.boids.dispose()
    this.renderer.dispose()
  }

  private createSystem(): BoidsSystem {
    const system = new BoidsSystem(createBenchmarkConfig(this.counts))
    system.syncChunks([this.chunk], [])
    return system
  }

  private rebuildSystem(): void {
    const old = this.boids
    this.scene.remove(old.object3d)
    old.dispose()
    this.boids = this.createSystem()
    this.scene.add(this.boids.object3d)
    this.rebuildTypeControls()
  }

  private setCounts(counts: number[]): void {
    this.counts = [...counts]
    this.rebuildSystem()
  }

  private adjustSelectedType(delta: number): void {
    const next = Math.max(0, this.counts[this.selectedType] + delta)
    const totalWithoutSelected = this.counts.reduce((sum, value, index) => index === this.selectedType ? sum : sum + value, 0)
    this.counts[this.selectedType] = Math.min(MAX_BENCHMARK_BOIDS - totalWithoutSelected, next)
    this.rebuildSystem()
  }

  private rebuildTypeControls(): void {
    this.typesEl.innerHTML = ''
    let total = 0
    for (let i = 0; i < BENCHMARK_TYPE_ORDER.length; i++) {
      total += this.counts[i]
      const type = BENCHMARK_TYPE_ORDER[i]
      const row = document.createElement('div')
      row.className = 'benchmark-type-row' + (i === this.selectedType ? ' selected' : '')
      const label = document.createElement('button')
      label.className = 'benchmark-type-label'
      label.textContent = `${i + 1}. ${type.name}`
      label.addEventListener('click', () => {
        this.selectedType = i
        this.rebuildTypeControls()
      })
      const minus = document.createElement('button')
      minus.className = 'benchmark-step-btn'
      minus.textContent = '-'
      minus.addEventListener('click', () => this.adjustType(i, -COUNT_STEP))
      const value = document.createElement('span')
      value.className = 'benchmark-type-count'
      value.textContent = `${this.counts[i]}`
      const plus = document.createElement('button')
      plus.className = 'benchmark-step-btn'
      plus.textContent = '+'
      plus.addEventListener('click', () => this.adjustType(i, COUNT_STEP))
      row.append(label, minus, value, plus)
      this.typesEl.append(row)
    }
    this.statsEl.textContent = `total ${total}  mode ${this.boids.debug.gpuMode ? 'GPU' : 'CPU'}  visible ${this.boids.debug.boidCount}  active ${this.boids.debug.activeBoidCount}`
  }

  private adjustType(index: number, delta: number): void {
    this.selectedType = index
    const next = Math.max(0, this.counts[index] + delta)
    const totalWithoutSelected = this.counts.reduce((sum, value, i) => i === index ? sum : sum + value, 0)
    this.counts[index] = Math.min(MAX_BENCHMARK_BOIDS - totalWithoutSelected, next)
    this.rebuildSystem()
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key >= '1' && event.key <= '4') {
      this.selectedType = Number(event.key) - 1
      this.rebuildTypeControls()
      return
    }
    if (event.key === '+' || event.key === '=') {
      this.adjustSelectedType(COUNT_STEP)
      return
    }
    if (event.key === '-' || event.key === '_') {
      this.adjustSelectedType(-COUNT_STEP)
    }
  }

  private loop = (timestamp: number): void => {
    if (!this.running) return
    const rawDt = Math.max(0.0001, (timestamp - this.lastTime || 16.6) / 1000)
    const dt = Math.min(0.05, rawDt)
    this.lastTime = timestamp
    this.boids.update(dt, this.camera.position, this.playerPosition, this.playerVelocity, this.playerForward)
    this.renderer.render(this.scene, this.camera)
    const fps = 1 / rawDt
    this.fpsPanel.record(fps)
    const debug = this.boids.debug
    const total = this.counts.reduce((sum, value) => sum + value, 0)
    if (this.sampleBuffer) {
      this.sampleBuffer.push({
        timestampMs: performance.now(),
        fps,
        totalBoids: total,
        visibleBoids: debug.boidCount,
        activeBoids: debug.activeBoidCount,
        activeCells: debug.activeCells,
        simulationMs: debug.simulationMs,
        renderMs: debug.renderMs,
        neighborSearchMs: debug.neighborSearchMs,
        steeringMs: debug.steeringMs,
        avoidanceMs: debug.avoidanceMs,
        integrationMs: debug.integrationMs,
        avgNeighbors: debug.avgNeighbors,
        boidsFullCount: debug.boidsFullCount,
        boidsClusterCount: debug.boidsClusterCount,
        boidsPooledCount: debug.boidsPooledCount,
        boidsCulledCount: debug.boidsCulledCount,
        boidsEffectiveUpdateHz: debug.boidsEffectiveUpdateHz,
        gpuMode: debug.gpuMode,
      })
    }
    this.statsEl.textContent = `total ${total}  mode ${debug.gpuMode ? 'GPU' : 'CPU'}  visible ${debug.boidCount}  active ${debug.activeBoidCount}  cells ${debug.activeCells}  sim ${debug.simulationMs.toFixed(1)}ms  render ${debug.renderMs.toFixed(1)}ms`
    requestAnimationFrame(this.loop)
  }

  private async executeAutorun(options: BenchmarkAutorunOptions): Promise<void> {
    this.hintEl.textContent = 'collecting device profile'
    const device = await collectBenchmarkDeviceProfile(this.renderer)
    const startedAt = new Date().toISOString()
    const phases: BenchmarkPhaseReport[] = []
    const sessionId = `iphone-${Date.now()}`
    for (const scenario of AUTORUN_SCENARIOS) {
      this.setCounts(scenario.counts)
      this.hintEl.textContent = `running ${scenario.label}`
      await this.wait(scenario.settleMs)
      const samples = await this.capturePhaseSamples(scenario.sampleMs)
      const phase = summarizePhase(scenario.label, scenario.counts, scenario.sampleMs, samples)
      phases.push(phase)
      if (phase.fps.average < 24 || phase.frameMs.p95 > 50) {
        break
      }
    }
    const report: BenchmarkSessionReport = {
      schemaVersion: 1,
      sessionId,
      sessionLabel: options.sessionLabel,
      route: window.location.href,
      startedAt,
      completedAt: new Date().toISOString(),
      device,
      phases,
    }
    if (options.submit) {
      this.hintEl.textContent = 'uploading benchmark report'
      const response = await fetch('/__benchmark__/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report),
      })
      const payload = await response.json().catch(() => null) as { ok?: boolean; directory?: string; error?: string } | null
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `Benchmark upload failed with ${response.status}`)
      }
      this.hintEl.textContent = `saved to ${payload.directory}`
      return
    }
    this.hintEl.textContent = `completed ${phases.length} phases`
  }

  private capturePhaseSamples(durationMs: number): Promise<BenchmarkFrameSample[]> {
    this.sampleBuffer = []
    return new Promise(resolve => {
      window.setTimeout(() => {
        const samples = this.sampleBuffer ?? []
        this.sampleBuffer = null
        resolve(samples)
      }, durationMs)
    })
  }

  private wait(durationMs: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, durationMs))
  }
}

function summarizePhase(label: string, counts: number[], durationMs: number, samples: BenchmarkFrameSample[]): BenchmarkPhaseReport {
  const totalBoids = counts.reduce((sum, value) => sum + value, 0)
  const gpuFrames = samples.reduce((sum, sample) => sum + (sample.gpuMode ? 1 : 0), 0)
  return {
    label,
    counts: [...counts],
    totalBoids,
    durationMs,
    sampleCount: samples.length,
    gpuFrameRatio: samples.length > 0 ? gpuFrames / samples.length : 0,
    fps: summarizeNumberSamples(samples.map(sample => sample.fps)),
    frameMs: summarizeNumberSamples(samples.map(sample => 1000 / Math.max(sample.fps, 0.0001))),
    simulationMs: summarizeNumberSamples(samples.map(sample => sample.simulationMs)),
    renderMs: summarizeNumberSamples(samples.map(sample => sample.renderMs)),
    neighborSearchMs: summarizeNumberSamples(samples.map(sample => sample.neighborSearchMs)),
    steeringMs: summarizeNumberSamples(samples.map(sample => sample.steeringMs)),
    avoidanceMs: summarizeNumberSamples(samples.map(sample => sample.avoidanceMs)),
    integrationMs: summarizeNumberSamples(samples.map(sample => sample.integrationMs)),
    activeBoids: summarizeNumberSamples(samples.map(sample => sample.activeBoids)),
    visibleBoids: summarizeNumberSamples(samples.map(sample => sample.visibleBoids)),
    activeCells: summarizeNumberSamples(samples.map(sample => sample.activeCells)),
    avgNeighbors: summarizeNumberSamples(samples.map(sample => sample.avgNeighbors)),
    boidsEffectiveUpdateHz: summarizeNumberSamples(samples.map(sample => sample.boidsEffectiveUpdateHz)),
    boidsFullCount: summarizeNumberSamples(samples.map(sample => sample.boidsFullCount)),
    boidsClusterCount: summarizeNumberSamples(samples.map(sample => sample.boidsClusterCount)),
    boidsPooledCount: summarizeNumberSamples(samples.map(sample => sample.boidsPooledCount)),
    boidsCulledCount: summarizeNumberSamples(samples.map(sample => sample.boidsCulledCount)),
    samples,
  }
}
