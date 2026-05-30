import type { BoidsConfig, BoidTypeConfig, BoidTypeInteraction } from './BoidsTypes'

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

// ─── Boid type catalogue ─────────────────────────────────────────────────────

/** Ambient fish — spawn in free cells, avoid the player, no follow attractor. */
export const AMBIENT_FISH_TYPE: BoidTypeConfig = {
  typeId: 0,
  name: 'ambientFish',
  targetCount: 5000,
  maxSpeed: 18,
  minSpeed: 4,
  maxForce: 8,
  turnRate: 3.5,
  perceptionRadius: 18,
  separationRadius: 6,
  separationWeight: 1.8,
  alignmentWeight: 0.8,
  cohesionWeight: 0.45,
  wallAvoidanceWeight: 2.8,
  flowWeight: 0.6,
  playerAvoidanceWeight: 2.0,
  avoidPlayerRadius: 25,
  followTarget: null,
  scale: 1.0,
  color: 0x88ccff,
  emissiveStrength: 0.15,
  scaleVariation: 0.3,
}

/** Companion fish — follow the ship loosely.
 *  Each boid independently oscillates its personal target between
 *  2 s and 10 s ahead of the ship (period ~14 s, per-boid phase from seed).
 *  This makes the school breathe: some fish are close, some far,
 *  and they all drift back and forth organically.
 *  The school spawns behind the player so fish swim forward into view.
 */
export const COMPANION_FISH_TYPE: BoidTypeConfig = {
  typeId: 1,
  name: 'companionFish',
  targetCount: 1000,
  maxSpeed: 22,
  minSpeed: 5,
  maxForce: 10,
  turnRate: 4.5,
  perceptionRadius: 10,
  separationRadius: 2.5,
  separationWeight: 2.2,
  alignmentWeight: 1.0,
  cohesionWeight: 0.5,
  wallAvoidanceWeight: 1.2,
  flowWeight: 0.2,
  playerAvoidanceWeight: 0.0,
  avoidPlayerRadius: 0,
  followTarget: {
    minSeconds: 2,
    maxSeconds: 10,
    period: 14,
    spread: 6,
    weight: 4.5,
  },
  scale: 0.6,
  color: 0x44eeff,
  emissiveStrength: 0.45,
  scaleVariation: 0.2,
}

export const DRONE_TYPE: BoidTypeConfig = {
  typeId: 2,
  name: 'drone',
  targetCount: 0,
  maxSpeed: 12,
  minSpeed: 2,
  maxForce: 5,
  turnRate: 2.0,
  perceptionRadius: 24,
  separationRadius: 8,
  separationWeight: 1.2,
  alignmentWeight: 0.5,
  cohesionWeight: 0.3,
  wallAvoidanceWeight: 3.5,
  flowWeight: 0.4,
  playerAvoidanceWeight: 3.0,
  avoidPlayerRadius: 40,
  followTarget: null,
  scale: 1.4,
  color: 0xff8844,
  emissiveStrength: 0.6,
  scaleVariation: 0.1,
}

export const PLANKTON_TYPE: BoidTypeConfig = {
  typeId: 3,
  name: 'plankton',
  targetCount: 0,
  maxSpeed: 3,
  minSpeed: 0.5,
  maxForce: 2,
  turnRate: 1.0,
  perceptionRadius: 8,
  separationRadius: 2,
  separationWeight: 1.0,
  alignmentWeight: 0.2,
  cohesionWeight: 0.8,
  wallAvoidanceWeight: 2.0,
  flowWeight: 1.2,
  playerAvoidanceWeight: 0.5,
  avoidPlayerRadius: 8,
  followTarget: null,
  scale: 0.3,
  color: 0x44ffaa,
  emissiveStrength: 0.7,
  scaleVariation: 0.5,
}

export const MINE_TYPE: BoidTypeConfig = {
  typeId: 4,
  name: 'mine',
  targetCount: 0,
  maxSpeed: 24,
  minSpeed: 1.2,
  maxForce: 24,
  turnRate: 5.5,
  perceptionRadius: 18,
  separationRadius: 6,
  separationWeight: 3.2,
  alignmentWeight: 0.35,
  cohesionWeight: 0.2,
  wallAvoidanceWeight: 4.2,
  flowWeight: 0.1,
  playerAvoidanceWeight: 0,
  avoidPlayerRadius: 0,
  followTarget: null,
  scale: 0.8,
  color: 0xff5566,
  emissiveStrength: 0.9,
  scaleVariation: 0.08,
}

// ─── System-level configs ─────────────────────────────────────────────────────

/** Large ambient school — spawns in free OctoBox cells around the player. */
export const DEFAULT_BOIDS_CONFIG: BoidsConfig = {
  enabled: true,
  maxBoids: 50000,
  initialBoids: 5000,
  simulationRadius: 400,
  renderRadius: 500,
  spawnRadius: 350,
  despawnRadius: 650,
  perceptionRadius: 18,
  separationRadius: 6,
  minSpeed: 4,
  maxSpeed: 18,
  maxForce: 8,
  turnRate: 3.5,
  separationWeight: 1.8,
  alignmentWeight: 0.8,
  cohesionWeight: 0.45,
  wallAvoidanceWeight: 2.8,
  flowWeight: 0.6,
  playerAvoidanceWeight: 2.0,
  avoidPlayerRadius: 25,
  gridCellSize: 18,
  maxBoidsPerCell: 128,
  visual: {
    type: 'fish',
    scale: 1.0,
    animate: true,
    baseColor: 0x88ccff,
    emissiveStrength: 0.15,
    scaleVariation: 0.3,
    speedColoring: true,
    fogAware: true,
  },
  lod: {
    nearDistance: 120,
    midDistance: 280,
    farDistance: 500,
    cullDistance: 650,
  },
  fallback: { cpuMaxBoids: 3000 },
  boidTypes: [AMBIENT_FISH_TYPE],
  interactions: [
    [interaction({ separation: 1, alignment: 1, cohesion: 1 })],
  ],
}

