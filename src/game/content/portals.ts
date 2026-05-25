import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { AABB, ChunkCoord, Face, Portal } from '../types';
import { faceSeed } from '../utils/hash';
import { SeededRandom } from '../utils/rng';
import { chunkKey } from '../utils/chunk';

const FACE_DATA: Record<Face, { normal: Vector3; axis: 'x' | 'y' | 'z' }> = {
  px: { normal: new Vector3(1, 0, 0), axis: 'x' },
  nx: { normal: new Vector3(-1, 0, 0), axis: 'x' },
  py: { normal: new Vector3(0, 1, 0), axis: 'y' },
  ny: { normal: new Vector3(0, -1, 0), axis: 'y' },
  pz: { normal: new Vector3(0, 0, 1), axis: 'z' },
  nz: { normal: new Vector3(0, 0, -1), axis: 'z' },
};

export function generatePortals(globalSeed: number, coord: ChunkCoord, bounds: AABB): Portal[] {
  const size = GAME_CONFIG.world.chunkSize;
  const radius = GAME_CONFIG.world.portalRadius;
  const thickness = GAME_CONFIG.world.portalThickness;
  const portals: Portal[] = [];

  (Object.keys(FACE_DATA) as Face[]).forEach((face) => {
    const rng = new SeededRandom(faceSeed(globalSeed, coord, face));
    const inset = radius + GAME_CONFIG.world.portalInset;
    const a = rng.range(inset, size - inset);
    const b = rng.range(inset, size - inset);
    const center = bounds.min.clone();
    const normal = FACE_DATA[face].normal;
    const neighbor = {
      x: coord.x + normal.x,
      y: coord.y + normal.y,
      z: coord.z + normal.z,
    };

    switch (face) {
      case 'px':
        center.set(bounds.max.x, bounds.min.y + a, bounds.min.z + b);
        break;
      case 'nx':
        center.set(bounds.min.x, bounds.min.y + a, bounds.min.z + b);
        break;
      case 'py':
        center.set(bounds.min.x + a, bounds.max.y, bounds.min.z + b);
        break;
      case 'ny':
        center.set(bounds.min.x + a, bounds.min.y, bounds.min.z + b);
        break;
      case 'pz':
        center.set(bounds.min.x + a, bounds.min.y + b, bounds.max.z);
        break;
      case 'nz':
        center.set(bounds.min.x + a, bounds.min.y + b, bounds.min.z);
        break;
    }

    const min = center.clone();
    const max = center.clone();
    if (FACE_DATA[face].axis === 'x') {
      min.x -= thickness;
      max.x += thickness;
      min.y -= radius;
      max.y += radius;
      min.z -= radius;
      max.z += radius;
    } else if (FACE_DATA[face].axis === 'y') {
      min.y -= thickness;
      max.y += thickness;
      min.x -= radius;
      max.x += radius;
      min.z -= radius;
      max.z += radius;
    } else {
      min.z -= thickness;
      max.z += thickness;
      min.x -= radius;
      max.x += radius;
      min.y -= radius;
      max.y += radius;
    }

    portals.push({
      id: `${chunkKey(coord)}:${face}`,
      face,
      center,
      radius,
      bounds: { min, max },
      neighbor,
    });
  });

  return portals;
}
