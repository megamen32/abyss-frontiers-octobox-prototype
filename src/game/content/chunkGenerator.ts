import type { ChunkCoord, ChunkData } from '../types';
import { chunkBounds, chunkKey } from '../utils/chunk';
import { chunkSeed } from '../utils/hash';
import { SeededRandom } from '../utils/rng';
import { generateOctoBoxLeaves } from './octobox';
import { generatePortals } from './portals';
import { buildAdjacency, buildNavigableSet } from './navigation';
import { placeObstacles } from './obstacles';
import { placeLoot } from './loot';

export class ChunkGenerator {
  constructor(private readonly globalSeed: number) {}

  generate(coord: ChunkCoord): ChunkData {
    const bounds = chunkBounds(coord);
    const seed = chunkSeed(this.globalSeed, coord);
    const rng = new SeededRandom(seed);
    const portals = generatePortals(this.globalSeed, coord, bounds);
    const cells = generateOctoBoxLeaves(bounds, seed);
    const adjacencyAll = buildAdjacency(cells);
    const freeIds = buildNavigableSet(cells, portals, adjacencyAll, rng, bounds);

    for (const cell of cells) {
      if (freeIds.has(cell.id)) {
        cell.kind = 'free';
      }
    }

    const obstacles = placeObstacles(cells, portals, rng);
    const loot = placeLoot(cells, portals, rng);
    const adjacency = adjacencyAll.filter(([a, b]) => freeIds.has(a) && freeIds.has(b));

    for (const cell of cells) {
      if (cell.kind === 'empty' && rng.next() < 0.55) {
        cell.kind = 'obstacle';
      }
    }

    return {
      key: chunkKey(coord),
      coord,
      seed,
      bounds,
      cells,
      portals,
      adjacency,
      obstacles,
      loot,
    };
  }
}
