import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { GAME_CONFIG } from '../src/game/config'
import { runIfGameStateAdvances, shouldAdvanceGameState } from '../src/game/simulation/pausePolicy'
import { createInitialPlayerState, updatePlayer } from '../src/game/simulation/player'
import { updateMinesInChunk } from '../src/game/simulation/mines'
import type { ChunkData, Mine } from '../src/game/types'

describe('pause policy', () => {
  it('prevents mine telegraph and rocket state from advancing while paused', () => {
    const player = createInitialPlayerState()
    player.position.set(20, 0, 0)
    const mine = makeMine('targeting')
    const chunk = makeChunk([mine])
    const timerBefore = mine.telegraphTimer
    const positionBefore = mine.position.clone()
    let calls = 0

    runIfGameStateAdvances(true, () => {
      calls += 1
      updateMinesInChunk(chunk, player, 0.5)
    })

    expect(calls).toBe(0)
    expect(mine.state).toBe('targeting')
    expect(mine.telegraphTimer).toBe(timerBefore)
    expect(mine.position).toEqual(positionBefore)
  })

  it('allows mine updates after pause is released', () => {
    const player = createInitialPlayerState()
    player.position.set(20, 0, 0)
    const mine = makeMine('targeting')
    const chunk = makeChunk([mine])

    runIfGameStateAdvances(false, () => updateMinesInChunk(chunk, player, 0.5))

    expect(mine.telegraphTimer).toBeLessThan(GAME_CONFIG.mines.telegraphDuration)
  })

  it('prevents non-mine player physics from advancing while paused', () => {
    const player = createInitialPlayerState()
    const positionBefore = player.position.clone()
    const invulnerabilityBefore = player.invulnerabilityTimer

    runIfGameStateAdvances(true, () => updatePlayer(player, 1))

    expect(player.position).toEqual(positionBefore)
    expect(player.invulnerabilityTimer).toBe(invulnerabilityBefore)
  })

  it('allows non-mine player physics after pause is released', () => {
    const player = createInitialPlayerState()
    const positionBefore = player.position.clone()

    runIfGameStateAdvances(false, () => updatePlayer(player, 1))

    expect(player.position.distanceTo(positionBefore)).toBeGreaterThan(0)
    expect(shouldAdvanceGameState(false)).toBe(true)
    expect(shouldAdvanceGameState(true)).toBe(false)
  })
})

function makeMine(state: Mine['state']): Mine {
  return {
    id: 'pause-mine',
    originChunkKey: '0,0,0',
    anchorCellId: 'cell',
    position: new Vector3(0, 0, 0),
    velocity: new Vector3(1, 0, 0),
    radius: GAME_CONFIG.mines.radius,
    triggerRadius: GAME_CONFIG.mines.triggerRadius,
    speed: GAME_CONFIG.mines.launchSpeed,
    damage: GAME_CONFIG.mines.damage,
    state,
    armed: true,
    targetPosition: new Vector3(20, 0, 0),
    telegraphTimer: GAME_CONFIG.mines.telegraphDuration,
  }
}

function makeChunk(mines: Mine[]): ChunkData {
  return {
    key: '0,0,0',
    coord: { x: 0, y: 0, z: 0 },
    seed: 1,
    bounds: {
      min: new Vector3(-64, -64, -64),
      max: new Vector3(64, 64, 64),
    },
    cells: [],
    portals: [],
    adjacency: [],
    obstacles: [],
    loot: [],
    mines,
  }
}
