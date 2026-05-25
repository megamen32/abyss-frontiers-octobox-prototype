import { Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChunkGenerator } from '../src/game/content/chunkGenerator';
import { GAME_CONFIG } from '../src/game/config';
import { prioritizedChunkCoords } from '../src/game/simulation/chunkManager';
import {
  resolvePlayerObstacleCollision,
  resolvePlayerSurfaceCollision,
  sweptSphereHitsObstacle,
} from '../src/game/simulation/collisions';
import { updateMinesInChunk } from '../src/game/simulation/mines';
import { applyDamage, createInitialPlayerState, travelDirection, updatePlayer } from '../src/game/simulation/player';
import { applyRuntimeTuning, getRuntimeFlightTuning, resetRuntimeFlightTuning } from '../src/game/simulation/runtimeTuning';
import { SpawnBudgetController } from '../src/game/simulation/spawnBudget';
import type { InputState, Obstacle } from '../src/game/types';
import { applyKeyboardSteering } from '../src/game/simulation/steering';
import { bandForDangerLevel, worldDangerLevel } from '../src/game/utils/depth';
import { chunkGenerationRadius, fogChunkRenderRadius, fogVisibilityDistance } from '../src/game/utils/visibility';

function testInput(overrides: Partial<InputState> = {}): InputState {
  return {
    forward: 0,
    right: 0,
    vertical: 0,
    boost: false,
    accelerationAdjust: 0,
    dragAdjust: 0,
    turnAdjust: 0,
    restartPressed: false,
    debugTogglePressed: false,
    chunkDebugTogglePressed: false,
    fogTogglePressed: false,
    debugUiTogglePressed: false,
    pausePressed: false,
    ...overrides,
  };
}

function serializeChunk(seed: number, coord: { x: number; y: number; z: number }): string {
  const generator = new ChunkGenerator(seed);
  const chunk = generator.generate(coord);
  return JSON.stringify({
    cells: chunk.cells.map((cell) => ({
      id: cell.id,
      kind: cell.kind,
      min: [cell.bounds.min.x, cell.bounds.min.y, cell.bounds.min.z],
      max: [cell.bounds.max.x, cell.bounds.max.y, cell.bounds.max.z],
    })),
    portals: chunk.portals.map((portal) => ({
      face: portal.face,
      center: [portal.center.x, portal.center.y, portal.center.z],
      radius: portal.radius,
    })),
    obstacles: chunk.obstacles.map((obstacle) => ({
      id: obstacle.id,
      type: obstacle.type,
      pos: [obstacle.position.x, obstacle.position.y, obstacle.position.z],
    })),
    loot: chunk.loot.map((loot) => ({
      id: loot.id,
      type: loot.type,
      pos: [loot.position.x, loot.position.y, loot.position.z],
    })),
  });
}

