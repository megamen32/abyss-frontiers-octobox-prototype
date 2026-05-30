import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const perfDir = resolve(process.cwd(), 'artifacts/performance');
const chunkProfile = await readJson('chunk-profile.json');
const boidsProfile = await readJson('boids-profile.json');
const workerProfile = await readJson('chunk-worker-parallel-profile.json');

const worstChunk = chunkProfile.topSlowChunks[0];
const mobileBoids = findByLabel(boidsProfile.summaries, 'mobile_1k');
const desktopBoids = findByLabel(boidsProfile.summaries, 'desktop_6k');
const worker4 = workerProfile.profiles.find((profile) => profile.workerCount === 4);

assertBudget(worstChunk.adjacencyBuildMs < 8, `Expected worst adjacency <8ms, got ${fixed(worstChunk.adjacencyBuildMs)}ms`);
assertBudget(worstChunk.totalMs < 40, `Expected worst chunk <40ms, got ${fixed(worstChunk.totalMs)}ms`);
assertBudget(mobileBoids.p95TotalMs < 33, `Expected mobile boids p95 <33ms, got ${fixed(mobileBoids.p95TotalMs)}ms`);
assertBudget(desktopBoids.p95TotalMs < 33, `Expected desktop 6k LOD boids p95 <33ms, got ${fixed(desktopBoids.p95TotalMs)}ms`);
assertBudget(mobileBoids.p95NeighborResultAllocations === 0, 'Expected zero mobile neighbor result allocations');
assertBudget(desktopBoids.p95NeighborResultAllocations === 0, 'Expected zero desktop neighbor result allocations');
assertBudget(mobileBoids.avgClusterCount > 0, 'Expected mobile profile to exercise cluster LOD');
assertBudget(desktopBoids.avgClusterCount > 0, 'Expected desktop profile to exercise cluster LOD');
assertBudget(desktopBoids.avgPooledCount > 0, 'Expected desktop profile to exercise pooled LOD');
assertBudget(mobileBoids.avgEffectiveUpdateHz < 60, 'Expected mobile effective boids update Hz below full-rate');
assertBudget(desktopBoids.avgEffectiveUpdateHz < 60, 'Expected desktop effective boids update Hz below full-rate');
assertBudget(worker4.p95HydrateMs < 4, `Expected worker hydrate p95 <4ms, got ${fixed(worker4.p95HydrateMs)}ms`);

