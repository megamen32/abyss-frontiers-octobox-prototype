# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev            # Vite dev server on 0.0.0.0:4173
npm run build          # tsc + vite build (must pass before committing)
npm test               # vitest run — unit tests in tests/
npm run test:render    # Playwright e2e (requires dev server at 127.0.0.1:4173)
npx tsc --noEmit       # type-check only

# Run a single unit test file
npx vitest run tests/cameraRig.test.ts
```

**Always run `npx tsc --noEmit` after editing `.ts` files.** `noUnusedLocals` and `noUnusedParameters` are enabled — prefix unused params with `_`.

## Architecture

Single-page app, no routing. `src/main.ts` → `Game` → game loop: **simulate → sync chunks → render**.

`src/game/config.ts` is the single source of truth for all tunables (`GAME_CONFIG as const`). No env vars, no runtime overrides beyond keyboard tuning in `runtimeTuning.ts`.

### Key directories

| Path | Role |
|---|---|
| `src/game/content/` | Procedural chunk generation (runs in Web Workers) |
| `src/game/simulation/` | Game loop: player physics, collisions, mines, steering |
| `src/game/render/` | Three.js rendering: `App`, `Hud`, `DebugRenderer`, `cameraRig` |
| `src/game/utils/` | Pure helpers: hash, rng, chunk math, depth, visibility |
| `src/game/types.ts` | All shared types (`ChunkData`, `Obstacle`, `Portal`, etc.) |

### Chunk generation pipeline

Two modes selected at runtime via `GAME_CONFIG.world.generationMode`:

- **Normal** (octobox): `generatePortals` → `generateOctoBoxLeaves` → `buildAdjacency` → `buildNavigableSet` → `ensurePortalConnectivity` → `placeObstacles` → `buildGreedyStaticMesh` → `placeLoot` → `placeMines`
- **Cave**: `detectCaveChunk` → `generateCaveChunkData` (Catmull-Rom spline tunnels + gauntlet obstacles + tube mesh)

Both produce the same `ChunkData` consumed by renderer and simulation. Generation runs in Web Workers (`chunkManager.ts` dispatches, `chunkWorker.ts` executes). Chunks are serialized via `chunkPayload.ts` (dehydrate/hydrate).

### Determinism

Everything is seeded. `SeededRandom` (xorshift) is used everywhere. `chunkSeed(globalSeed, coord)` gives per-chunk seeds; `faceSeed(globalSeed, coord, face)` is shared between neighboring chunks so portals align without cross-chunk communication. Cave detection uses **negative faces** (nx/ny/nz) so both neighbors agree.

### Camera rig (`render/cameraRig.ts`)

`computeCameraRig` is a pure, testable function that guarantees a set of world-space points stay within the camera frustum. The renderer calls it every frame with ship anchor points (transformed from ship-local space via `shipAnchorsToWorld`) plus any `externalFocusPoints` set via `RenderApp.setExternalFocusPoints()`. The camera only moves farther from its `lookAt` target — direction is never changed.

Config knobs: `camera.shipViewAnchors` (local-space points that must always be visible), `camera.viewMargin` (fraction of half-FOV kept as padding), `camera.lookAheadDistance` (how far ahead the camera looks).

## Tests

- **Unit** (`tests/`): chunk determinism, portal alignment, collision, physics, steering, mines, greedy mesh, camera rig.
- **E2E** (`e2e/`): Playwright — captures render metrics via `window.__ABYSS_PERF__`.

## Style

- `for` loops (not `.forEach`) for hot paths
- `Vector3` from Three.js for all 3D math; mutate with `.set()` / `.copy()`, minimise `.clone()`
- `const` everywhere unless mutation is required
- No comments unless the *why* is non-obvious

## Deploy

GitHub Pages via `deploy.yml` on push to `main`. Build uses `BASE_URL=/Abyss3/`.
