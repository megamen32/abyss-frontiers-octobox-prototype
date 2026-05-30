import type { BenchmarkPhaseReport, BenchmarkSessionReport, NumericSummary } from './reportTypes'

export function summarizeNumberSamples(samples: number[]): NumericSummary {
  if (samples.length === 0) {
    return { average: 0, minimum: 0, maximum: 0, p95: 0 }
  }
  const sorted = [...samples].sort((left, right) => left - right)
  return {
    average: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    minimum: sorted[0],
    maximum: sorted[sorted.length - 1],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
  }
}

export function sanitizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'session'
}

export function buildBenchmarkMarkdown(report: BenchmarkSessionReport): string {
  const lines: string[] = [
    '# iPhone Benchmark Report',
    '',
    `- Session: \`${report.sessionId}\``,
    `- Label: \`${report.sessionLabel}\``,
    `- Route: \`${report.route}\``,
    `- Started: \`${report.startedAt}\``,
    `- Completed: \`${report.completedAt}\``,
    '',
    '## Device',
    '',
    `- User agent: \`${report.device.userAgent}\``,
    `- Platform: \`${report.device.platform}\``,
    `- Language: \`${report.device.language}\``,
    `- Timezone: \`${report.device.timezone}\``,
    `- Hardware concurrency: \`${report.device.hardwareConcurrency ?? 'n/a'}\``,
    `- Device memory (GB): \`${report.device.deviceMemoryGb ?? 'n/a'}\``,
    `- Touch points: \`${report.device.maxTouchPoints}\``,
    `- Viewport: \`${report.device.viewport.width}x${report.device.viewport.height} @ ${fixed(report.device.viewport.devicePixelRatio)}x\``,
    `- Screen: \`${report.device.screen.width}x${report.device.screen.height}\``,
    `- WebGL renderer: \`${report.device.webgl.renderer ?? 'n/a'}\``,
    `- WebGL vendor: \`${report.device.webgl.vendor ?? 'n/a'}\``,
    `- WebGPU available: \`${report.device.webgpu.available}\``,
    '',
    '## Phases',
    '',
  ]
  for (const phase of report.phases) {
    appendPhase(lines, phase)
  }
  return `${lines.join('\n')}\n`
}

function appendPhase(lines: string[], phase: BenchmarkPhaseReport): void {
  lines.push(`### ${phase.label}`)
  lines.push('')
  lines.push(`- Counts: \`${phase.counts.join(' / ')}\` (total \`${phase.totalBoids}\`)`)
  lines.push(`- Samples: \`${phase.sampleCount}\` over \`${fixed(phase.durationMs)}ms\``)
  lines.push(`- GPU frame ratio: \`${fixed(phase.gpuFrameRatio * 100)}%\``)
  lines.push(`- FPS: avg \`${fixed(phase.fps.average)}\`, p95 \`${fixed(phase.fps.p95)}\`, min \`${fixed(phase.fps.minimum)}\``)
  lines.push(`- Frame time: avg \`${fixed(1000 / Math.max(phase.fps.average, 0.0001))}ms\`, p95 \`${fixed(phase.frameMs.p95)}ms\`, max \`${fixed(phase.frameMs.maximum)}ms\``)
  lines.push(`- Simulation: avg \`${fixed(phase.simulationMs.average)}ms\`, p95 \`${fixed(phase.simulationMs.p95)}ms\``)
  lines.push(`- Render: avg \`${fixed(phase.renderMs.average)}ms\`, p95 \`${fixed(phase.renderMs.p95)}ms\``)
  lines.push(`- Neighbor search: avg \`${fixed(phase.neighborSearchMs.average)}ms\`, p95 \`${fixed(phase.neighborSearchMs.p95)}ms\``)
  lines.push(`- Steering: avg \`${fixed(phase.steeringMs.average)}ms\`, p95 \`${fixed(phase.steeringMs.p95)}ms\``)
  lines.push(`- Avoidance: avg \`${fixed(phase.avoidanceMs.average)}ms\`, p95 \`${fixed(phase.avoidanceMs.p95)}ms\``)
  lines.push(`- Integration: avg \`${fixed(phase.integrationMs.average)}ms\`, p95 \`${fixed(phase.integrationMs.p95)}ms\``)
  lines.push(`- Active boids: avg \`${fixed(phase.activeBoids.average)}\`, visible avg \`${fixed(phase.visibleBoids.average)}\``)
  lines.push(`- Active cells: avg \`${fixed(phase.activeCells.average)}\``)
  lines.push(`- Avg neighbors: avg \`${fixed(phase.avgNeighbors.average)}\``)
  lines.push(`- Effective update Hz: avg \`${fixed(phase.boidsEffectiveUpdateHz.average)}\``)
  lines.push(`- LOD counts: full \`${fixed(phase.boidsFullCount.average)}\`, cluster \`${fixed(phase.boidsClusterCount.average)}\`, pooled \`${fixed(phase.boidsPooledCount.average)}\`, culled \`${fixed(phase.boidsCulledCount.average)}\``)
  lines.push('')
}

function fixed(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
}
