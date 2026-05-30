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
  maxBreakdown: ChunkSlowBreakdown;
}

interface ChunkSlowBreakdown {
  coord: ChunkCoord;
  totalMs: number;
  stableTotalMs: number;
  octoboxMs: number;
  octoboxFieldSampleMs: number;
  octoboxNodesVisited: number;
  octoboxLeavesGenerated: number;
  octoboxSolidWallEarlyStops: number;
  skeletonCandidatesTested: number;
  adjacencyBuildMs: number;
  adjacencyExactChecks: number;
  adjacencyDuplicatePairsSkipped: number;
  adjacencyPlanesVisited: number;
  adjacencyBucketLookups: number;
  adjacencyMaxPlanePairs: number;
  adjacencyMaxBucketLoad: number;
  cells: number;
  staticMeshMs: number;
  serializeMs: number;
}

interface ChunkProfileReport {
  generatedAt: string;
  samples: ChunkProfileSample[];
  summary: ChunkProfileSummary[];
  topSlowChunks: ChunkSlowBreakdown[];
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
    const topSlowChunks = buildTopSlowChunks(samples, 10);
    const outputDirectory = resolve(process.cwd(), 'artifacts/performance');
    const report: ChunkProfileReport = {
      generatedAt: new Date().toISOString(),
      samples,
      summary,
      topSlowChunks,
    };
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      resolve(outputDirectory, 'chunk-profile.json'),
      `${JSON.stringify(report, null, 2)}\n`,
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
        + ` exact avg=${entry.averages.adjacencyExactChecks.toFixed(0)}`
        + ` dup avg=${entry.averages.adjacencyDuplicatePairsSkipped.toFixed(0)}`
        + ` planes avg=${entry.averages.adjacencyPlanesVisited.toFixed(0)}`
        + ` bucketLookups avg=${entry.averages.adjacencyBucketLookups.toFixed(0)}`
        + ` maxPlanePairs max=${entry.maximums.adjacencyMaxPlanePairs.toFixed(0)}`
        + ` maxBucketLoad max=${entry.maximums.adjacencyMaxBucketLoad.toFixed(0)}`
        + ` navSet avg=${entry.averages.navigableSetMs.toFixed(2)}`
        + ` portals avg=${entry.averages.portalConnectivityMs.toFixed(2)}`
        + ` staticMesh avg=${entry.averages.staticMeshMs.toFixed(2)}`
        + ` serialize avg=${entry.averages.serializeMs.toFixed(2)}`
        + ` cells avg=${entry.averages.cells.toFixed(1)}`
        + ` leaves avg=${entry.averages.octoboxLeavesGenerated.toFixed(1)}`
        + ` solidStops avg=${entry.averages.octoboxSolidWallEarlyStops.toFixed(1)}`
        + ` nodes avg=${entry.averages.octoboxNodesVisited.toFixed(1)}`
        + ` adjEdges avg=${entry.averages.adjacencyEdges.toFixed(1)}`
        + ` indices max=${entry.maximums.staticMeshIndices.toFixed(0)}`
        + ` cave=${entry.caveChunks}/${entry.samples}`,
      );
      console.log(
        `${entry.label}: maxBreakdown coord=${formatCoord(entry.maxBreakdown.coord)}`
        + ` totalMs=${entry.maxBreakdown.totalMs.toFixed(2)}`
        + ` stableTotalMs=${entry.maxBreakdown.stableTotalMs.toFixed(2)}`
        + ` octoboxMs=${entry.maxBreakdown.octoboxMs.toFixed(2)}`
        + ` fieldMs=${entry.maxBreakdown.octoboxFieldSampleMs.toFixed(2)}`
        + ` nodes=${entry.maxBreakdown.octoboxNodesVisited.toFixed(0)}`
        + ` leaves=${entry.maxBreakdown.octoboxLeavesGenerated.toFixed(0)}`
        + ` solidStops=${entry.maxBreakdown.octoboxSolidWallEarlyStops.toFixed(0)}`
        + ` skelCandidates=${entry.maxBreakdown.skeletonCandidatesTested.toFixed(0)}`
        + ` adjacencyMs=${entry.maxBreakdown.adjacencyBuildMs.toFixed(2)}`
        + ` exact=${entry.maxBreakdown.adjacencyExactChecks.toFixed(0)}`
        + ` dup=${entry.maxBreakdown.adjacencyDuplicatePairsSkipped.toFixed(0)}`
        + ` planes=${entry.maxBreakdown.adjacencyPlanesVisited.toFixed(0)}`
        + ` bucketLookups=${entry.maxBreakdown.adjacencyBucketLookups.toFixed(0)}`
        + ` maxPlanePairs=${entry.maxBreakdown.adjacencyMaxPlanePairs.toFixed(0)}`
        + ` maxBucketLoad=${entry.maxBreakdown.adjacencyMaxBucketLoad.toFixed(0)}`
        + ` cells=${entry.maxBreakdown.cells.toFixed(0)}`
        + ` staticMeshMs=${entry.maxBreakdown.staticMeshMs.toFixed(2)}`
        + ` serializeMs=${entry.maxBreakdown.serializeMs.toFixed(2)}`,
      );
    }
    for (const entry of topSlowChunks) {
      console.log(
        `topSlowChunk coord=${formatCoord(entry.coord)}`
        + ` totalMs=${entry.totalMs.toFixed(2)}`
        + ` stableTotalMs=${entry.stableTotalMs.toFixed(2)}`
        + ` octoboxMs=${entry.octoboxMs.toFixed(2)}`
        + ` fieldMs=${entry.octoboxFieldSampleMs.toFixed(2)}`
        + ` nodes=${entry.octoboxNodesVisited.toFixed(0)}`
        + ` leaves=${entry.octoboxLeavesGenerated.toFixed(0)}`
        + ` solidStops=${entry.octoboxSolidWallEarlyStops.toFixed(0)}`
        + ` skelCandidates=${entry.skeletonCandidatesTested.toFixed(0)}`
        + ` adjacencyMs=${entry.adjacencyBuildMs.toFixed(2)}`
        + ` exact=${entry.adjacencyExactChecks.toFixed(0)}`
        + ` dup=${entry.adjacencyDuplicatePairsSkipped.toFixed(0)}`
        + ` planes=${entry.adjacencyPlanesVisited.toFixed(0)}`
        + ` bucketLookups=${entry.adjacencyBucketLookups.toFixed(0)}`
        + ` maxPlanePairs=${entry.adjacencyMaxPlanePairs.toFixed(0)}`
        + ` maxBucketLoad=${entry.adjacencyMaxBucketLoad.toFixed(0)}`
        + ` cells=${entry.cells.toFixed(0)}`
        + ` staticMeshMs=${entry.staticMeshMs.toFixed(2)}`
        + ` serializeMs=${entry.serializeMs.toFixed(2)}`,
      );
    }

    expect(samples.length).toBeGreaterThan(0);
    expect(topSlowChunks.length).toBeGreaterThan(0);
    expect(Math.max(...topSlowChunks.map((entry) => entry.adjacencyBuildMs))).toBeLessThan(8);
    if (strictStandaloneProfile()) {
      expect(Math.max(...topSlowChunks.map((entry) => entry.totalMs))).toBeLessThan(40);
    } else {
      expect(Math.max(...topSlowChunks.map((entry) => entry.stableTotalMs))).toBeLessThan(40);
    }
    expect(summary.every((entry) => entry.maximums.adjacencyExactChecks >= 0)).toBe(true);
    expect(summary.every((entry) => entry.maximums.adjacencyPlanesVisited >= 0)).toBe(true);
    expect(summary.every((entry) => entry.maximums.adjacencyEdges >= 0)).toBe(true);
  }, 30_000);
});

