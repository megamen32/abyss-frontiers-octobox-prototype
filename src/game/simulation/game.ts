import { Box3, Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { AABB, ChunkCoord, ChunkData, Face, Obstacle } from '../types';
import { detectCaveChunk } from '../content/caveSystem';
import { RenderApp } from '../render/App';
import { ChunkManager } from './chunkManager';
import { overlapsObstacle, resolvePlayerCaveCollision, resolvePlayerObstacleCollision, sweptSphereHitsObstacle } from './collisions';
import { InputController } from './input';
import { mineHitsPlayer, updateMinesInChunk } from './mines';
import { applyDamage, createInitialPlayerState, travelDirection, updatePlayer } from './player';
import { AutopilotBot } from './autopilot';
import { applyRuntimeTuning } from './runtimeTuning';
import { applyKeyboardSteering } from './steering';
import { ShipPredictor } from './shipPredictor';
import { bandForDangerLevel, worldDangerLevel } from '../utils/depth';
import { chunkKey, worldToChunkCoord } from '../utils/chunk';
import { shortestWrappedDistance, wrappedChunkDistance, wrapChunkCoord } from '../utils/worldTopology';
import { SpawnBudgetController } from './spawnBudget';
import { FrameProfiler } from './frameProfiler';
import { BoidsSystem } from '../../boids/BoidsSystem';
import { BoidBehavior, type BoidsConfig } from '../../boids/BoidsTypes';
import { MINE_TYPE, UNIFIED_WORLD_BOIDS_CONFIG } from '../../boids/BoidsConfig';

const DEBUG_SETTINGS_KEYS = {
  debugEnabled: 'abyss3.debugEnabled',
  debugUiVisible: 'abyss3.debugUiVisible',
  chunkDebugEnabled: 'abyss3.chunkDebugEnabled',
  fogEnabled: 'abyss3.fogEnabled',
  autopilot: 'abyss3.autopilot',
  virtualJoystickEnabled: 'abyss3.virtualJoystickEnabled',
} as const;

function readStoredBool(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

function writeStoredBool(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    return;
  }
}

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
  private debugEnabled!: boolean;
  private debugUiVisible!: boolean;
  private chunkDebugEnabled!: boolean;
  private fogEnabled!: boolean;
  private lastFrameTime = 0;
  private fps = 60;
  private paused = false;
  private readonly spawnBudget = new SpawnBudgetController();
  private readonly profiler = new FrameProfiler();
  private readonly boids = new BoidsSystem(createRuntimeBoidsConfig());
  private readonly mineBoidIdsByChunk = new Map<string, Set<string>>();
  private readonly autopilot = new AutopilotBot();
  private virtualJoystickEnabled = false;

  constructor(root: HTMLElement) {
    this.debugEnabled = readStoredBool(DEBUG_SETTINGS_KEYS.debugEnabled, GAME_CONFIG.visuals.debugEnabled);
    this.debugUiVisible = readStoredBool(DEBUG_SETTINGS_KEYS.debugUiVisible, GAME_CONFIG.visuals.debugEnabled);
    this.chunkDebugEnabled = readStoredBool(DEBUG_SETTINGS_KEYS.chunkDebugEnabled, GAME_CONFIG.visuals.debugEnabled);
    this.fogEnabled = readStoredBool(DEBUG_SETTINGS_KEYS.fogEnabled, true);
    if (readStoredBool(DEBUG_SETTINGS_KEYS.autopilot, false)) {
      this.autopilot.setEnabled(true);
    }
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.virtualJoystickEnabled = readStoredBool(DEBUG_SETTINGS_KEYS.virtualJoystickEnabled, isTouchDevice && GAME_CONFIG.virtualJoystick.enabled);
    this.render = new RenderApp(root);
    this.render.setDebugEnabled(this.debugEnabled);
    this.render.setChunkDebugEnabled(this.chunkDebugEnabled);
    this.render.setDebugUiVisible(this.debugUiVisible);
    this.render.setFogEnabled(this.fogEnabled);
    this.render.hud.setCallbacks({
      onRestart: () => this.restart(),
      onPause: () => this.togglePause(),
      onToggleJoystick: (enabled) => {
        this.virtualJoystickEnabled = enabled;
        writeStoredBool(DEBUG_SETTINGS_KEYS.virtualJoystickEnabled, enabled);
      },
      onToggleDebug: (enabled) => this.setDebugEnabled(enabled),
      onToggleFps: (enabled) => this.setDebugUiVisible(enabled),
      onToggleChunks: (enabled) => this.setChunkDebugEnabled(enabled),
      onToggleFog: (enabled) => this.setFogEnabled(enabled),
      onToggleAutopilot: (enabled) => this.setAutopilotEnabled(enabled),
    });
    if (this.virtualJoystickEnabled) {
      this.render.hud.setJoystickVisible(true);
    }
    this.render.hud.syncMenuToggle(this.virtualJoystickEnabled);
    this.render.addBoids(this.boids);
  }

  private frameCount = 0;
  private watchInterval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.running = true;
    const initial = this.chunkManager.syncAround(this.player.position, travelDirection(this.player), this.player.speed);
    this.currentChunk = initial.currentCoord;
    this.render.syncChunks(initial.added, initial.removed);
    this.boids.syncChunks(initial.added, initial.removed);
    this.syncChunkMineBoids(initial.added, initial.removed);
    requestAnimationFrame(this.loop);

    if (new URLSearchParams(window.location.search).has('diag')) {
      this.startWatchdog();
    }
  }

  private startWatchdog(): void {
    if (this.watchInterval !== null) {
      return;
    }
    this.watchInterval = setInterval(() => {
      const prev = this.frameCount;
      setTimeout(() => {
        if (this.frameCount === prev) {
          console.warn('[DIAG] Game loop appears stuck — no frame advance in 1s');
        }
      }, 1000);
    }, 2000);
  }

  private restart(): void {
    const oldKeys = [...this.chunkManager.activeChunks.keys()];
    this.syncChunkMineBoids([], oldKeys);
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
    this.syncChunkMineBoids(initial.added, initial.removed);
  }

  private toggleDebug(): void {
    this.setDebugEnabled(!this.debugEnabled);
  }

  private setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled;
    if (!enabled) {
      this.debugUiVisible = false;
    }
    this.render.setDebugEnabled(this.debugEnabled);
    this.render.setDebugUiVisible(this.debugUiVisible);
    this.persistDebugSettings();
  }

  private toggleDebugUi(): void {
    this.setDebugUiVisible(!this.debugUiVisible);
  }

  private setDebugUiVisible(visible: boolean): void {
    if (visible) {
      this.debugEnabled = true;
      this.render.setDebugEnabled(true);
    }
    this.debugUiVisible = visible;
    this.render.setDebugUiVisible(this.debugUiVisible);
    this.persistDebugSettings();
  }

  private toggleChunkDebug(): void {
    this.setChunkDebugEnabled(!this.chunkDebugEnabled);
  }

  private setChunkDebugEnabled(enabled: boolean): void {
    this.chunkDebugEnabled = enabled;
    this.render.setChunkDebugEnabled(this.chunkDebugEnabled);
    this.persistDebugSettings();
  }

  private toggleFog(): void {
    this.setFogEnabled(!this.fogEnabled);
  }

  private setFogEnabled(enabled: boolean): void {
    this.fogEnabled = enabled;
    this.render.setFogEnabled(this.fogEnabled);
    this.persistDebugSettings();
  }

  private setAutopilotEnabled(enabled: boolean): void {
    if (this.autopilot.isEnabled() !== enabled) {
      this.autopilot.toggle();
    }
    this.persistDebugSettings();
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
    this.frameCount++;
    const frameStart = performance.now();
    this.lastFrameTime = timestamp;
    this.fps = 1 / rawDt;

    const inputStart = performance.now();
    this.input.setTouchInput(
      this.render.hud.joystickForward,
      this.render.hud.joystickRight,
      this.render.hud.joystickVertical,
    );
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
    if (input.autopilotTogglePressed) {
      this.autopilot.toggle();
      this.persistDebugSettings();
    }
    this.profiler.addSample('inputMs', performance.now() - inputStart);
    this.render.applyGamepadCameraYaw(input.cameraYaw * dt);

    const effectiveInput = this.autopilot.computeInput(
      this.player,
      this.chunkManager.activeChunks.values(),
      dt,
    ) ?? input;

    let tuning = applyRuntimeTuning(effectiveInput);
    if (!this.paused) {
      const simulationStart = performance.now();
      applyKeyboardSteering(this.player, effectiveInput, dt);
      if (effectiveInput.brake) {
        this.player.velocity.multiplyScalar(Math.max(0, 1 - GAME_CONFIG.ship.brakeDrag * dt));
      }
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
      this.syncChunkMineBoids(sync.added, sync.removed);
      this.profiler.addSample('chunkSyncMs', performance.now() - chunkSyncStart);

      const worldStart = performance.now();
      this.updateWorld(dt);
      this.profiler.addSample('worldMs', performance.now() - worldStart);
      this.spawnBudget.recordFrame(rawDt, this.fps);
    }
    const dangerLevel = worldDangerLevel(this.player.position.y);
    const depthBand = bandForDangerLevel(dangerLevel);
    const predictor = ShipPredictor.forPlayer(this.player);
    if (!this.paused) {
      this.boids.update(dt, this.render.getCameraPosition(), this.player.position, this.player.velocity, this.player.forward, predictor);
      this.syncMineStateFromBoids();
    }
    const renderStart = performance.now();
    this.render.updateFrame({
      paused: this.paused,
      player: this.player,
      predictor,
      chunks: this.chunkManager.activeChunks.values(),
      fps: this.fps,
      seed: this.seed,
      chunkCoord: this.currentChunk,
      distance: shortestWrappedDistance(this.player.position, this.spawnPosition),
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
      autopilot: this.autopilot.isEnabled(),
      virtualJoystickEnabled: this.virtualJoystickEnabled,
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
      if (shortestWrappedDistance(loot.position, this.player.position) <= this.player.radius + loot.radius) {
        loot.collected = true;
        this.player.loot += loot.value;
      }
    }
  }

  private handleSurfaceCollision(): boolean {
    return false;
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
        this.boids.removeManagedBoid(mine.id);
        applyDamage(this.player, mine.damage);
        if (!this.player.alive) {
          return;
        }
      }
    }
  }

  private updateMines(chunk: ChunkData, dt: number): void {
    updateMinesInChunk(chunk, this.player, dt);
    this.syncMineBoids(chunk);
  }

  private syncChunkMineBoids(added: ChunkData[], removed: string[]): void {
    for (const key of removed) {
      const ids = this.mineBoidIdsByChunk.get(key)
      if (!ids) continue
      for (const id of ids) {
        this.boids.removeManagedBoid(id)
      }
      this.mineBoidIdsByChunk.delete(key)
    }
    for (const chunk of added) {
      this.syncMineBoids(chunk)
    }
  }

  private syncMineBoids(chunk: ChunkData): void {
    let ids = this.mineBoidIdsByChunk.get(chunk.key)
    if (!ids) {
      ids = new Set<string>()
      this.mineBoidIdsByChunk.set(chunk.key, ids)
    }
    ids.clear()
    for (const mine of chunk.mines) {
      if (mine.state === 'dead') {
        this.boids.removeManagedBoid(mine.id)
        continue
      }
      this.boids.upsertManagedBoid(
        mine.id,
        mine.position,
        mine.velocity,
        MINE_TYPE.typeId,
        mineBehavior(mine.state),
        mine.telegraphTimer,
      )
      ids.add(mine.id)
    }
  }

  private syncMineStateFromBoids(): void {
    for (const chunk of this.chunkManager.activeChunks.values()) {
      for (const mine of chunk.mines) {
        if (mine.state === 'dead') {
          continue;
        }
        const boid = this.boids.getManagedBoid(mine.id);
        if (!boid) {
          continue;
        }
        mine.position.set(boid.position[0], boid.position[1], boid.position[2]);
        mine.velocity.set(boid.velocity[0], boid.velocity[1], boid.velocity[2]);
      }
    }
  }

  private getChunksWithinRadius(radius: number): ChunkData[] {
    const chunks: ChunkData[] = [];
    for (const chunk of this.chunkManager.activeChunks.values()) {
      if (wrappedChunkDistance(this.currentChunk, chunk.coord) <= radius) {
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
        const wrapped = wrapChunkCoord(coord);
        coords.set(chunkKey(wrapped), { coord: wrapped, entranceFace, clusterCenter: center, mouthRadiusChunks });
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

  private persistDebugSettings(): void {
    writeStoredBool(DEBUG_SETTINGS_KEYS.debugEnabled, this.debugEnabled);
    writeStoredBool(DEBUG_SETTINGS_KEYS.debugUiVisible, this.debugUiVisible);
    writeStoredBool(DEBUG_SETTINGS_KEYS.chunkDebugEnabled, this.chunkDebugEnabled);
    writeStoredBool(DEBUG_SETTINGS_KEYS.fogEnabled, this.fogEnabled);
    writeStoredBool(DEBUG_SETTINGS_KEYS.autopilot, this.autopilot.isEnabled());
  }
}

function mineBehavior(state: ChunkData['mines'][number]['state']): BoidBehavior {
  switch (state) {
    case 'idle': return BoidBehavior.IDLE;
    case 'targeting': return BoidBehavior.TARGETING;
    case 'rocket': return BoidBehavior.ROCKET;
    case 'launched': return BoidBehavior.LAUNCHED;
    case 'dead': return BoidBehavior.NONE;
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

function createRuntimeBoidsConfig(): BoidsConfig {
  const params = new URLSearchParams(window.location.search);
  const mobile = navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 820;
  const hasWebGPU = 'gpu' in navigator;
  const forceCPU = params.has('cpu') || !hasWebGPU;
  const maxBoids = mobile ? 1000 : forceCPU ? 2000 : UNIFIED_WORLD_BOIDS_CONFIG.maxBoids;
  const initialBoids = mobile ? 1000 : forceCPU ? 2000 : UNIFIED_WORLD_BOIDS_CONFIG.initialBoids;
  return {
    ...UNIFIED_WORLD_BOIDS_CONFIG,
    maxBoids,
    initialBoids,
    fallback: { cpuMaxBoids: maxBoids },
    forceCPU,
  };
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
