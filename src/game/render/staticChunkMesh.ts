import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three';
import type { ChunkData, Obstacle } from '../types';
import { GAME_CONFIG } from '../config';

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
  if (chunk.isCaveChunk && mesh.material instanceof MeshStandardMaterial) {
    const caveMaterial = mesh.material.clone();
    caveMaterial.color = new Color('#7aa7b8');
    caveMaterial.emissive = new Color('#18384a');
    caveMaterial.emissiveIntensity = 0.8;
    caveMaterial.roughness = 0.52;
    caveMaterial.metalness = 0.06;
    mesh.material = caveMaterial;
  }
  mesh.position.copy(chunk.bounds.min);
  return mesh;
}

export function createBlackHoleEntrance(chunk: ChunkData): Mesh | null {
  if (!chunk.caveEntranceCenter) return null;
  const center = new Vector3(chunk.caveEntranceCenter.x, chunk.caveEntranceCenter.y, chunk.caveEntranceCenter.z);
  const geo = new SphereGeometry(GAME_CONFIG.blackHole.entranceRadius, 32, 24);
  const normals = geo.attributes.normal.array as Float32Array;
  for (let i = 0; i < normals.length; i++) {
    normals[i] *= -1;
  }
  geo.attributes.normal.needsUpdate = true;
  const mat = new MeshStandardMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.75,
    blending: AdditiveBlending,
    depthWrite: false,
    roughness: 0.3,
    metalness: 0.0,
  });
  const mesh = new Mesh(geo, mat);
  mesh.position.copy(center);
  return mesh;
}

export function isRepresentedByStaticChunkMesh(chunk: ChunkData, obstacle: Obstacle): boolean {
  return obstacle.type === 'box'
    && obstacle.motion === 'static'
    && chunk.staticMeshRepresentsObstacles !== false
    && Boolean(chunk.staticMeshData && chunk.staticMeshData.indices.length > 0);
}
