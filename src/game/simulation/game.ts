import { Box3, Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { AABB, ChunkCoord, ChunkData, Face, Obstacle } from '../types';
import { detectCaveChunk } from '../content/caveSystem';
import { RenderApp } from '../render/App';
import { ChunkManager } from './chunkManager';
import { overlapsObstacle, resolvePlayerCaveCollision, resolvePlayerObstacleCollision, resolvePlayerSurfaceCollision, sweptSphereHitsObstacle } from './collisions';
import { InputController } from './input';
import { mineHitsPlayer, updateMinesInChunk } from './mines';
import { applyDamage, createInitialPlayerState, travelDirection, updatePlayer } from './player';
import { applyRuntimeTuning } from './runtimeTuning';
import { applyKeyboardSteering } from './steering';
import { ShipPredictor } from './shipPredictor';
import { bandForDangerLevel, worldDangerLevel } from '../utils/depth';
import { chunkKey, worldToChunkCoord } from '../utils/chunk';
import { SpawnBudgetController } from './spawnBudget';
import { FrameProfiler } from './frameProfiler';
import { BoidsSystem } from '../../boids/BoidsSystem';

export class Game {
  private readonly input = new InputController(window);
  private readonly render: RenderApp;
  private readonly spawnPosition = new Vector3(
    GAME_CONFIG.world.spawn.x,
    GAME_CONFIG.world.spawn.y,
    GAME_CONFIG.world.spawn.z,
  );
  private seed = GAME_CONFIG.seed;
  private chunkManager = new ChunkManager(this.seed);
  private player = createInitialPlayerState();
  private currentChunk = { x: 0, y: 0, z: 0 };
  private running = false;
  private debugEnabled: boolean = GAME_CONFIG.visuals.debugEnabled;
  private debugUiVisible: boolean = GAME_CONFIG.visuals.debugEnabled;
  private chunkDebugEnabled: boolean = GAME_CONFIG.visuals.debugEnabled;
  private fogEnabled = true;
  private lastFrameTime = 0;
  private fps = 60;
  private paused = false;
  private readonly spawnBudget = new SpawnBudgetController();
  private readonly profiler = new FrameProfiler();
  private readonly boids = new BoidsSystem();

  constructor(root: HTMLElement) {
    this.render = new RenderApp(root);
    this.render.setDebugEnabled(this.debugEnabled);
    this.render.setChunkDebugEnabled(this.chunkDebugEnabled);
    this.render.setFogEnabled(this.fogEnabled);
    this.render.hud.setCallbacks({
      onRestart: () => this.restart(),
    });
    this.render.addBoids(this.boids);
  }

  start(): void {
    this.running = true;
    const initial = this.chunkManager.syncAround(this.player.position, travelDirection(this.player), this.player.speed);
    this.currentChunk = initial.currentCoord;
    this.render.syncChunks(initial.added, initial.removed);
    requestAnimationFrame(this.loop);
  }

  private restart(): void {
    const oldKeys = [...this.chunkManager.activeChunks.keys()];
    this.chunkManager.dispose();
    this.player = createInitialPlayerState();
    this.spawnBudget.reset();
    this.chunkManager = new ChunkManager(this.seed);
    this.render.syncChunks([], oldKeys);
    this.boids.syncChunks([], oldKeys);
    const initial = this.chunkManager.syncAround(this.player.position, travelDirection(this.player), this.player.speed);
    this.currentChunk = initial.currentCoord;
    this.render.syncChunks(initial.added, initial.removed);
    this.boids.syncChunks(initial.added, initial.removed);
  }

  private toggleDebug(): void {
    this.debugEnabled = !this.debugEnabled;
    this.render.setDebugEnabled(this.debugEnabled);
    if (!this.debugEnabled) {
      this.debugUiVisible = false;
      this.render.setDebugUiVisible(false);
    }
  }

  private toggleDebugUi(): void {
    if (!this.debugEnabled) return;
    this.debugUiVisible = !this.debugUiVisible;
    this.render.setDebugUiVisible(this.debugUiVisible);
  }

  private toggleChunkDebug(): void {
    this.chunkDebugEnabled = !this.chunkDebugEnabled;
    this.render.setChunkDebugEnabled(this.chunkDebugEnabled);
  }

  private toggleFog(): void {
    this.fogEnabled = !this.fogEnabled;
    this.render.setFogEnabled(this.fogEnabled);
  }

  private togglePause(): void {
    this.paused = !this.paused;
  }

  private loop = (timestamp: number): void => {
    if (!this.running) {
      return;
    }
    const rawDt = Math.max(0.0001, (timestamp - this.lastFrameTime || 16.6) / 1000);
    const dt = Math.min(0.05, rawDt);
    const frameStart = performance.now();
    this.lastFrameTime = timestamp;
    this.fps = 1 / rawDt;

    const inputStart = performance.now();
    const input = this.input.sample();
    if (input.restartPressed) {
      this.restart();
    }
    if (input.debugTogglePressed) {
      this.toggleDebug();
    }
    if (input.chunkDebugTogglePressed) {
      this.toggleChunkDebug();
    }
    if (input.fogTogglePressed) {
      this.toggleFog();
    }
    if (input.debugUiTogglePressed) {
      this.toggleDebugUi();
    }
    if (input.pausePressed) {
      this.togglePause();
    }
    this.profiler.addSample('inputMs', performance.now() - inputStart);

    let tuning = applyRuntimeTuning(input);
    if (!this.paused) {
      const simulationStart = performance.now();
      applyKeyboardSteering(this.player, input, dt);
      updatePlayer(this.player, dt);
      this.profiler.addSample('simulationMs', performance.now() - simulationStart);

      const chunkSyncStart = performance.now();
      const predictor = ShipPredictor.forPlayer(this.player);
      const syncState = this.resolveChunkSyncState(predictor);
      const viewFrustum = this.render.getViewFrustumSnapshot();
      const sync = this.chunkManager.syncAround(
        this.player.position,
        syncState.forward,
        this.player.speed,
        {
          caveOnly: syncState.caveOnly,
          retentionAabb: syncState.retentionAabb,
          forcedCaves: syncState.forcedCaves,
          viewFrustum,
        },
      );
      this.currentChunk = sync.currentCoord;
      this.render.syncChunks(sync.added, sync.removed);
      this.boids.syncChunks(sync.added, sync.removed);
      this.profiler.addSample('chunkSyncMs', performance.now() - chunkSyncStart);

      const worldStart = performance.now();
      this.updateWorld(dt);
      this.profiler.addSample('worldMs', performance.now() - worldStart);
      this.spawnBudget.recordFrame(rawDt, this.fps);
    }
    const dangerLevel = worldDangerLevel(this.player.position.y);
    const depthBand = bandForDangerLevel(dangerLevel);
    const predictor = ShipPredictor.forPlayer(this.player);
    this.boids.update(dt, this.render.getCameraPosition(), this.player.position);
    const renderStart = performance.now();
    this.render.updateFrame({
      paused: this.paused,
      player: this.player,
      predictor,
      chunks: this.chunkManager.activeChunks.values(),
      fps: this.fps,
      seed: this.seed,
      chunkCoord: this.currentChunk,
      distance: this.player.position.distanceTo(this.spawnPosition),
      depth: this.spawnPosition.y - this.player.position.y,
      dangerLevel,
      depthBand: depthBand.label,
      dangerAccent: depthBand.accent,
      tuning,
      fogEnabled: this.fogEnabled,
      spawnBudget: this.spawnBudget.getBudget(),
      averageFps: this.spawnBudget.getAverageFps(),
      timings: {
        ...this.profiler.snapshot(),
        ...this.chunkManager.consumeDebugTimings(),
      },
    });
    this.profiler.addSample('renderMs', performance.now() - renderStart);
    this.profiler.addSample('frameMs', performance.now() - frameStart);
    this.profiler.addSnapshot(this.chunkManager.consumeDebugTimings());

    requestAnimationFrame(this.loop);
  };

  private updateWorld(dt: number): void {
    if (this.handleSurfaceCollision()) {
      return;
    }

    const interactiveChunks = this.getChunksWithinRadius(GAME_CONFIG.world.interactiveRadius);
    const simulationChunks = this.getChunksWithinRadius(GAME_CONFIG.world.simulationRadius);

    for (const chunk of interactiveChunks) {
      this.collectLoot(chunk);
      this.handleCollisions(chunk);
    }

    for (const chunk of simulationChunks) {
      updateObstacleMotion(chunk, dt);
      this.updateMines(chunk, dt);
    }
  }

  private collectLoot(chunk: ChunkData): void {
    for (const loot of chunk.loot) {
      if (loot.collected || !this.player.alive) {
        continue;
      }
      if (loot.position.distanceTo(this.player.position) <= this.player.radius + loot.radius) {
        loot.collected = true;
        this.player.loot += loot.value;
      }
    }
  }

  private handleSurfaceCollision(): boolean {
    if (!this.player.alive || this.player.position.y <= this.spawnPosition.y) {
      return false;
    }

    resolvePlayerSurfaceCollision(this.player, this.spawnPosition.y);
    applyDamage(this.player, GAME_CONFIG.collision.surfaceDamage);
    return !this.player.alive;
  }

  private handleCollisions(chunk: ChunkData): void {
    if (chunk.isCaveChunk && chunk.caveCollisionSamples && resolvePlayerCaveCollision(this.player, chunk.caveCollisionSamples)) {
      applyDamage(this.player, GAME_CONFIG.collision.surfaceDamage);
      if (!this.player.alive) {
        return;
      }
    }
    for (const obstacle of chunk.obstacles) {
      const collides =
        sweptSphereHitsObstacle(this.player.previousPosition, this.player.position, this.player.radius, obstacle)
        || overlapsObstacle(this.player.position, this.player.radius, obstacle);
      if (collides) {
        resolvePlayerObstacleCollision(this.player, obstacle);
        applyDamage(this.player, obstacle.damage);
        if (!this.player.alive) {
          return;
        }
        break;
      }
    }
    for (const mine of chunk.mines) {
      if (mineHitsPlayer(mine, this.player)) {
        mine.state = 'dead';
        applyDamage(this.player, mine.damage);
        if (!this.player.alive) {
          return;
        }
      }
    }
  }

  private updateMines(chunk: ChunkData, dt: number): void {
    updateMinesInChunk(chunk, this.player, dt);
  }

  private getChunksWithinRadius(radius: number): ChunkData[] {
    const chunks: ChunkData[] = [];
    for (const chunk of this.chunkManager.activeChunks.values()) {
      if (chunkDistance(this.currentChunk, chunk.coord) <= radius) {
        chunks.push(chunk);
      }
    }
    return chunks;
  }

  private resolveChunkSyncState(predictor: ShipPredictor): {
    forward: Vector3;
    caveOnly: boolean;
    retentionAabb?: AABB;
    forcedCaves: Array<{ coord: ChunkCoord; entranceFace: Face; clusterCenter: ChunkCoord; mouthRadiusChunks: number }>;
  } {
    const currentCoord = worldToChunkCoord(this.player.position);
    const currentChunk = this.chunkManager.activeChunks.get(chunkKey(currentCoord));
    const inCave = currentChunk?.isCaveChunk === true;
    const horizon = Math.max(1, GAME_CONFIG.world.generationLookaheadSeconds);
    const forcedCaves = this.buildForcedCaves(predictor, horizon);
    if (!inCave) {
      return {
        forward: travelDirection(this.player),
        caveOnly: false,
        retentionAabb: undefined,
        forcedCaves,
      };
    }

    const forcedKeys = new Set(forcedCaves.map((fc) => chunkKey(fc.coord)));
    const exitSoon = [1, Math.min(2, horizon), horizon]
      .some((time) => {
        const coord = worldToChunkCoord(predictor.predict(time));
        const key = chunkKey(coord);
        if (forcedKeys.has(key)) return false;
        const loaded = this.chunkManager.activeChunks.get(key);
        return loaded ? loaded.isCaveChunk !== true : detectCaveChunk(this.seed, coord) === null;
      });

    return {
      forward: predictor.predictDirection(Math.min(1.5, horizon)),
      caveOnly: !exitSoon,
      retentionAabb: !exitSoon ? this.buildRetentionAabb(predictor, horizon) : undefined,
      forcedCaves,
    };
  }

  private buildForcedCaves(
    predictor: ShipPredictor,
    horizon: number,
  ): Array<{ coord: ChunkCoord; entranceFace: Face; clusterCenter: ChunkCoord; mouthRadiusChunks: number }> {
    const depth = this.spawnPosition.y - this.player.position.y;
    if (depth < GAME_CONFIG.blackHole.minDepth || depth > GAME_CONFIG.blackHole.maxDepth) {
      return [];
    }
    const direction = predictor.predictDirection(Math.min(1.5, horizon));
    const entranceFace = oppositeFace(faceFromDirection(direction));
    const mouthRadiusChunks = Math.max(
      1,
      Math.ceil(GAME_CONFIG.blackHole.entranceRadius / GAME_CONFIG.world.chunkSize),
    );
    const coords = new Map<string, { coord: ChunkCoord; entranceFace: Face; clusterCenter: ChunkCoord; mouthRadiusChunks: number }>();
    for (const time of [Math.min(1.5, horizon), Math.min(3, horizon), horizon]) {
      const center = worldToChunkCoord(predictor.predict(time));
      for (const coord of expandCaveFront(center, entranceFace, mouthRadiusChunks)) {
        coords.set(chunkKey(coord), { coord, entranceFace, clusterCenter: center, mouthRadiusChunks });
      }
    }
    return [...coords.values()];
  }

  private buildRetentionAabb(predictor: ShipPredictor, horizon: number): AABB {
    const start = this.player.position;
    const end = predictor.predict(horizon);
    const padding = GAME_CONFIG.world.chunkSize * 1.5;
    return {
      min: new Vector3(
        Math.min(start.x, end.x) - padding,
        Math.min(start.y, end.y) - padding,
        Math.min(start.z, end.z) - padding,
      ),
      max: new Vector3(
        Math.max(start.x, end.x) + padding,
        Math.max(start.y, end.y) + padding,
        Math.max(start.z, end.z) + padding,
      ),
    };
  }
}

function updateObstacleMotion(chunk: ChunkData, dt: number): void {
  for (const obstacle of chunk.obstacles) {
    if (obstacle.motion === 'static') {
      continue;
    }
    if (obstacle.motion === 'linear_drift') {
      const drift = Math.sin(performance.now() * 0.001 + obstacle.phase) * obstacle.driftAmplitude;
      obstacle.position.copy(obstacle.basePosition).addScaledVector(obstacle.axis, drift);
      clampObstacleToBounds(obstacle);
    }
    obstacle.phase += dt * obstacle.angularSpeed;
  }
}

function faceFromDirection(direction: Vector3): Face {
  const ax = Math.abs(direction.x);
  const ay = Math.abs(direction.y);
  const az = Math.abs(direction.z);
  if (ax >= ay && ax >= az) {
    return direction.x >= 0 ? 'px' : 'nx';
  }
  if (ay >= az) {
    return direction.y >= 0 ? 'py' : 'ny';
  }
  return direction.z >= 0 ? 'pz' : 'nz';
}

function oppositeFace(face: Face): Face {
  switch (face) {
    case 'px': return 'nx';
    case 'nx': return 'px';
    case 'py': return 'ny';
    case 'ny': return 'py';
    case 'pz': return 'nz';
    case 'nz': return 'pz';
  }
}

function expandCaveFront(center: ChunkCoord, entranceFace: Face, radius: number): ChunkCoord[] {
  const coords: ChunkCoord[] = [];
  if (entranceFace === 'px' || entranceFace === 'nx') {
    for (let y = -radius; y <= radius; y += 1) {
      for (let z = -radius; z <= radius; z += 1) {
        coords.push({ x: center.x, y: center.y + y, z: center.z + z });
      }
    }
    return coords;
  }
  if (entranceFace === 'py' || entranceFace === 'ny') {
    for (let x = -radius; x <= radius; x += 1) {
      for (let z = -radius; z <= radius; z += 1) {
        coords.push({ x: center.x + x, y: center.y, z: center.z + z });
      }
    }
    return coords;
  }
  for (let x = -radius; x <= radius; x += 1) {
    for (let y = -radius; y <= radius; y += 1) {
      coords.push({ x: center.x + x, y: center.y + y, z: center.z });
    }
  }
  return coords;
}

function clampObstacleToBounds(obstacle: Obstacle): void {
  const box = new Box3(obstacle.bounds.min.clone(), obstacle.bounds.max.clone()).expandByScalar(-2);
  obstacle.position.x = Math.min(box.max.x, Math.max(box.min.x, obstacle.position.x));
  obstacle.position.y = Math.min(box.max.y, Math.max(box.min.y, obstacle.position.y));
  obstacle.position.z = Math.min(box.max.z, Math.max(box.min.z, obstacle.position.z));
}

function chunkDistance(a: ChunkCoord, b: ChunkCoord): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}
