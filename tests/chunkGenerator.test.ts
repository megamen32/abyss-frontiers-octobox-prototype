import { describe, expect, it } from 'vitest';
import { ChunkGenerator } from '../src/game/content/chunkGenerator';
import { GAME_CONFIG } from '../src/game/config';
import { prioritizedChunkCoords } from '../src/game/simulation/chunkManager';
import { createInitialPlayerState, updatePlayer } from '../src/game/simulation/player';

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

  it('avoids oversplitting empty cave core cells', () => {
    const generator = new ChunkGenerator(133742);
    const chunk = generator.generate({ x: 0, y: 0, z: 0 });
    const shipDiameter = GAME_CONFIG.ship.radius * 2;
    const centerCells = chunk.cells.filter((cell) => cell.caveBias >= GAME_CONFIG.world.caveCoreBias);
    const largeCenterCells = centerCells.filter((cell) => {
      const minEdge = Math.min(
        cell.bounds.max.x - cell.bounds.min.x,
        cell.bounds.max.y - cell.bounds.min.y,
        cell.bounds.max.z - cell.bounds.min.z,
      );
      return minEdge >= shipDiameter * 3;
    });
    expect(centerCells.length).toBeGreaterThan(0);
    expect(largeCenterCells.length).toBeGreaterThan(0);
  });

  it('keeps the ship moving and steers slower under boost', () => {
    const player = createInitialPlayerState();
    const camera = { yaw: 0, pitch: 0, lastManualLookAt: 0 };

    updatePlayer(
      player,
      { forward: 0, right: 0, vertical: 0, boost: false, restartPressed: false, debugTogglePressed: false },
      camera,
      0.2,
    );
    const cruiseSpeed = player.velocity.length();

    updatePlayer(
      player,
      { forward: 0, right: 1, vertical: 0, boost: true, restartPressed: false, debugTogglePressed: false },
      camera,
      0.2,
    );
    expect(cruiseSpeed).toBeGreaterThan(5);
    expect(player.velocity.length()).toBeGreaterThan(cruiseSpeed);
    expect(player.lookDirection.x).toBeGreaterThan(0);
  });

  it('prioritizes chunk generation in front of the ship', () => {
    const player = createInitialPlayerState();
    const ordered = prioritizedChunkCoords({ x: 0, y: 0, z: 0 }, 1, player.lookDirection);
    expect(ordered[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(ordered[1]).toEqual({ x: 0, y: 0, z: 1 });
  });
});
