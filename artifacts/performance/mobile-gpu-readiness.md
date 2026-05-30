# Mobile/GPU Performance Readiness

Generated from standalone profiles on 2026-05-30.

## Chunk Generation

- Current worst sampled chunk: `1,0,0`, `totalMs=17.62`, `adjacencyMs=0.73`, `octoboxMs=11.25`, `cells=1215`.
- Adjacency is below the 8ms target across the sampled worst chunks.
- The next chunk-generation bottleneck is octobox/field sampling in the spawn-ring worst case, not adjacency.

## Worker Parallelism

- Modeled worker counts: `1 / 2 / 4 / 6 / 8`.
- Recommendation: desktop `4`, mobile `2`.
- Four workers keep the runtime conservative while leaving CPU headroom: modeled `p95WorkerTotalMs=6.76`, `p95QueueWaitMs=37.78`, `p95HydrateMs=0.71`.
- Six and eight workers reduce backlog further but increase concurrent memory pressure; they are not the default.

## Boids And Mines

- Mobile CPU target: `1000` boids, including companion fish and mines, `p95TotalMs=2.40`, `p95NeighborSearchMs=0.31`.
- Mobile LOD mix: `full=155.22`, `cluster=844.77`, `pooled=0.00`, `effectiveHz=25.98`.
- Desktop CPU `6000` boids is viable for the 30fps fallback with simulation LOD: `p95TotalMs=10.72`, `p95NeighborSearchMs=2.41`.
- Desktop LOD mix: `full=627.88`, `cluster=5145.13`, `pooled=227.00`, `effectiveHz=23.43`.
- Neighbor result allocation pressure is now zero in the CPU profile (`p95NeighborResultAllocations=0`).
- Mine update cost is low in the profile (`p95MineUpdateMs=0.03` at 6000 boids), so mine behavior is not the current simulation bottleneck.

## WebGPU Decision

- Runtime policy keeps mobile at `1000` boids and desktop CPU fallback at `2000`.
- Desktop WebGPU policy allows the existing `6000` initial / `7000` max boid target.
- WebGPU initialization returns `null` when `navigator.gpu` is unavailable, so unsupported WebKit/mobile environments stay on the CPU fallback path.
- Keep the feature-gated WebGPU path for desktop-scale boids as the preferred path for headroom and power. CPU LOD now keeps the 6000 profile under the 30fps fallback budget, so it can remain a viable fallback rather than the primary path.
- A real WebKit GPU benchmark is still required before claiming WebGPU performance on this machine. The current sandbox blocks local server startup, so the WebKit render/profile pass could not run here.

## Mobile Readiness

- Mobile 30fps fallback budget is met by the standalone CPU boids profile.
- Chunk generation remains worker-owned and does not require main-thread chunk building.
- Worker hydration cost is low in the model (`p95HydrateMs=0.71`).
- Adaptive worker selection caps mobile at one or two chunk workers.

## Known Backlog

- Re-run `npm run test:render` and render/deep-dive profiles in WebKit once local TCP listeners are available.
- Bundle size warning remains: the main Vite bundle is about 683 kB minified; code splitting/lazy debug code should be handled separately.