const markdown = `# Mobile/GPU Performance Readiness

Generated from standalone profiles on ${generatedDate()}.

## Chunk Generation

- Current worst sampled chunk: \`${formatCoord(worstChunk.coord)}\`, \`totalMs=${fixed(worstChunk.totalMs)}\`, \`adjacencyMs=${fixed(worstChunk.adjacencyBuildMs)}\`, \`octoboxMs=${fixed(worstChunk.octoboxMs)}\`, \`cells=${worstChunk.cells}\`.
- Adjacency is below the 8ms target across the sampled worst chunks.
- The next chunk-generation bottleneck is octobox/field sampling in the spawn-ring worst case, not adjacency.

## Worker Parallelism

- Modeled worker counts: \`1 / 2 / 4 / 6 / 8\`.
- Recommendation: desktop \`${workerProfile.recommendation.desktop}\`, mobile \`${workerProfile.recommendation.mobile}\`.
- Four workers keep the runtime conservative while leaving CPU headroom: modeled \`p95WorkerTotalMs=${fixed(worker4.p95WorkerTotalMs)}\`, \`p95QueueWaitMs=${fixed(worker4.p95QueueWaitMs)}\`, \`p95HydrateMs=${fixed(worker4.p95HydrateMs)}\`.
- Six and eight workers reduce backlog further but increase concurrent memory pressure; they are not the default.

## Boids And Mines

- Mobile CPU target: \`${mobileBoids.count}\` boids, including companion fish and mines, \`p95TotalMs=${fixed(mobileBoids.p95TotalMs)}\`, \`p95NeighborSearchMs=${fixed(mobileBoids.p95NeighborSearchMs)}\`.
- Mobile LOD mix: \`full=${fixed(mobileBoids.avgFullCount)}\`, \`cluster=${fixed(mobileBoids.avgClusterCount)}\`, \`pooled=${fixed(mobileBoids.avgPooledCount)}\`, \`effectiveHz=${fixed(mobileBoids.avgEffectiveUpdateHz)}\`.
- Desktop CPU \`${desktopBoids.count}\` boids is viable for the 30fps fallback with simulation LOD: \`p95TotalMs=${fixed(desktopBoids.p95TotalMs)}\`, \`p95NeighborSearchMs=${fixed(desktopBoids.p95NeighborSearchMs)}\`.
- Desktop LOD mix: \`full=${fixed(desktopBoids.avgFullCount)}\`, \`cluster=${fixed(desktopBoids.avgClusterCount)}\`, \`pooled=${fixed(desktopBoids.avgPooledCount)}\`, \`effectiveHz=${fixed(desktopBoids.avgEffectiveUpdateHz)}\`.
- Neighbor result allocation pressure is now zero in the CPU profile (\`p95NeighborResultAllocations=0\`).
- Mine update cost is low in the profile (\`p95MineUpdateMs=${fixed(desktopBoids.p95MineUpdateMs)}\` at ${desktopBoids.count} boids), so mine behavior is not the current simulation bottleneck.

## WebGPU Decision

- Runtime policy keeps mobile at \`${boidsProfile.runtimePolicy.mobileWebGPU.maxBoids}\` boids and desktop CPU fallback at \`${boidsProfile.runtimePolicy.desktopCPUFallback.maxBoids}\`.
- Desktop WebGPU policy allows the existing \`${boidsProfile.runtimePolicy.desktopWebGPU.initialBoids}\` initial / \`${boidsProfile.runtimePolicy.desktopWebGPU.maxBoids}\` max boid target.
- WebGPU initialization returns \`null\` when \`navigator.gpu\` is unavailable, so unsupported WebKit/mobile environments stay on the CPU fallback path.
- Keep the feature-gated WebGPU path for desktop-scale boids as the preferred path for headroom and power. CPU LOD now keeps the ${desktopBoids.count} profile under the 30fps fallback budget, so it can remain a viable fallback rather than the primary path.
- A real WebKit GPU benchmark is still required before claiming WebGPU performance on this machine. The current sandbox blocks local server startup, so the WebKit render/profile pass could not run here.

## Mobile Readiness

- Mobile 30fps fallback budget is met by the standalone CPU boids profile.
- Chunk generation remains worker-owned and does not require main-thread chunk building.
- Worker hydration cost is low in the model (\`p95HydrateMs=${fixed(worker4.p95HydrateMs)}\`).
- Adaptive worker selection caps mobile at one or two chunk workers.

## Known Backlog

- Re-run \`npm run test:render\` and render/deep-dive profiles in WebKit once local TCP listeners are available.
- Bundle size warning remains: the main Vite bundle is about 683 kB minified; code splitting/lazy debug code should be handled separately.
`;

await writeFile(resolve(perfDir, 'mobile-gpu-readiness.md'), markdown, 'utf8');

async function readJson(file) {
  return JSON.parse(await readFile(resolve(perfDir, file), 'utf8'));
}

function findByLabel(summaries, label) {
  const summary = summaries.find((entry) => entry.label === label);
  if (!summary) {
    throw new Error(`Missing boids profile summary ${label}`);
  }
  return summary;
}

function assertBudget(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function generatedDate() {
  const dates = [chunkProfile.generatedAt, boidsProfile.generatedAt, workerProfile.generatedAt]
    .map((value) => value.slice(0, 10));
  return dates.every((date) => date === dates[0]) ? dates[0] : dates.join(' / ');
}

function formatCoord(coord) {
  return `${coord.x},${coord.y},${coord.z}`;
}

function fixed(value) {
  return value.toFixed(2);
}
