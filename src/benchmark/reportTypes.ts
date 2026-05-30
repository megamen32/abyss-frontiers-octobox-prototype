export interface NumericSummary {
  average: number
  minimum: number
  maximum: number
  p95: number
}

export interface BenchmarkDeviceProfile {
  capturedAt: string
  userAgent: string
  platform: string
  language: string
  languages: string[]
  timezone: string
  hardwareConcurrency: number | null
  deviceMemoryGb: number | null
  maxTouchPoints: number
  cookieEnabled: boolean
  online: boolean
  viewport: {
    width: number
    height: number
    devicePixelRatio: number
  }
  screen: {
    width: number
    height: number
    availWidth: number
    availHeight: number
    colorDepth: number
    pixelDepth: number
    orientation: string
  }
  webgl: {
    vendor: string | null
    renderer: string | null
    version: string | null
    shadingLanguageVersion: string | null
    maxTextureSize: number | null
    maxRenderbufferSize: number | null
    antialias: boolean
  }
  webgpu: {
    available: boolean
    adapterInfo: Record<string, string | number | boolean | null>
  }
}

export interface BenchmarkFrameSample {
  timestampMs: number
  fps: number
  totalBoids: number
  visibleBoids: number
  activeBoids: number
  activeCells: number
  simulationMs: number
  renderMs: number
  neighborSearchMs: number
  steeringMs: number
  avoidanceMs: number
  integrationMs: number
  avgNeighbors: number
  boidsFullCount: number
  boidsClusterCount: number
  boidsPooledCount: number
  boidsCulledCount: number
  boidsEffectiveUpdateHz: number
  gpuMode: boolean
}

export interface BenchmarkPhaseReport {
  label: string
  counts: number[]
  totalBoids: number
  durationMs: number
  sampleCount: number
  gpuFrameRatio: number
  fps: NumericSummary
  frameMs: NumericSummary
  simulationMs: NumericSummary
  renderMs: NumericSummary
  neighborSearchMs: NumericSummary
  steeringMs: NumericSummary
  avoidanceMs: NumericSummary
  integrationMs: NumericSummary
  activeBoids: NumericSummary
  visibleBoids: NumericSummary
  activeCells: NumericSummary
  avgNeighbors: NumericSummary
  boidsEffectiveUpdateHz: NumericSummary
  boidsFullCount: NumericSummary
  boidsClusterCount: NumericSummary
  boidsPooledCount: NumericSummary
  boidsCulledCount: NumericSummary
  samples: BenchmarkFrameSample[]
}

export interface BenchmarkSessionReport {
  schemaVersion: 1
  sessionId: string
  sessionLabel: string
  route: string
  startedAt: string
  completedAt: string
  device: BenchmarkDeviceProfile
  phases: BenchmarkPhaseReport[]
}
