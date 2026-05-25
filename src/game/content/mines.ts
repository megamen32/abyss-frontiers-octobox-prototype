import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { LeafCell, Mine, Portal } from '../types';
import { aabbCenter, aabbSize, intersectsAabb } from '../utils/chunk';
import { SeededRandom } from '../utils/rng';

export function placeMines(cells: LeafCell[], portals: Portal[], rng: SeededRandom, chunkKey: string): Mine[] {
  const mines: Mine[] = [];
  const candidates = cells
    .filter((cell) => cell.kind !== 'obstacle')
    .filter((cell) => !portals.some((portal) => intersectsAabb(cell.bounds, portal.bounds)))
    .sort((a, b) => a.caveBias - b.caveBias);

  for (const cell of candidates) {
    if (mines.length >= GAME_CONFIG.mines.maxPerChunk) {
      break;
    }
    const size = aabbSize(cell.bounds);
    const minEdge = Math.min(size.x, size.y, size.z);
    if (minEdge < GAME_CONFIG.ship.radius * 3.5) {
      continue;
    }
    if (rng.next() > 0.16) {
      continue;
    }

    const center = aabbCenter(cell.bounds);
    const offset = new Vector3(
      rng.range(-size.x * 0.15, size.x * 0.15),
      rng.range(-size.y * 0.15, size.y * 0.15),
      rng.range(-size.z * 0.15, size.z * 0.15),
    );
    mines.push({
      id: `${cell.id}:mine:${mines.length}`,
      originChunkKey: chunkKey,
      anchorCellId: cell.id,
      position: center.add(offset),
      velocity: new Vector3(),
      radius: GAME_CONFIG.mines.radius,
      triggerRadius: GAME_CONFIG.mines.triggerRadius,
      speed: GAME_CONFIG.mines.launchSpeed,
      damage: GAME_CONFIG.mines.damage,
      state: 'idle',
      armed: true,
      targetPosition: null,
      telegraphTimer: 0,
    });
  }

  return mines;
}
