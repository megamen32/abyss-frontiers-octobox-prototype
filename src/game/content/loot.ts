import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { LeafCell, Loot, Portal } from '../types';
import { aabbCenter, aabbSize, intersectsAabb } from '../utils/chunk';
import { SeededRandom } from '../utils/rng';

export function placeLoot(cells: LeafCell[], portals: Portal[], rng: SeededRandom): Loot[] {
  const loot: Loot[] = [];
  const max = GAME_CONFIG.world.maxLootPerChunk;

  for (const cell of cells) {
    if (loot.length >= max || cell.kind !== 'free' || rng.next() > 0.28) {
      continue;
    }
    if (portals.some((portal) => intersectsAabb(cell.bounds, portal.bounds))) {
      continue;
    }

    const size = aabbSize(cell.bounds);
    const spread = size.clone().multiplyScalar(0.32);
    const center = aabbCenter(cell.bounds).add(
      new Vector3(rng.range(-spread.x, spread.x), rng.range(-spread.y, spread.y), rng.range(-spread.z, spread.z)),
    );
    const type = rng.next() < 0.12 ? 'chest' : 'coin';
    loot.push({
      id: `${cell.id}:loot:${loot.length}`,
      type,
      position: center,
      radius: type === 'coin' ? GAME_CONFIG.collision.coinRadius : GAME_CONFIG.collision.chestRadius,
      value: type === 'coin' ? 1 : 10,
      collected: false,
      cellId: cell.id,
    });
  }

  return loot;
}