describe('ChunkGenerator', () => {
  beforeEach(() => {
    resetRuntimeFlightTuning();
  });

  it('is deterministic for the same seed and chunk coordinate', () => {
    const first = serializeChunk(133742, { x: 0, y: 0, z: 0 });
    const second = serializeChunk(133742, { x: 0, y: 0, z: 0 });
    expect(first).toBe(second);
  });

  it('aligns portals between neighboring chunks', () => {
    const generator = new ChunkGenerator(133742);
    const left = generator.generate({ x: 0, y: 0, z: 0 });
    const right = generator.generate({ x: 1, y: 0, z: 0 });
    const leftPortal = left.portals.find((portal) => portal.face === 'px');
    const rightPortal = right.portals.find((portal) => portal.face === 'nx');

    expect(leftPortal).toBeDefined();
    expect(rightPortal).toBeDefined();
    expect(leftPortal?.center.y).toBe(rightPortal?.center.y);
    expect(leftPortal?.center.z).toBe(rightPortal?.center.z);
    expect(leftPortal?.center.x).toBe(rightPortal?.center.x);
    expect(leftPortal?.radius).toBe(rightPortal?.radius);
  });

  it('produces varied obstacle scales across nearby chunks', () => {
    const generator = new ChunkGenerator(133742);
    const chunk = generator.generate({ x: 0, y: 0, z: 0 });
    expect(chunk.obstacles.every((obstacle) => obstacle.type === 'box')).toBe(true);
    for (const obstacle of chunk.obstacles) {
      const cell = chunk.cells.find((candidate) => candidate.id === obstacle.cellId);
      expect(cell).toBeDefined();
      expect(obstacle.position.x).toBeCloseTo((cell!.bounds.min.x + cell!.bounds.max.x) * 0.5);
      expect(obstacle.position.y).toBeCloseTo((cell!.bounds.min.y + cell!.bounds.max.y) * 0.5);
      expect(obstacle.position.z).toBeCloseTo((cell!.bounds.min.z + cell!.bounds.max.z) * 0.5);
      expect(obstacle.size?.x).toBeCloseTo(cell!.bounds.max.x - cell!.bounds.min.x);
      expect(obstacle.size?.y).toBeCloseTo(cell!.bounds.max.y - cell!.bounds.min.y);
      expect(obstacle.size?.z).toBeCloseTo(cell!.bounds.max.z - cell!.bounds.min.z);
    }
  });

  it('keeps a freer center in cave mode with 3x3x3 splitting', () => {
    const generator = new ChunkGenerator(133742);
    const chunk = generator.generate({ x: 0, y: 0, z: 0 });
    const sorted = [...chunk.cells].sort((a, b) => b.caveBias - a.caveBias);
    const centralCells = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.08)));
    const blockedCentral = centralCells.filter((cell) => cell.kind === 'obstacle').length;
    expect(blockedCentral).toBeLessThanOrEqual(Math.floor(centralCells.length * 0.4));
  });

  it('keeps leaf cells between ship scale and about twenty ship sizes', () => {
    const generator = new ChunkGenerator(133742);
    const chunk = generator.generate({ x: 0, y: 0, z: 0 });
    const shipDiameter = GAME_CONFIG.ship.radius * 2;
    const minAllowed = shipDiameter * GAME_CONFIG.world.octoboxMinCellSizeMultiplier;
    const maxAllowed = shipDiameter * GAME_CONFIG.world.octoboxMaxCellSizeMultiplier;

    for (const cell of chunk.cells) {
      const minEdge = Math.min(
        cell.bounds.max.x - cell.bounds.min.x,
        cell.bounds.max.y - cell.bounds.min.y,
        cell.bounds.max.z - cell.bounds.min.z,
      );
      expect(minEdge).toBeGreaterThanOrEqual(minAllowed - 0.01);
      expect(minEdge).toBeLessThanOrEqual(maxAllowed + 0.01);
    }
  });

  it('keeps the zero-density surface chunk free of obstacles', () => {
    const generator = new ChunkGenerator(133742);
    const chunk = generator.generate({ x: 0, y: 1, z: 0 });
    expect(chunk.obstacles.length).toBe(0);
  });

  it('raises world danger and obstacle density with depth', () => {
    const generator = new ChunkGenerator(133742);
    const shallow = generator.generate({ x: 0, y: 0, z: 0 });
    const surface = generator.generate({ x: 0, y: 1, z: 0 });
    const deep = generator.generate({ x: 0, y: -4, z: 0 });

    expect(worldDangerLevel(GAME_CONFIG.world.spawn.y)).toBe(0);
    expect(surface.obstacles.length).toBe(0);
    expect(worldDangerLevel(deep.bounds.max.y)).toBeGreaterThan(worldDangerLevel(shallow.bounds.max.y));
    expect(bandForDangerLevel(worldDangerLevel(deep.bounds.max.y)).label).toBe('PRESSURE TRENCH');
    const deepNonCave = generator.generate({ x: 0, y: -3, z: 0 });
    if (deepNonCave.obstacles.length > 0) {
      expect(deepNonCave.obstacles.length).toBeGreaterThanOrEqual(shallow.obstacles.length);
    }
  });

  it('accelerates gradually and gains more speed at depth', () => {
    const player = createInitialPlayerState();
    expect(player.hp).toBe(100);
    const initialSpeed = player.velocity.length();

    updatePlayer(player, 0.1);
    expect(player.velocity.length()).toBeGreaterThan(initialSpeed);
    expect(player.velocity.length()).toBeLessThan(GAME_CONFIG.ship.maxSpeed);

    const shallowSpeed = player.velocity.length();
    player.position.y = GAME_CONFIG.world.spawn.y - GAME_CONFIG.world.depthDifficultyRamp;
    updatePlayer(player, 0.2);
    expect(player.velocity.length()).toBeGreaterThan(shallowSpeed);
  });

  it('lets thrust turn gradually instead of snapping instantly', () => {
    const player = createInitialPlayerState();

    applyKeyboardSteering(
      player,
      testInput({ right: -1 }),
      0.2,
    );
    const targetAfterInput = player.targetThrustForward.clone();
    const thrustBeforeUpdate = player.thrustForward.clone();

    updatePlayer(player, 0.1);
    expect(player.thrustForward.x).toBeLessThan(0);
    expect(player.thrustForward.angleTo(targetAfterInput)).toBeGreaterThan(0.001);
    expect(player.thrustForward.angleTo(targetAfterInput)).toBeLessThan(thrustBeforeUpdate.angleTo(targetAfterInput));
  });

  it('maps A D to yaw and W S to pitch', () => {
    const player = createInitialPlayerState();

    applyKeyboardSteering(
      player,
      testInput({ right: -1 }),
      0.2,
    );
    expect(player.targetThrustForward.x).toBeLessThan(0);

    applyKeyboardSteering(
      player,
      testInput({ forward: 1 }),
      0.2,
    );
    expect(player.targetThrustForward.y).toBeGreaterThan(0);

    applyKeyboardSteering(
      player,
      testInput({ forward: -1, right: 1 }),
      0.2,
    );
    expect(player.targetThrustForward.x).toBeGreaterThan(-0.2);
    expect(player.targetThrustForward.y).toBeLessThan(0.2);
  });

  it('adjusts acceleration, drag, and turn speed at runtime', () => {
    applyRuntimeTuning(testInput({ accelerationAdjust: 2, dragAdjust: 1, turnAdjust: -2 }));
    const tuning = getRuntimeFlightTuning();
    expect(tuning.baseAcceleration).toBeCloseTo(GAME_CONFIG.ship.baseAcceleration + 1);
    expect(tuning.baseDrag).toBeCloseTo(GAME_CONFIG.ship.baseDrag + 0.02);
    expect(tuning.turnInputSpeed).toBeCloseTo(GAME_CONFIG.camera.keyboardYawSpeed - 0.2);
  });

  it('makes the visual hull lag behind velocity at high speed', () => {
    const player = createInitialPlayerState();
    player.velocity.set(0, 0, GAME_CONFIG.ship.maxSpeed * 0.9);
    player.speed = player.velocity.length();
    player.forward.set(0, 0, 1);
    player.thrustForward.set(1, 0, 0).normalize();
    player.targetThrustForward.copy(player.thrustForward);

    updatePlayer(player, 0.1);
    expect(player.velocity.x).toBeGreaterThan(0);
    expect(player.forward.x).toBeGreaterThan(0);
    expect(player.forward.angleTo(player.velocity.clone().normalize())).toBeGreaterThan(0.003);
  });

  it('sharp turns at high speed trigger stall and reduce speed', () => {
    const player = createInitialPlayerState();
    player.velocity.set(0, 0, GAME_CONFIG.ship.maxSpeed * 0.95);
    player.speed = player.velocity.length();
    player.forward.set(0, 0, 1);
    player.thrustForward.set(1, 0, 0).normalize();
    player.targetThrustForward.copy(player.thrustForward);
    const speedBefore = player.velocity.length();

    updatePlayer(player, 0.25);
    expect(player.stallAmount).toBeGreaterThan(0.7);
    expect(player.velocity.length()).toBeLessThan(speedBefore);
  });

  it('prioritizes chunk generation in front of the ship', () => {
    const player = createInitialPlayerState();
    const ordered = prioritizedChunkCoords({ x: 0, y: 0, z: 0 }, 1, travelDirection(player));
    expect(ordered[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(ordered[1]).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('keeps fog visibility and preload radius aligned', () => {
    expect(fogVisibilityDistance()).toBeGreaterThan(GAME_CONFIG.world.chunkSize);
    expect(fogChunkRenderRadius()).toBeGreaterThanOrEqual(1);
    expect(chunkGenerationRadius()).toBe(fogChunkRenderRadius() + GAME_CONFIG.world.preloadRadiusPadding);
  });

  it('reduces spawn budget by one after a low-fps sample window but never below one', () => {
    const budget = new SpawnBudgetController();
    const framesPerWindow = 10;
    const dt = GAME_CONFIG.world.spawnBudgetSampleSeconds / framesPerWindow;
    const lowFps = GAME_CONFIG.world.spawnBudgetFpsThreshold - 1;
    const expectedAfterFirstWindow = Math.max(
      GAME_CONFIG.world.spawnBudgetMin,
      GAME_CONFIG.world.spawnBudgetInitial - 1,
    );

    for (let index = 0; index < framesPerWindow; index += 1) {
      budget.recordFrame(dt, lowFps);
    }
    expect(budget.getBudget()).toBe(expectedAfterFirstWindow);

    const extraMinutes = Math.max(0, expectedAfterFirstWindow - GAME_CONFIG.world.spawnBudgetMin);
    for (let index = 0; index < extraMinutes * framesPerWindow; index += 1) {
      budget.recordFrame(dt, lowFps);
    }
    expect(budget.getBudget()).toBe(GAME_CONFIG.world.spawnBudgetMin);
  });

  it('generates deterministic mines for simulation chunks', () => {
    const generator = new ChunkGenerator(133742);
    const first = generator.generate({ x: 0, y: 0, z: 0 });
    const second = generator.generate({ x: 0, y: 0, z: 0 });
    expect(first.mines.map((mine) => mine.id)).toEqual(second.mines.map((mine) => mine.id));
    expect(first.mines.every((mine) => mine.state === 'idle')).toBe(true);
  });

  it('telegraphs mine launch before firing', () => {
    const generator = new ChunkGenerator(133742);
    let chunk = generator.generate({ x: 0, y: 0, z: 0 });

    if (chunk.mines.length === 0) {
      for (let x = -1; x <= 1 && chunk.mines.length === 0; x += 1) {
        for (let y = -1; y <= 1 && chunk.mines.length === 0; y += 1) {
          for (let z = -1; z <= 1 && chunk.mines.length === 0; z += 1) {
            chunk = generator.generate({ x, y, z });
          }
        }
      }
    }

    expect(chunk.mines.length).toBeGreaterThan(0);

    const mine = chunk.mines[0];
    const player = createInitialPlayerState();
    player.position.copy(mine.position).add(new Vector3(0, 0, mine.triggerRadius * 0.5));
    player.velocity.set(0, 0, 6);

    updateMinesInChunk(chunk, player, 0.1);
    expect(mine.state).toBe('targeting');
    expect(mine.telegraphTimer).toBeCloseTo(GAME_CONFIG.mines.telegraphDuration);
    expect(mine.targetPosition).not.toBeNull();
    expect(mine.velocity.length()).toBe(0);

    updateMinesInChunk(chunk, player, GAME_CONFIG.mines.telegraphDuration);
    expect(mine.state).toBe('launched');
    expect(mine.targetPosition).toBeNull();
    expect(mine.velocity.length()).toBeCloseTo(mine.speed, 4);
  });

  it('detects and resolves fast ship collision against a box around distance 45', () => {
    const obstacle: Obstacle = {
      id: 'wall',
      type: 'box',
      motion: 'static',
      bounds: { min: new Vector3(-5, -5, 40), max: new Vector3(5, 5, 50) },
      position: new Vector3(0, 0, 45),
      basePosition: new Vector3(0, 0, 45),
      size: new Vector3(10, 10, 10),
      damage: 1,
      cellId: 'cell',
      axis: new Vector3(0, 1, 0),
      angularSpeed: 0,
      driftAmplitude: 0,
      phase: 0,
    };

    const player = createInitialPlayerState();
    player.previousPosition.set(0, 0, 30);
    player.position.set(0, 0, 52);
    player.velocity.set(0, 0, 22);

    expect(sweptSphereHitsObstacle(player.previousPosition, player.position, player.radius, obstacle)).toBe(true);

    resolvePlayerObstacleCollision(player, obstacle);
    expect(player.position.z).toBeLessThan(40);
    expect(player.velocity.z).toBeLessThan(0);
    expect(player.velocity.length()).toBeGreaterThan(6);
    expect(player.forward.angleTo(player.velocity.clone().normalize())).toBeLessThan(0.001);
  });

  it('survives five surface hits and gets knocked back underwater', () => {
    const player = createInitialPlayerState();
    player.position.set(0, GAME_CONFIG.world.spawn.y + 2, 0);
    player.previousPosition.set(0, GAME_CONFIG.world.spawn.y - 0.5, 0);
    player.velocity.set(3, 9, 1);

    for (let hit = 1; hit <= 5; hit += 1) {
      resolvePlayerSurfaceCollision(player, GAME_CONFIG.world.spawn.y);
      applyDamage(player, GAME_CONFIG.collision.surfaceDamage);

      expect(player.position.y).toBeLessThan(GAME_CONFIG.world.spawn.y);

      if (hit < 5) {
        expect(player.alive).toBe(true);
        expect(player.velocity.y).toBeLessThan(0);
        expect(player.forward.angleTo(player.velocity.clone().normalize())).toBeLessThan(0.001);
        expect(player.hp).toBe(GAME_CONFIG.ship.hp - GAME_CONFIG.collision.surfaceDamage * hit);
        player.invulnerabilityTimer = 0;
        player.position.y = GAME_CONFIG.world.spawn.y + 1.5;
        player.previousPosition.y = GAME_CONFIG.world.spawn.y - 0.25;
        player.velocity.set(2, 8, -1);
      } else {
        expect(player.hp).toBe(0);
        expect(player.alive).toBe(false);
        expect(player.velocity.length()).toBe(0);
      }
    }
  });
});
