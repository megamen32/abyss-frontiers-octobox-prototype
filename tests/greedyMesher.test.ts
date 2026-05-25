import { describe, expect, it } from 'vitest';
import { buildGreedyStaticMesh, type StaticBox } from '../src/game/content/greedyMesher';
import { ChunkGenerator } from '../src/game/content/chunkGenerator';
import { dehydrateChunk, hydrateChunk } from '../src/game/content/chunkPayload';
import { GAME_CONFIG } from '../src/game/config';

function unitBox(x: number, y: number, z: number): StaticBox {
  return { min: [x, y, z], max: [x + 1, y + 1, z + 1] };
}

function faceCount(boxes: StaticBox[]): number {
  return buildGreedyStaticMesh(boxes).indices.length / 6;
}

describe('buildGreedyStaticMesh', () => {
  it('creates six external faces for one solid cell', () => {
    const mesh = buildGreedyStaticMesh([unitBox(0, 0, 0)]);

    expect(faceCount([unitBox(0, 0, 0)])).toBe(6);
    expect(mesh.positions.length).toBe(6 * 4 * 3);
    expect(mesh.normals.length).toBe(mesh.positions.length);
  });

  it('removes internal faces between adjacent cells', () => {
    const mesh = buildGreedyStaticMesh([unitBox(0, 0, 0), unitBox(1, 0, 0)]);

    expect(mesh.indices.length / 3).toBe(12);
    expect(faceCount([unitBox(0, 0, 0), unitBox(1, 0, 0)])).toBe(6);
  });

  it('merges a rectangular block into six large quads', () => {
    const boxes = [
      unitBox(0, 0, 0),
      unitBox(1, 0, 0),
      unitBox(0, 1, 0),
      unitBox(1, 1, 0),
    ];

    expect(faceCount(boxes)).toBe(6);
  });

  it('returns empty typed arrays for an empty grid', () => {
    const mesh = buildGreedyStaticMesh([]);

    expect(mesh.positions).toBeInstanceOf(Float32Array);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);
    expect(mesh.indices.length).toBe(0);
  });

  it('emits outward normals and outward triangle winding', () => {
    const mesh = buildGreedyStaticMesh([unitBox(0, 0, 0)]);
    for (let face = 0; face < mesh.positions.length / 12; face += 1) {
      const vertexOffset = face * 12;
      const normalOffset = face * 12;
      const center = [0, 0, 0];
      for (let vertex = 0; vertex < 4; vertex += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          center[axis] += mesh.positions[vertexOffset + vertex * 3 + axis] / 4;
        }
      }
      const normal = [
        mesh.normals[normalOffset],
        mesh.normals[normalOffset + 1],
        mesh.normals[normalOffset + 2],
      ];
      const fromCenter = center.map((value) => value - 0.5);
      expect(dot(fromCenter, normal)).toBeGreaterThan(0);

      const triangleOffset = face * 6;
      const a = position(mesh.positions, mesh.indices[triangleOffset]);
      const b = position(mesh.positions, mesh.indices[triangleOffset + 1]);
      const c = position(mesh.positions, mesh.indices[triangleOffset + 2]);
      expect(dot(cross(subtract(b, a), subtract(c, a)), normal)).toBeGreaterThan(0);
    }
  });

  it('only references emitted vertices', () => {
    const mesh = buildGreedyStaticMesh([unitBox(0, 0, 0), unitBox(1, 0, 0), unitBox(1, 1, 0)]);
    const vertexCount = mesh.positions.length / 3;

    for (const index of mesh.indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(vertexCount);
    }
  });

  it('attaches local typed mesh buffers to the serialized chunk payload', () => {
    const chunk = new ChunkGenerator(133742).generate({ x: 0, y: -4, z: 0 });
    const restored = hydrateChunk(dehydrateChunk(chunk));
    const mesh = restored.staticMeshData;

    expect(chunk.obstacles.length).toBeGreaterThan(0);
    expect(mesh?.positions).toBeInstanceOf(Float32Array);
    expect(mesh?.normals).toBeInstanceOf(Float32Array);
    expect(mesh?.indices).toBeInstanceOf(Uint32Array);
    expect(mesh?.indices.length).toBeGreaterThan(0);
    const eps = 0.15;
    for (const position of mesh!.positions) {
      expect(position).toBeGreaterThanOrEqual(-eps);
      expect(position).toBeLessThanOrEqual(GAME_CONFIG.world.chunkSize + eps);
    }
  });
});

function position(positions: Float32Array, index: number): number[] {
  return [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
}

function subtract(left: number[], right: number[]): number[] {
  return left.map((value, index) => value - right[index]);
}

function cross(left: number[], right: number[]): number[] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}
