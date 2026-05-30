import { describe, expect, it } from 'vitest'
import { selectBoidSimLevel } from '../src/boids/BoidsLOD'
import type { BoidLODConfig } from '../src/boids/BoidsTypes'

const lod: BoidLODConfig = {
  nearDistance: 60,
  midDistance: 160,
  farDistance: 320,
  cullDistance: 420,
}

describe('Boid LOD selection', () => {
  it('keeps near visible decorative boids fully simulated', () => {
    const selection = selectBoidSimLevel({
      lod,
      distanceToPlayer: 40,
      distanceToCamera: 40,
      fogVisible: true,
      visible: true,
      gameplayCritical: false,
      perfPressure: 0,
    })
    expect(selection.level).toBe('full')
    expect(selection.shaderLod).toBe('near')
    expect(selection.updateHz).toBe(60)
  })

  it('clusters mid and far visible decorative boids', () => {
    const mid = selectBoidSimLevel({
      lod,
      distanceToPlayer: 120,
      distanceToCamera: 120,
      fogVisible: true,
      visible: true,
      gameplayCritical: false,
      perfPressure: 0,
    })
    const far = selectBoidSimLevel({
      lod,
      distanceToPlayer: 280,
      distanceToCamera: 280,
      fogVisible: true,
      visible: true,
      gameplayCritical: false,
      perfPressure: 0,
    })
    expect(mid.level).toBe('cluster')
    expect(far.level).toBe('cluster')
    expect(mid.updateHz).toBeGreaterThan(far.updateHz)
  })

  it('pools decorative boids outside fog but before hard cull', () => {
    const selection = selectBoidSimLevel({
      lod,
      distanceToPlayer: 360,
      distanceToCamera: 360,
      fogVisible: false,
      visible: true,
      gameplayCritical: false,
      perfPressure: 0,
    })
    expect(selection.level).toBe('pooled')
    expect(selection.shaderLod).toBe('hidden')
    expect(selection.updateHz).toBe(0)
  })

  it('culls decorative boids outside visibility', () => {
    const selection = selectBoidSimLevel({
      lod,
      distanceToPlayer: 480,
      distanceToCamera: 480,
      fogVisible: false,
      visible: false,
      gameplayCritical: false,
      perfPressure: 0,
    })
    expect(selection.level).toBe('culled')
  })

  it('prefers pooled far decorative boids under low performance budget', () => {
    const selection = selectBoidSimLevel({
      lod,
      distanceToPlayer: 260,
      distanceToCamera: 260,
      fogVisible: true,
      visible: true,
      gameplayCritical: false,
      perfPressure: 0.9,
    })
    expect(selection.level).toBe('pooled')
  })

  it('keeps gameplay-critical systems exact even when hidden or under pressure', () => {
    const selection = selectBoidSimLevel({
      lod,
      distanceToPlayer: 800,
      distanceToCamera: 800,
      fogVisible: false,
      visible: false,
      gameplayCritical: true,
      perfPressure: 1,
    })
    expect(selection.level).toBe('full')
    expect(selection.updateHz).toBe(60)
  })
})
