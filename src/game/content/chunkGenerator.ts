import type { ChunkBuildTimings, ChunkCoord, ChunkData } from '../types';
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
    return this.generateProfiled(coord).chunk;
  }

  generateProfiled(coord: ChunkCoord): { chunk: ChunkData; timings: ChunkBuildTimings } {
    const totalStart = performance.now();
    const bounds = chunkBounds(coord);
    const seed = chunkSeed(this.globalSeed, coord);
    const rng = new SeededRandom(seed);
    const portals = generatePortals(this.globalSeed, coord, bounds);
    const octoboxStart = performance.now();
    const cells = generateOctoBoxLeaves(bounds, seed);
    const octoboxMs = performance.now() - octoboxStart;
    const navigationStart = performance.now();
    const adjacencyAll = buildAdjacency(cells);
    const freeIds = buildNavigableSet(cells, portals, adjacencyAll, rng, bounds);
    const navigationMs = performance.now() - navigationStart;

    for (const cell of cells) {
      if (freeIds.has(cell.id)) {
        cell.kind = 'free';
      }
    }

    const obstaclesStart = performance.now();
    const obstacles = placeObstacles(cells, portals, rng);
    const obstaclesMs = performance.now() - obstaclesStart;
    const lootStart = performance.now();
    const loot = placeLoot(cells, portals, rng);
    const lootMs = performance.now() - lootStart;
    const minesStart = performance.now();
    const mines = placeMines(cells, portals, rng, chunkKey(coord));
    const minesMs = performance.now() - minesStart;
    const adjacency = adjacencyAll.filter(([a, b]) => freeIds.has(a) && freeIds.has(b));

    const obstacleCells = new Set(obstacles.map((obstacle) => obstacle.cellId));
    for (const cell of cells) {
      if (obstacleCells.has(cell.id)) {
        cell.kind = 'obstacle';
      }
    }

    const chunk: ChunkData = {
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

    return {
      chunk,
      timings: {
        totalMs: performance.now() - totalStart,
        octoboxMs,
        navigationMs,
        obstaclesMs,
        lootMs,
        minesMs,
        serializeMs: 0,
      },
    };
  }
}
