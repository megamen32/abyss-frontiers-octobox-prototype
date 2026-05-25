import { Box3, Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { ChunkData, Obstacle } from '../types';
import { RenderApp } from '../render/App';
import { ChunkManager } from './chunkManager';
import { InputController } from './input';
import { applyDamage, createInitialPlayerState, updatePlayer } from './player';

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
  private lastFrameTime = 0;
  private fps = 60;

  constructor(root: HTMLElement) {
    this.render = new RenderApp(root);
    this.render.setDebugEnabled(this.debugEnabled);
    this.render.hud.setCallbacks({
      onRestart: () => this.restart(),
      onToggleDebug: () => this.toggleDebug(),
    });
  }

  start(): void {
    this.running = true;
    const initial = this.chunkManager.syncAround(this.player.position);
    this.currentChunk = initial.currentCoord;
    this.render.syncChunks(initial.added, initial.removed);
    requestAnimationFrame(this.loop);
  }

  private restart(): void {
    const oldKeys = [...this.chunkManager.activeChunks.keys()];
    this.chunkManager.dispose();
    this.player = createInitialPlayerState();
    this.chunkManager = new ChunkManager(this.seed);
    this.render.syncChunks([], oldKeys);
    const initial = this.chunkManager.syncAround(this.player.position);
    this.currentChunk = initial.currentCoord;
    this.render.syncChunks(initial.added, initial.removed);
  }

  private toggleDebug(): void {
    this.debugEnabled = !this.debugEnabled;
    this.render.setDebugEnabled(this.debugEnabled);
  }

  private loop = (timestamp: number): void => {
    if (!this.running) {
      return;
    }
    const dt = Math.min(0.05, (timestamp - this.lastFrameTime || 16.6) / 1000);
    this.lastFrameTime = timestamp;
    this.fps = 1 / dt;

    const input = this.input.sample();
    if (input.restartPressed) {
      this.restart();
    }
    if (input.debugTogglePressed) {
      this.toggleDebug();
    }

    updatePlayer(this.player, input, this.render.cameraState, dt);
    const sync = this.chunkManager.syncAround(this.player.position);
    this.currentChunk = sync.currentCoord;
    this.render.syncChunks(sync.added, sync.removed);

    this.updateWorld(dt);
    this.render.updateFrame({
      player: this.player,
      chunks: this.chunkManager.activeChunks.values(),
      fps: this.fps,
      seed: this.seed,
      chunkCoord: this.currentChunk,
      distance: this.player.position.distanceTo(this.spawnPosition),
      depth: this.spawnPosition.y - this.player.position.y,
    });

    requestAnimationFrame(this.loop);
  };

  private updateWorld(dt: number): void {
    for (const chunk of this.chunkManager.activeChunks.values()) {
      updateObstacleMotion(chunk, dt);
      this.collectLoot(chunk);
      this.handleCollisions(chunk);
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

  private handleCollisions(chunk: ChunkData): void {
    for (const obstacle of chunk.obstacles) {
      if (collides(this.player.position, this.player.radius, obstacle)) {
        applyDamage(this.player, obstacle.damage);
        if (!this.player.alive) {
          return;
        }
      }
    }
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

function collides(playerPosition: Vector3, playerRadius: number, obstacle: Obstacle): boolean {
  if (obstacle.type === 'sphere' && obstacle.radius) {
    return playerPosition.distanceTo(obstacle.position) <= playerRadius + obstacle.radius;
  }

  const size = obstacle.size ?? new Vector3(1, 1, 1);
  const box = new Box3(
    obstacle.position.clone().sub(size.clone().multiplyScalar(0.5)),
    obstacle.position.clone().add(size.clone().multiplyScalar(0.5)),
  );
  const closest = new Vector3(
    Math.max(box.min.x, Math.min(playerPosition.x, box.max.x)),
    Math.max(box.min.y, Math.min(playerPosition.y, box.max.y)),
    Math.max(box.min.z, Math.min(playerPosition.z, box.max.z)),
  );
  return closest.distanceTo(playerPosition) <= playerRadius;
}