/** Companion school — 1k fish, world-spawned through the same free-cell path as
 *  the rest of the world. They differ only by predictor-based followTarget.
 */
export const COMPANION_BOIDS_CONFIG: BoidsConfig = {
  enabled: true,
  maxBoids: 1000,
  initialBoids: 1000,
  simulationRadius: 300,
  renderRadius: 360,
  spawnRadius: 300,
  despawnRadius: 420,
  perceptionRadius: 10,
  separationRadius: 2.5,
  minSpeed: 5,
  maxSpeed: 22,
  maxForce: 10,
  turnRate: 4.5,
  separationWeight: 2.2,
  alignmentWeight: 1.0,
  cohesionWeight: 0.5,
  wallAvoidanceWeight: 1.2,
  flowWeight: 0.2,
  playerAvoidanceWeight: 0.0,
  avoidPlayerRadius: 0,
  gridCellSize: 12,
  maxBoidsPerCell: 64,
  visual: {
    type: 'fish',
    scale: 0.6,
    animate: true,
    baseColor: 0x44eeff,
    emissiveStrength: 0.45,
    scaleVariation: 0.2,
    speedColoring: false,
    fogAware: true,
  },
  lod: {
    nearDistance: 60,
    midDistance: 140,
    farDistance: 360,
    cullDistance: 420,
  },
  fallback: { cpuMaxBoids: 1000 },
  boidTypes: [COMPANION_FISH_TYPE],
  interactions: [
    [interaction({ separation: 1, alignment: 1, cohesion: 1 })],
  ],
}

/** Unified fish world: ambient + companion species in one shared BoidsSystem.
 *  Both spawn from the same free-cell pipeline. Companion fish differ only by
 *  followTarget and stronger cross-species schooling response.
 */
export const UNIFIED_FISH_BOIDS_CONFIG: BoidsConfig = {
  enabled: true,
  maxBoids: 6000,
  initialBoids: 6000,
  simulationRadius: 360,
  renderRadius: 500,
  spawnRadius: 360,
  despawnRadius: 650,
  perceptionRadius: 18,
  separationRadius: 6,
  minSpeed: 4,
  maxSpeed: 22,
  maxForce: 10,
  turnRate: 4.5,
  separationWeight: 1.8,
  alignmentWeight: 0.8,
  cohesionWeight: 0.45,
  wallAvoidanceWeight: 2.8,
  flowWeight: 0.6,
  playerAvoidanceWeight: 2.0,
  avoidPlayerRadius: 25,
  gridCellSize: 24,
  maxBoidsPerCell: 128,
  visual: {
    type: 'fish',
    scale: 1.0,
    animate: true,
    baseColor: 0x88ccff,
    emissiveStrength: 0.2,
    scaleVariation: 0.3,
    speedColoring: true,
    fogAware: true,
  },
  lod: {
    nearDistance: 120,
    midDistance: 280,
    farDistance: 500,
    cullDistance: 650,
  },
  fallback: { cpuMaxBoids: 6000 },
  boidTypes: [AMBIENT_FISH_TYPE, COMPANION_FISH_TYPE],
  interactions: [
    [
      interaction({ separation: 1, alignment: 1, cohesion: 1 }),
      interaction({ separation: 0.8, alignment: 0.8, cohesion: 0.7 }),
    ],
    [
      interaction({ separation: 1.1, alignment: 1.0, cohesion: 0.9 }),
      interaction({ separation: 1, alignment: 1, cohesion: 1 }),
    ],
  ],
}

export const UNIFIED_WORLD_BOIDS_CONFIG: BoidsConfig = {
  ...UNIFIED_FISH_BOIDS_CONFIG,
  maxBoids: 7000,
  initialBoids: 6000,
  fallback: { cpuMaxBoids: 7000 },
  boidTypes: [AMBIENT_FISH_TYPE, COMPANION_FISH_TYPE, MINE_TYPE],
  interactions: [
    [
      interaction({ separation: 1, alignment: 1, cohesion: 1 }),
      interaction({ separation: 0.8, alignment: 0.8, cohesion: 0.7 }),
      interaction({ separation: 2.8, flee: 1.2 }),
    ],
    [
      interaction({ separation: 1.1, alignment: 1.0, cohesion: 0.9 }),
      interaction({ separation: 1, alignment: 1, cohesion: 1 }),
      interaction({ separation: 3.2, flee: 1.5 }),
    ],
    [
      interaction({ separation: 1.2, pursuit: 0.35 }),
      interaction({ separation: 1.4, pursuit: 0.5 }),
      interaction({ separation: 1, alignment: 0.3, cohesion: 0.15 }),
    ],
  ],
}
