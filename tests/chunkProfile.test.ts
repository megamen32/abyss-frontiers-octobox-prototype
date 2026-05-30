import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChunkGenerator } from '../src/game/content/chunkGenerator';
import type { ChunkCoord, ChunkData, ChunkBuildTimings } from '../src/game/types';

interface ChunkProfileSample {
  label: string;
  coord: ChunkCoord;
  timings: ChunkBuildTimings;
  cells: number;
  obstacles: number;
  loot: number;
  mines: number;
  staticMeshIndices: number;
  staticMeshPositions: number;
  isCaveChunk: boolean;
}

interface ChunkProfileSummary {
  label: string;
  samples: number;
  caveChunks: number;
  averages: Record<string, number>;
  maximums: Record<string, number>;
}

describe('Chunk profiling', () => {
  it('writes generation timing report for worker bottleneck analysis', async () => {
    const generator = new ChunkGenerator(133742);
    const scenarios: Array<{
      label: string;
      coords: ChunkCoord[];
      options?: Parameters<ChunkGenerator['generateProfiled']>[1];
    }> = [
      {
        label: 'spawn_ring',
        coords: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 0, z: 1 },
          { x: 1, y: 0, z: 1 },
          { x: 0, y: 1, z: 0 },
        ],
      },
      {
        label: 'deep_ring',
        coords: [
          { x: 0, y: -10, z: 0 },
          { x: 1, y: -10, z: 0 },
          { x: 0, y: -10, z: 1 },
          { x: 1, y: -10, z: 1 },
          { x: 0, y: -11, z: 0 },
        ],
      },
      {
        label: 'wrap_boundary',
        coords: [
          { x: 511, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
          { x: 511, y: 511, z: 0 },
          { x: 0, y: 511, z: 511 },
        ],
      },
      {
        label: 'forced_cave_cluster',
        coords: [
          { x: 3, y: 500, z: 3 },
          { x: 4, y: 500, z: 3 },
          { x: 3, y: 499, z: 3 },
        ],
        options: {
          forceCaveEntranceFace: 'nx',
          forceCaveClusterCenter: { x: 3, y: 500, z: 3 },
          forceCaveMouthRadiusChunks: 1,
        },
      },
    ];

    const samples: ChunkProfileSample[] = [];
    for (const scenario of scenarios) {
      for (const coord of scenario.coords) {
        const { chunk, timings } = generator.generateProfiled(coord, scenario.options);
        samples.push(makeSample(scenario.label, coord, chunk, timings));
      }
    }

    const summary = summarize(samples);
    const outputDirectory = resolve(process.cwd(), 'artifacts/performance');
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      resolve(outputDirectory, 'chunk-profile.json'),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), samples, summary }, null, 2)}\n`,
      'utf8',
    );

    for (const entry of summary) {
      console.log(
        `${entry.label}: totalMs avg=${entry.averages.totalMs.toFixed(2)} max=${entry.maximums.totalMs.toFixed(2)}`
        + ` octobox avg=${entry.averages.octoboxMs.toFixed(2)}`
        + ` field avg=${entry.averages.octoboxFieldSampleMs.toFixed(2)}`
        + ` skelCandidates avg=${entry.averages.octoboxSkeletonCandidatesTested.toFixed(0)}`
        + ` split avg=${entry.averages.octoboxSplitPointsMs.toFixed(2)}`
        + ` adjacency avg=${entry.averages.adjacencyBuildMs.toFixed(2)}`
        + ` pairs avg=${entry.averages.adjacencyPairsTested.toFixed(0)}`
        + ` navSet avg=${entry.averages.navigableSetMs.toFixed(2)}`
        + ` portals avg=${entry.averages.portalConnectivityMs.toFixed(2)}`
        + ` staticMesh avg=${entry.averages.staticMeshMs.toFixed(2)}`
        + ` serialize avg=${entry.averages.serializeMs.toFixed(2)}`
        + ` cells avg=${entry.averages.cells.toFixed(1)}`
        + ` leaves avg=${entry.averages.octoboxLeavesGenerated.toFixed(1)}`
        + ` nodes avg=${entry.averages.octoboxNodesVisited.toFixed(1)}`
        + ` adjEdges avg=${entry.averages.adjacencyEdges.toFixed(1)}`
        + ` indices max=${entry.maximums.staticMeshIndices.toFixed(0)}`
        + ` cave=${entry.caveChunks}/${entry.samples}`,
      );
    }

    expect(samples.length).toBeGreaterThan(0);
  }, 30_000);
});

function makeSample(label: string, coord: ChunkCoord, chunk: ChunkData, timings: ChunkBuildTimings): ChunkProfileSample {
  return {
    label,
    coord,
    timings,
    cells: chunk.cells.length,
    obstacles: chunk.obstacles.length,
    loot: chunk.loot.length,
    mines: chunk.mines.length,
    staticMeshIndices: chunk.staticMeshData?.indices.length ?? 0,
    staticMeshPositions: chunk.staticMeshData?.positions.length ?? 0,
    isCaveChunk: chunk.isCaveChunk === true,
  };
}

function summarize(samples: ChunkProfileSample[]): ChunkProfileSummary[] {
  const byLabel = new Map<string, ChunkProfileSample[]>();
  for (const sample of samples) {
    const group = byLabel.get(sample.label) ?? [];
    group.push(sample);
    byLabel.set(sample.label, group);
  }

  const numericKeys = [
    'totalMs',
    'octoboxMs',
    'octoboxFieldSampleMs',
    'octoboxSkeletonCandidatesTested',
    'octoboxSplitPointsMs',
    'octoboxNodesVisited',
    'octoboxLeavesGenerated',
    'octoboxMaxDepthReached',
    'navigationMs',
    'adjacencyBuildMs',
    'adjacencyPairsTested',
    'navigableSetMs',
    'portalConnectivityMs',
    'adjacencyEdges',
    'obstaclesMs',
    'staticMeshMs',
    'lootMs',
    'minesMs',
    'serializeMs',
    'cells',
    'obstacles',
    'loot',
    'mines',
    'staticMeshIndices',
    'staticMeshPositions',
  ] as const;

  const output: ChunkProfileSummary[] = [];
  for (const [label, group] of byLabel) {
    const averages: Record<string, number> = {};
    const maximums: Record<string, number> = {};
    for (const key of numericKeys) {
      const values = group.map((sample) => readMetric(sample, key));
      averages[key] = values.reduce((sum, value) => sum + value, 0) / values.length;
      maximums[key] = Math.max(...values);
    }
    output.push({
      label,
      samples: group.length,
      caveChunks: group.filter((sample) => sample.isCaveChunk).length,
      averages,
      maximums,
    });
  }
  output.sort((left, right) => right.averages.totalMs - left.averages.totalMs);
  return output;
}

function readMetric(
  sample: ChunkProfileSample,
  key: 'totalMs'
    | 'octoboxMs'
    | 'octoboxFieldSampleMs'
    | 'octoboxSkeletonCandidatesTested'
    | 'octoboxSplitPointsMs'
    | 'octoboxNodesVisited'
    | 'octoboxLeavesGenerated'
    | 'octoboxMaxDepthReached'
    | 'navigationMs'
    | 'adjacencyBuildMs'
    | 'adjacencyPairsTested'
    | 'navigableSetMs'
    | 'portalConnectivityMs'
    | 'adjacencyEdges'
    | 'obstaclesMs'
    | 'staticMeshMs'
    | 'lootMs'
    | 'minesMs'
    | 'serializeMs'
    | 'cells'
    | 'obstacles'
    | 'loot'
    | 'mines'
    | 'staticMeshIndices'
    | 'staticMeshPositions',
): number {
  if (key === 'cells' || key === 'obstacles' || key === 'loot' || key === 'mines' || key === 'staticMeshIndices' || key === 'staticMeshPositions') {
    return sample[key];
  }
  return sample.timings[key as keyof ChunkBuildTimings] ?? 0;
}
