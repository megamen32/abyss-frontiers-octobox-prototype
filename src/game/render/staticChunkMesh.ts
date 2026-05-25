import { BufferAttribute, BufferGeometry, Mesh, type Material } from 'three';
import type { ChunkData, Obstacle } from '../types';

export function createStaticChunkMesh(chunk: ChunkData, material: Material): Mesh | null {
  const data = chunk.staticMeshData;
  if (!data || data.indices.length === 0) {
    return null;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, material);
  mesh.position.copy(chunk.bounds.min);
  return mesh;
}

export function isRepresentedByStaticChunkMesh(chunk: ChunkData, obstacle: Obstacle): boolean {
  return obstacle.type === 'box'
    && obstacle.motion === 'static'
    && Boolean(chunk.staticMeshData && chunk.staticMeshData.indices.length > 0);
}
