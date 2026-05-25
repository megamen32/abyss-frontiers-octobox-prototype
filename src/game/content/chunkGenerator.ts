import type { ChunkBuildTimings, ChunkCoord, ChunkData } from '../types';
import { chunkBounds, chunkKey } from '../utils/chunk';
import { chunkSeed } from '../utils/hash';
import { SeededRandom } from '../utils/rng';
import { generateOctoBoxLeaves } from './octobox';
import { generatePortals } from './portals';
import { buildAdjacency, buildNavigableSet, ensurePortalConnectivity } from './navigation';
import { placeObstacles } from './obstacles';
import { placeLoot } from './loot';
import { placeMines } from './mines';
import { buildGreedyStaticMesh } from './greedyMesher';
import { detectCaveChunk, generateCaveChunkData } from './caveSystem';

export class ChunkGenerator {
  constructor(private readonly globalSeed: number) {}

  generate(coord: ChunkCoord): ChunkData {
    return this.generateProfiled(coord).chunk;
  }

  generateProfiled(coord: ChunkCoord): { chunk: ChunkData; timings: ChunkBuildTimings } {
    const totalStart = performance.now();
    const bounds = chunkBounds(coord);
    const seed = chunkSeed(this.globalSeed, coord);
    const portals = generatePortals(this.globalSeed, coord, bounds);

    const caveEntrance = detectCaveChunk(this.globalSeed, coord);
    if (caveEntrance) {
      const caveStart = performance.now();
      const caveResult = generateCaveChunkData(coord, bounds, portals, caveEntrance);
      const caveMs = performance.now() - caveStart;
      const chunk: ChunkData = {
        key: chunkKey(coord),
        coord,
        seed,
        bounds,
        cells: caveResult.cells,
        portals,
        adjacency: caveResult.adjacency,
        obstacles: caveResult.obstacles,
        staticMeshData: caveResult.staticMeshData,
        loot: caveResult.loot,
        mines: caveResult.mines,
      };
      return {
        chunk,
        timings: {
          totalMs: performance.now() - totalStart,
          octoboxMs: 0,
          navigationMs: caveMs,
          obstaclesMs: 0,
          staticMeshMs: 0,
          lootMs: 0,
          minesMs: 0,
          serializeMs: 0,
        },
      };
    }

    const rng = new SeededRandom(seed);
    const octoboxStart = performance.now();
    const cells = generateOctoBoxLeaves(bounds, seed);
    const octoboxMs = performance.now() - octoboxStart;
    const navigationStart = performance.now();
    const adjacencyAll = buildAdjacency(cells);
    const freeIds = buildNavigableSet(cells, portals, adjacencyAll, rng, bounds);
    ensurePortalConnectivity(cells, portals, adjacencyAll, freeIds);
    const navigationMs = performance.now() - navigationStart;

    for (const cell of cells) {
      if (freeIds.has(cell.id)) {
        cell.kind = 'free';
      }
    }

    const obstaclesStart = performance.now();
    const obstacles = placeObstacles(cells, portals, rng);
    const obstaclesMs = performance.now() - obstaclesStart;
    const staticMeshStart = performance.now();
    const staticMeshData = buildGreedyStaticMesh(
      obstacles
        .filter((obstacle) => obstacle.type === 'box' && obstacle.motion === 'static')
        .map((obstacle) => ({
          min: [obstacle.bounds.min.x, obstacle.bounds.min.y, obstacle.bounds.min.z],
          max: [obstacle.bounds.max.x, obstacle.bounds.max.y, obstacle.bounds.max.z],
        })),
      [bounds.min.x, bounds.min.y, bounds.min.z],
    );
    const staticMeshMs = performance.now() - staticMeshStart;
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
      staticMeshData,
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
        staticMeshMs,
        lootMs,
        minesMs,
        serializeMs: 0,
      },
    };
  }
}
