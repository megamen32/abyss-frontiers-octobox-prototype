import { describe, expect, it } from 'vitest';
import { ChunkGenerator } from '../src/game/content/chunkGenerator';
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
    const coords = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: -1, z: 0 },
    ];
    const chunks = coords.map((coord) => generator.generate(coord));
    const radii = chunks.flatMap((chunk) => chunk.obstacles.map((obstacle) => obstacle.radius ?? obstacle.size?.length() ?? 0));
    expect(Math.min(...radii)).toBeLessThan(1.1);
    expect(Math.max(...radii)).toBeGreaterThan(6.5);
  });

  it('keeps the ship moving and steers slower under boost', () => {
    const player = createInitialPlayerState();
    const camera = { yaw: 0, pitch: 0 };

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
    expect(player.lookDirection.x).toBeLessThan(0);
  });
});
