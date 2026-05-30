import type { ChunkBuildTimings, ChunkCoord, ChunkData } from '../types';
import { chunkBounds, chunkKey } from '../utils/chunk';
import { chunkSeed, faceSeed } from '../utils/hash';
import type { Face } from '../types';
import { SeededRandom } from '../utils/rng';
import { GAME_CONFIG } from '../config';
import { generateOctoBoxLeaves } from './octobox';
import { generatePortals } from './portals';
import { buildAdjacency, buildNavigableSet, ensurePortalConnectivity } from './navigation';
import { placeObstacles } from './obstacles';
import { placeLoot } from './loot';
import { placeMines } from './mines';
import { buildGreedyStaticMesh } from './greedyMesher';
import { detectCaveChunk, generateCaveChunkData } from './caveSystem';
import { wrapChunkCoord } from '../utils/worldTopology';

export class ChunkGenerator {
  constructor(private readonly globalSeed: number) {}

  generate(coord: ChunkCoord): ChunkData {
    return this.generateProfiled(coord).chunk;
  }

  generateProfiled(
    coord: ChunkCoord,
    options: {
      forceCaveEntranceFace?: Face;
      forceCaveClusterCenter?: ChunkCoord;
      forceCaveMouthRadiusChunks?: number;
    } = {},
  ): { chunk: ChunkData; timings: ChunkBuildTimings } {
    const totalStart = performance.now();
    const wrappedCoord = wrapChunkCoord(coord);
    const bounds = chunkBounds(wrappedCoord);
    const seed = chunkSeed(this.globalSeed, wrappedCoord);
    const portals = generatePortals(this.globalSeed, wrappedCoord, bounds);

    const caveEntrance = options.forceCaveEntranceFace
      ? {
          face: options.forceCaveEntranceFace,
          seed: faceSeed(
            this.globalSeed,
            options.forceCaveClusterCenter ?? coord,
            options.forceCaveEntranceFace,
          ),
        }
      : detectCaveChunk(this.globalSeed, wrappedCoord);
    if (caveEntrance) {
      const caveStart = performance.now();
      const entranceRadius = options.forceCaveEntranceFace ? GAME_CONFIG.blackHole.entranceRadius : undefined;
      const caveResult = generateCaveChunkData(wrappedCoord, bounds, portals, caveEntrance, entranceRadius, options.forceCaveClusterCenter, options.forceCaveMouthRadiusChunks);
      const caveMs = performance.now() - caveStart;
      const chunk: ChunkData = {
        key: chunkKey(wrappedCoord),
        coord: wrappedCoord,
        seed,
        isCaveChunk: true,
        caveEntranceCenter: caveResult.entranceCenter ? { x: caveResult.entranceCenter.x, y: caveResult.entranceCenter.y, z: caveResult.entranceCenter.z } : undefined,
        caveEntranceFace: caveResult.entranceCenter ? caveEntrance.face : undefined,
        caveEntranceRadius: caveResult.entranceCenter ? (entranceRadius ?? GAME_CONFIG.world.portalRadius) : undefined,
        bounds,
        cells: caveResult.cells,
        portals,
        adjacency: caveResult.adjacency,
        obstacles: caveResult.obstacles,
        staticMeshData: caveResult.staticMeshData,
        staticMeshRepresentsObstacles: false,
        caveCollisionSamples: caveResult.caveCollisionSamples,
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
    const octoboxProfile = {
      fieldSampleMs: 0,
      splitPointsMs: 0,
      nodesVisited: 0,
      leavesGenerated: 0,
      maxDepthReached: 0,
    };
    const octoboxStart = performance.now();
    const cells = generateOctoBoxLeaves(bounds, seed, octoboxProfile);
    const octoboxMs = performance.now() - octoboxStart;
    const adjacencyProfile = { pairsTested: 0 };
    const adjacencyStart = performance.now();
    const adjacencyAll = buildAdjacency(cells, adjacencyProfile);
    const adjacencyBuildMs = performance.now() - adjacencyStart;
    const navigableSetStart = performance.now();
    const freeIds = buildNavigableSet(cells, portals, adjacencyAll, rng, bounds);
    const navigableSetMs = performance.now() - navigableSetStart;
    const portalConnectivityStart = performance.now();
    ensurePortalConnectivity(cells, portals, adjacencyAll, freeIds);
    const portalConnectivityMs = performance.now() - portalConnectivityStart;
    const navigationMs = adjacencyBuildMs + navigableSetMs + portalConnectivityMs;

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
    const mines = placeMines(cells, portals, rng, chunkKey(wrappedCoord));
    const minesMs = performance.now() - minesStart;
    const adjacency = adjacencyAll.filter(([a, b]) => freeIds.has(a) && freeIds.has(b));

    const obstacleCells = new Set(obstacles.map((obstacle) => obstacle.cellId));
    for (const cell of cells) {
      if (obstacleCells.has(cell.id)) {
        cell.kind = 'obstacle';
      }
    }

    const chunk: ChunkData = {
      key: chunkKey(wrappedCoord),
      coord: wrappedCoord,
      seed,
      isCaveChunk: false,
      bounds,
      cells,
      portals,
      adjacency,
      obstacles,
      staticMeshData,
      staticMeshRepresentsObstacles: true,
      caveCollisionSamples: undefined,
      loot,
      mines,
    };

    return {
      chunk,
        timings: {
          totalMs: performance.now() - totalStart,
          octoboxMs,
          octoboxFieldSampleMs: octoboxProfile.fieldSampleMs,
          octoboxSplitPointsMs: octoboxProfile.splitPointsMs,
          octoboxNodesVisited: octoboxProfile.nodesVisited,
          octoboxLeavesGenerated: octoboxProfile.leavesGenerated,
          octoboxMaxDepthReached: octoboxProfile.maxDepthReached,
          navigationMs,
          adjacencyBuildMs,
          adjacencyPairsTested: adjacencyProfile.pairsTested,
          navigableSetMs,
          portalConnectivityMs,
          adjacencyEdges: adjacencyAll.length,
          obstaclesMs,
          staticMeshMs,
          lootMs,
        minesMs,
        serializeMs: 0,
      },
    };
  }
}
