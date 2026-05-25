import type { ChunkCoord, ChunkData } from '../types';
import { chunkBounds, chunkKey } from '../utils/chunk';
import { chunkSeed } from '../utils/hash';
import { SeededRandom } from '../utils/rng';
import { generateOctoBoxLeaves } from './octobox';
import { generatePortals } from './portals';
import { buildAdjacency, buildNavigableSet } from './navigation';
import { placeObstacles } from './obstacles';
import { placeLoot } from './loot';
import { placeMines } from './mines';

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
    const mines = placeMines(cells, portals, rng, chunkKey(coord));
    const adjacency = adjacencyAll.filter(([a, b]) => freeIds.has(a) && freeIds.has(b));

    const obstacleCells = new Set(obstacles.map((obstacle) => obstacle.cellId));
    for (const cell of cells) {
      if (obstacleCells.has(cell.id)) {
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
      mines,
    };
  }
}
