import { describe, expect, it } from 'vitest'
import { buildBenchmarkMarkdown, sanitizeLabel, summarizeNumberSamples } from '../src/benchmark/reportUtils'
import type { BenchmarkSessionReport } from '../src/benchmark/reportTypes'

describe('benchmark report utils', () => {
  it('summarizes numeric samples with percentile output', () => {
    expect(summarizeNumberSamples([10, 20, 30, 40, 50])).toEqual({
      average: 30,
      minimum: 10,
      maximum: 50,
      p95: 50,
    })
  })

  it('sanitizes report labels for filesystem paths', () => {
    expect(sanitizeLabel('iPhone 15 Pro / Safari')).toBe('iphone-15-pro-safari')
  })

  it('renders benchmark markdown with device and phase details', () => {
    const report: BenchmarkSessionReport = {
      schemaVersion: 1,
      sessionId: 'iphone-123',
      sessionLabel: 'iphone-15-pro',
      route: 'http://192.168.0.10:4173/?benchmark=1&autorun=1',
      startedAt: '2026-05-31T00:00:00.000Z',
      completedAt: '2026-05-31T00:00:12.000Z',
      device: {
        capturedAt: '2026-05-31T00:00:00.000Z',
        userAgent: 'MobileSafari',
        platform: 'iPhone',
        language: 'en-US',
        languages: ['en-US'],
        timezone: 'America/Los_Angeles',
        hardwareConcurrency: 6,
        deviceMemoryGb: null,
        maxTouchPoints: 5,
        cookieEnabled: true,
        online: true,
        viewport: { width: 430, height: 932, devicePixelRatio: 3 },
        screen: {
          width: 430,
          height: 932,
          availWidth: 430,
          availHeight: 932,
          colorDepth: 24,
          pixelDepth: 24,
          orientation: 'portrait-primary',
        },
        webgl: {
          vendor: 'Apple',
          renderer: 'Apple GPU',
          version: 'WebGL 2.0',
          shadingLanguageVersion: 'WebGL GLSL ES 3.00',
          maxTextureSize: 4096,
          maxRenderbufferSize: 4096,
          antialias: true,
        },
        webgpu: {
          available: false,
          adapterInfo: {},
        },
      },
      phases: [
        {
          label: 'mobile_1k',
          counts: [720, 200, 40, 40],
          totalBoids: 1000,
          durationMs: 4000,
          sampleCount: 240,
          gpuFrameRatio: 0,
          fps: { average: 60, minimum: 57, maximum: 61, p95: 61 },
          frameMs: { average: 16.67, minimum: 16.2, maximum: 17.5, p95: 17.1 },
          simulationMs: { average: 4, minimum: 3, maximum: 7, p95: 6 },
          renderMs: { average: 5, minimum: 4, maximum: 9, p95: 8 },
          neighborSearchMs: { average: 1, minimum: 0.5, maximum: 1.5, p95: 1.4 },
          steeringMs: { average: 0.8, minimum: 0.5, maximum: 1.2, p95: 1.1 },
          avoidanceMs: { average: 0.6, minimum: 0.4, maximum: 1, p95: 0.9 },
          integrationMs: { average: 0.7, minimum: 0.5, maximum: 1.1, p95: 1 },
          activeBoids: { average: 1000, minimum: 1000, maximum: 1000, p95: 1000 },
          visibleBoids: { average: 820, minimum: 800, maximum: 850, p95: 845 },
          activeCells: { average: 32, minimum: 28, maximum: 35, p95: 34 },
          avgNeighbors: { average: 12, minimum: 8, maximum: 16, p95: 15 },
          boidsEffectiveUpdateHz: { average: 30, minimum: 30, maximum: 30, p95: 30 },
          boidsFullCount: { average: 420, minimum: 390, maximum: 450, p95: 445 },
          boidsClusterCount: { average: 250, minimum: 220, maximum: 280, p95: 275 },
          boidsPooledCount: { average: 130, minimum: 110, maximum: 150, p95: 148 },
          boidsCulledCount: { average: 20, minimum: 10, maximum: 30, p95: 28 },
          samples: [],
        },
      ],
    }

    const markdown = buildBenchmarkMarkdown(report)
    expect(markdown).toContain('## Device')
    expect(markdown).toContain('### mobile_1k')
    expect(markdown).toContain('`iphone-15-pro`')
    expect(markdown).toContain('`Apple GPU`')
  })
})
