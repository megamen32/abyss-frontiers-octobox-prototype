import type { BoidLODConfig, BoidShaderLod, BoidSimLevel } from './BoidsTypes'

export interface BoidLODSelectionInput {
  lod: BoidLODConfig
  distanceToPlayer: number
  distanceToCamera: number
  fogVisible: boolean
  visible: boolean
  gameplayCritical: boolean
  perfPressure: number
}

export interface BoidLODSelection {
  level: BoidSimLevel
  shaderLod: BoidShaderLod
  updateHz: number
}

export function selectBoidSimLevel(input: BoidLODSelectionInput): BoidLODSelection {
  if (input.gameplayCritical) {
    return { level: 'full', shaderLod: 'near', updateHz: 60 }
  }

  const nearestDistance = Math.min(input.distanceToPlayer, input.distanceToCamera)
  if (!input.visible || nearestDistance > input.lod.cullDistance) {
    return { level: 'culled', shaderLod: 'hidden', updateHz: 0 }
  }

  if (!input.fogVisible || nearestDistance > input.lod.farDistance) {
    return { level: 'pooled', shaderLod: 'hidden', updateHz: 0 }
  }

  const pressure = Math.max(0, Math.min(1, input.perfPressure))
  const exactNearDistance = input.lod.nearDistance * (pressure >= 0.75 ? 0.65 : pressure >= 0.5 ? 0.85 : 1)
  if (nearestDistance <= exactNearDistance) {
    return { level: 'full', shaderLod: 'near', updateHz: 60 }
  }

  if (pressure >= 0.75 && nearestDistance > input.lod.midDistance) {
    return { level: 'pooled', shaderLod: 'hidden', updateHz: 0 }
  }

  if (nearestDistance <= input.lod.midDistance) {
    return { level: 'cluster', shaderLod: 'cluster', updateHz: pressure >= 0.5 ? 20 : 30 }
  }

  return { level: 'cluster', shaderLod: 'cluster', updateHz: pressure >= 0.5 ? 12 : 20 }
}
