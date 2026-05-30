import { describe, expect, it } from 'vitest'
import { applyDebugToggle, type DebugToggleState } from '../src/game/simulation/debugSettings'

const baseState: DebugToggleState = {
  debugEnabled: false,
  debugUiVisible: false,
  chunkDebugEnabled: false,
  fogEnabled: true,
  boidsDebugVisible: false,
}

describe('debug toggles', () => {
  it('enables the FPS/debug UI deterministically', () => {
    const next = applyDebugToggle(baseState, 'fps', true)
    expect(next.debugEnabled).toBe(true)
    expect(next.debugUiVisible).toBe(true)
    expect(baseState.debugEnabled).toBe(false)
  })

  it('hides FPS/debug UI when debug is disabled', () => {
    const next = applyDebugToggle({
      ...baseState,
      debugEnabled: true,
      debugUiVisible: true,
      boidsDebugVisible: true,
    }, 'debug', false)
    expect(next.debugEnabled).toBe(false)
    expect(next.debugUiVisible).toBe(false)
    expect(next.boidsDebugVisible).toBe(true)
  })

  it('toggles fog and chunk overlays without changing FPS/debug UI', () => {
    const noFog = applyDebugToggle(baseState, 'fog', false)
    const chunks = applyDebugToggle(baseState, 'chunks', true)
    expect(noFog.fogEnabled).toBe(false)
    expect(noFog.debugUiVisible).toBe(false)
    expect(chunks.chunkDebugEnabled).toBe(true)
    expect(chunks.debugUiVisible).toBe(false)
  })

  it('enables boids LOD overlay only when explicitly requested', () => {
    const next = applyDebugToggle(baseState, 'boids', true)
    expect(next.boidsDebugVisible).toBe(true)
    expect(next.debugEnabled).toBe(true)
    expect(next.debugUiVisible).toBe(true)

    const disabled = applyDebugToggle(next, 'boids', false)
    expect(disabled.boidsDebugVisible).toBe(false)
    expect(disabled.debugUiVisible).toBe(true)
  })
})
