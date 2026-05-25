import { Box3, Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { ChunkCoord, ChunkData, Obstacle } from '../types';
import { RenderApp } from '../render/App';
import { ChunkManager } from './chunkManager';
import { overlapsObstacle, resolvePlayerObstacleCollision, resolvePlayerSurfaceCollision, sweptSphereHitsObstacle } from './collisions';
import { InputController } from './input';
import { mineHitsPlayer, updateMinesInChunk } from './mines';
import { applyDamage, createInitialPlayerState, travelDirection, updatePlayer } from './player';
import { applyRuntimeTuning } from './runtimeTuning';
import { applyKeyboardSteering } from './steering';
import { bandForDangerLevel, worldDangerLevel } from '../utils/depth';
import { SpawnBudgetController } from './spawnBudget';
import { FrameProfiler } from './frameProfiler';

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
  private chunkDebugEnabled: boolean = GAME_CONFIG.visuals.debugEnabled;
  private fogEnabled = true;
  private lastFrameTime = 0;
  private fps = 60;
  private readonly spawnBudget = new SpawnBudgetController();
  private readonly profiler = new FrameProfiler();

  constructor(root: HTMLElement) {
    this.render = new RenderApp(root);
    this.render.setDebugEnabled(this.debugEnabled);
    this.render.setChunkDebugEnabled(this.chunkDebugEnabled);
    this.render.setFogEnabled(this.fogEnabled);
    this.render.hud.setCallbacks({
      onRestart: () => this.restart(),
      onToggleDebug: () => this.toggleDebug(),
    });
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
    const initial = this.chunkManager.syncAround(this.player.position, travelDirection(this.player), this.player.speed);
    this.currentChunk = initial.currentCoord;
    this.render.syncChunks(initial.added, initial.removed);
  }

  private toggleDebug(): void {
    this.debugEnabled = !this.debugEnabled;
    this.render.setDebugEnabled(this.debugEnabled);
  }

  private toggleChunkDebug(): void {
    this.chunkDebugEnabled = !this.chunkDebugEnabled;
    this.render.setChunkDebugEnabled(this.chunkDebugEnabled);
  }

  private toggleFog(): void {
    this.fogEnabled = !this.fogEnabled;
    this.render.setFogEnabled(this.fogEnabled);
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
    this.profiler.addSample('inputMs', performance.now() - inputStart);

    const simulationStart = performance.now();
    const tuning = applyRuntimeTuning(input);
    applyKeyboardSteering(this.player, input, dt);
    updatePlayer(this.player, dt);
    this.profiler.addSample('simulationMs', performance.now() - simulationStart);

    const chunkSyncStart = performance.now();
    const travel = travelDirection(this.player);
    const sync = this.chunkManager.syncAround(this.player.position, travel, this.player.speed);
    this.currentChunk = sync.currentCoord;
    this.render.syncChunks(sync.added, sync.removed);
    this.profiler.addSample('chunkSyncMs', performance.now() - chunkSyncStart);

    const worldStart = performance.now();
    this.updateWorld(dt);
    this.profiler.addSample('worldMs', performance.now() - worldStart);
    this.spawnBudget.recordFrame(rawDt, this.fps);
    const dangerLevel = worldDangerLevel(this.player.position.y);
    const depthBand = bandForDangerLevel(dangerLevel);
    const renderStart = performance.now();
    this.render.updateFrame({
      player: this.player,
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

function clampObstacleToBounds(obstacle: Obstacle): void {
  const box = new Box3(obstacle.bounds.min.clone(), obstacle.bounds.max.clone()).expandByScalar(-2);
  obstacle.position.x = Math.min(box.max.x, Math.max(box.min.x, obstacle.position.x));
  obstacle.position.y = Math.min(box.max.y, Math.max(box.min.y, obstacle.position.y));
  obstacle.position.z = Math.min(box.max.z, Math.max(box.min.z, obstacle.position.z));
}

function chunkDistance(a: ChunkCoord, b: ChunkCoord): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}
