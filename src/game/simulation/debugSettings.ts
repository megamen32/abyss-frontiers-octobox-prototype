export interface DebugToggleState {
  debugEnabled: boolean
  debugUiVisible: boolean
  chunkDebugEnabled: boolean
  fogEnabled: boolean
  boidsDebugVisible: boolean
}

export type DebugToggleKind = 'debug' | 'fps' | 'chunks' | 'fog' | 'boids'

export function applyDebugToggle(state: DebugToggleState, kind: DebugToggleKind, enabled: boolean): DebugToggleState {
  const next = { ...state }
  if (kind === 'debug') {
    next.debugEnabled = enabled
    if (!enabled) next.debugUiVisible = false
    return next
  }
  if (kind === 'fps') {
    next.debugUiVisible = enabled
    if (enabled) next.debugEnabled = true
    return next
  }
  if (kind === 'chunks') {
    next.chunkDebugEnabled = enabled
    return next
  }
  if (kind === 'fog') {
    next.fogEnabled = enabled
    return next
  }
  next.boidsDebugVisible = enabled
  if (enabled) {
    next.debugEnabled = true
    next.debugUiVisible = true
  }
  return next
}