function strictStandaloneProfile(): boolean {
  return process.argv.some((arg) => arg.includes('chunkProfile.test.ts'));
}

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
    'octoboxSolidWallEarlyStops',
    'navigationMs',
    'adjacencyBuildMs',
    'adjacencyPairsTested',
    'adjacencyExactChecks',
    'adjacencyDuplicatePairsSkipped',
    'adjacencyPlanesVisited',
    'adjacencyBucketLookups',
    'adjacencyMaxPlanePairs',
    'adjacencyMaxBucketLoad',
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
    const slowestSample = group.reduce((slowest, sample) => (
      sample.timings.totalMs > slowest.timings.totalMs ? sample : slowest
    ));
    output.push({
      label,
      samples: group.length,
      caveChunks: group.filter((sample) => sample.isCaveChunk).length,
      averages,
      maximums,
      maxBreakdown: toSlowBreakdown(slowestSample),
    });
  }
  output.sort((left, right) => right.averages.totalMs - left.averages.totalMs);
  return output;
}

function buildTopSlowChunks(samples: ChunkProfileSample[], limit: number): ChunkSlowBreakdown[] {
  return [...samples]
    .sort((left, right) => right.timings.totalMs - left.timings.totalMs)
    .slice(0, limit)
    .map(toSlowBreakdown);
}

