import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three';
import type { ChunkData, Face, Obstacle } from '../types';
import { GAME_CONFIG } from '../config';
import { createFogDitherMaterial } from './fogDither';

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
  const base = material instanceof MeshStandardMaterial ? material : new MeshStandardMaterial();
  const chunkMaterial = createFogDitherMaterial(base);
  if (chunk.isCaveChunk) {
    chunkMaterial.color = new Color('#7aa7b8');
    chunkMaterial.emissive = new Color('#18384a');
    chunkMaterial.emissiveIntensity = 0.8;
    chunkMaterial.roughness = 0.52;
    chunkMaterial.metalness = 0.06;
  }
  const mesh = new Mesh(geometry, chunkMaterial);
  mesh.position.copy(chunk.bounds.min);
  return mesh;
}

export function createBlackHoleEntrance(chunk: ChunkData): Group | null {
  if (!chunk.caveEntranceCenter || !chunk.caveEntranceFace || !chunk.caveEntranceRadius) return null;
  const center = new Vector3(chunk.caveEntranceCenter.x, chunk.caveEntranceCenter.y, chunk.caveEntranceCenter.z);
  const radius = chunk.caveEntranceRadius;
  const group = new Group();

  const rimRadius = radius * (1 - GAME_CONFIG.blackHole.rimThickness * 0.5);
  const rimTube = Math.max(4, radius * GAME_CONFIG.blackHole.rimThickness);
  const rimGeo = new TorusGeometry(rimRadius, rimTube, 16, 48);
  const rimPositions = rimGeo.attributes.position.array as Float32Array;
  for (let i = 0; i < rimPositions.length; i += 3) {
    const wobble = 1 + 0.08 * Math.sin(rimPositions[i] * 0.08 + rimPositions[i + 1] * 0.11 + rimPositions[i + 2] * 0.07);
    rimPositions[i] *= wobble;
    rimPositions[i + 1] *= wobble;
    rimPositions[i + 2] *= wobble;
  }
  rimGeo.attributes.position.needsUpdate = true;
  rimGeo.computeVertexNormals();
  const rimMat = new MeshStandardMaterial({
    color: new Color('#5f7680'),
    emissive: new Color('#1a303f'),
    emissiveIntensity: 0.45,
    roughness: 0.88,
    metalness: 0.05,
  });
  const rim = new Mesh(rimGeo, rimMat);

  const glowGeo = new CircleGeometry(radius * GAME_CONFIG.blackHole.glowRadiusMultiplier, 48);
  const glowMat = new MeshBasicMaterial({
    color: new Color('#8fe3ff'),
    transparent: true,
    opacity: 0.32,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const glow = new Mesh(glowGeo, glowMat);
  glow.position.z = -radius * 0.08;

  orientEntrance(group, chunk.caveEntranceFace);
  group.position.copy(center);
  group.add(glow, rim);
  return group;
}

function orientEntrance(group: Group, face: Face): void {
  switch (face) {
    case 'px':
    case 'nx':
      group.rotation.y = Math.PI / 2;
      break;
    case 'py':
    case 'ny':
      group.rotation.x = Math.PI / 2;
      break;
    case 'pz':
    case 'nz':
      break;
  }
}

export function isRepresentedByStaticChunkMesh(chunk: ChunkData, obstacle: Obstacle): boolean {
  return obstacle.type === 'box'
    && obstacle.motion === 'static'
    && chunk.staticMeshRepresentsObstacles !== false
    && Boolean(chunk.staticMeshData && chunk.staticMeshData.indices.length > 0);
}
