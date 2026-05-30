# Abyss3 — Agent Notes

Browser-based 3D space game (Three.js + TypeScript + Vite). Player flies a ship through procedurally generated chunks that get harder with depth.

## Commands

```bash
npm run build          # tsc --noEmit + vite build (must pass before committing)
npm run dev            # vite dev server on 127.0.0.1:4173
npm test               # vitest run (unit tests in tests/)
npm run test:render    # playwright e2e (requires dev server at 127.0.0.1:4173)
npx tsc --noEmit       # typecheck only
make start             # install + start dev server (background, with pidfile)
make restart           # stop → build → start
```

**Always run `npx tsc --noEmit` after editing `.ts` files.** The build script runs tsc first and will fail on any type error. `noUnusedLocals` and `noUnusedParameters` are enabled — prefix unused params with `_`.

## Architecture

Single-page app. No routing, no SSR. `src/main.ts` → `Game` → game loop (simulate → sync chunks → render).

### Boids Priority

- Build **one** shared boids system, not separate fish/mine/school systems.
- All flocking-style agents should go through shared boids infrastructure: multi-type configs + pairwise interaction matrix.
- Prefer a unified architecture for `fish`, `companionFish`, `mines`, future `sharks`, etc.
- This machine has a real GPU available: **Apple M1 Max, Metal 4**.
- On this machine, prefer the GPU/WebGPU boids path as the primary implementation.
- Do **not** spend time building or prioritizing a CPU-first/fallback boids path unless explicitly requested.

### Key directories

| Path | Role |
|---|---|
| `src/game/content/` | Procedural chunk generation pipeline (runs in Web Workers) |
| `src/game/simulation/` | Game loop: player physics, collisions, mines, steering |
| `src/game/render/` | Three.js rendering: App, DebugRenderer, Hud |
| `src/game/utils/` | Pure helpers: hash, rng, chunk math, depth, visibility |
| `src/game/types.ts` | All shared types (ChunkData, Obstacle, Portal, etc.) |
| `src/game/config.ts` | Single `GAME_CONFIG` object — all tunables live here |

### Coordinate Convention

`+Y` = up, `+X` = right, `+Z` = forward/nose.

### Chunk generation pipeline (in `content/`)

Two generation modes selected at runtime:

**Normal chunks** (octobox pipeline):
`generatePortals` → `generateOctoBoxLeaves` → `buildAdjacency` → `buildNavigableSet` → `ensurePortalConnectivity` → `placeObstacles` → `buildGreedyStaticMesh` → `placeLoot` → `placeMines`

**Cave chunks** (tunnel pipeline, new):
`detectCaveChunk` → `generatePortals` → `generateCaveChunkData` (Catmull-Rom spline tunnels + gauntlet obstacles + tube mesh)

Both produce the same `ChunkData` structure consumed by the renderer and simulation.

### Chunk generation runs in Web Workers

`chunkManager.ts` dispatches generation to workers (via `chunkWorker.ts`). Chunks are serialized/deserialized through `chunkPayload.ts` (dehydrate/hydrate). The `ChunkGenerator` class is the single entry point.

### Determinism

Everything is seeded and deterministic. `SeededRandom` (xorshift variant) is used everywhere. `chunkSeed(globalSeed, coord)` → per-chunk seed. `faceSeed(globalSeed, coord, face)` → per-face seed (shared between adjacent chunks so portals align).

### Cave entrance convention

Cave chunks are detected by checking **negative faces** (nx/ny/nz) — if the face seed triggers, this chunk becomes a cave. The positive-face neighbor stays normal. Both chunks share the same face seed, so they agree without cross-chunk communication.

## Tests

- **Unit**: `vitest run` — `tests/*.test.ts`. Tests cover chunk determinism, portal alignment, collision, player physics, steering, mines, mesh correctness.
- **E2E**: `playwright test` — `e2e/*.e2e.ts`. Starts a dev server, captures render metrics via `window.__ABYSS_PERF__`. Requires the app to build and run without JS errors.

## Style conventions

- No comments unless asked
- Compact code, no unnecessary whitespace
- `for` loops (not `.forEach`) for hot paths
- `const` everywhere unless mutation is needed
- Vector3 from Three.js for all 3D math (mutate with `.set()` / `.copy()`, avoid unnecessary `.clone()`)
- Config is a single `as const` object — no environment variables, no runtime overrides beyond keyboard tuning

## Deploy

GitHub Pages via `deploy.yml` on push to `main`. Build uses `BASE_URL=/Abyss3/`.