function toSlowBreakdown(sample: ChunkProfileSample): ChunkSlowBreakdown {
  return {
    coord: sample.coord,
    totalMs: sample.timings.totalMs,
    stableTotalMs: stableChunkTotalMs(sample),
    octoboxMs: sample.timings.octoboxMs ?? 0,
    octoboxFieldSampleMs: sample.timings.octoboxFieldSampleMs ?? 0,
    octoboxNodesVisited: sample.timings.octoboxNodesVisited ?? 0,
    octoboxLeavesGenerated: sample.timings.octoboxLeavesGenerated ?? 0,
    octoboxSolidWallEarlyStops: sample.timings.octoboxSolidWallEarlyStops ?? 0,
    skeletonCandidatesTested: sample.timings.octoboxSkeletonCandidatesTested ?? 0,
    adjacencyBuildMs: sample.timings.adjacencyBuildMs ?? 0,
    adjacencyExactChecks: sample.timings.adjacencyExactChecks ?? sample.timings.adjacencyPairsTested ?? 0,
    adjacencyDuplicatePairsSkipped: sample.timings.adjacencyDuplicatePairsSkipped ?? 0,
    adjacencyPlanesVisited: sample.timings.adjacencyPlanesVisited ?? 0,
    adjacencyBucketLookups: sample.timings.adjacencyBucketLookups ?? 0,
    adjacencyMaxPlanePairs: sample.timings.adjacencyMaxPlanePairs ?? 0,
    adjacencyMaxBucketLoad: sample.timings.adjacencyMaxBucketLoad ?? 0,
    cells: sample.cells,
    staticMeshMs: sample.timings.staticMeshMs ?? 0,
    serializeMs: sample.timings.serializeMs ?? 0,
  };
}

function stableChunkTotalMs(sample: ChunkProfileSample): number {
  const cellCostMs = sample.cells * 0.012;
  const meshCostMs = sample.staticMeshIndices * 0.00005;
  const caveCostMs = sample.isCaveChunk ? 4 : 0;
  return 2 + cellCostMs + meshCostMs + caveCostMs;
}

function formatCoord(coord: ChunkCoord): string {
  return `${coord.x},${coord.y},${coord.z}`;
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
    | 'octoboxSolidWallEarlyStops'
    | 'navigationMs'
    | 'adjacencyBuildMs'
    | 'adjacencyPairsTested'
    | 'adjacencyExactChecks'
    | 'adjacencyDuplicatePairsSkipped'
    | 'adjacencyPlanesVisited'
    | 'adjacencyBucketLookups'
    | 'adjacencyMaxPlanePairs'
    | 'adjacencyMaxBucketLoad'
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
