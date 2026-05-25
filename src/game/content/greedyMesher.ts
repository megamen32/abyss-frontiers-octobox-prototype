import type { StaticChunkMeshData } from '../types';

export type Point3 = readonly [number, number, number];

export interface StaticBox {
  min: Point3;
  max: Point3;
}

/**
 * Builds the exact outer shell of arbitrary axis-aligned boxes. Coordinate
 * compression preserves adaptive cell bounds while allowing voxel-style greedy merges.
 */
export function buildGreedyStaticMesh(
  boxes: readonly StaticBox[],
  origin: Point3 = [0, 0, 0],
): StaticChunkMeshData {
  if (boxes.length === 0) {
    return emptyMesh();
  }

  const axes = [
    sortedUnique(boxes.flatMap((box) => [box.min[0], box.max[0]])),
    sortedUnique(boxes.flatMap((box) => [box.min[1], box.max[1]])),
    sortedUnique(boxes.flatMap((box) => [box.min[2], box.max[2]])),
  ];
  const dimensions: Point3 = [axes[0].length - 1, axes[1].length - 1, axes[2].length - 1];
  const occupancy = new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2]);
  const axisIndexes = axes.map((axis) => new Map(axis.map((value, index) => [value, index])));

  for (const box of boxes) {
    const starts = box.min.map((value, axis) => requireIndex(axisIndexes[axis], value)) as unknown as Point3;
    const ends = box.max.map((value, axis) => requireIndex(axisIndexes[axis], value)) as unknown as Point3;
    for (let x = starts[0]; x < ends[0]; x += 1) {
      for (let y = starts[1]; y < ends[1]; y += 1) {
        for (let z = starts[2]; z < ends[2]; z += 1) {
          occupancy[cellIndex(x, y, z, dimensions)] = 1;
        }
      }
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    emitFaces(axis, 1, axes, dimensions, occupancy, origin, positions, normals, indices);
    emitFaces(axis, -1, axes, dimensions, occupancy, origin, positions, normals, indices);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

function emitFaces(
  axis: number,
  normalSign: 1 | -1,
  axes: number[][],
  dimensions: Point3,
  occupancy: Uint8Array,
  origin: Point3,
  positions: number[],
  normals: number[],
  indices: number[],
): void {
  const uAxis = (axis + 1) % 3;
  const vAxis = (axis + 2) % 3;
  const maskWidth = dimensions[uAxis];
  const maskHeight = dimensions[vAxis];
  const mask = new Uint8Array(maskWidth * maskHeight);

  for (let slice = 0; slice < dimensions[axis]; slice += 1) {
    mask.fill(0);
    for (let v = 0; v < maskHeight; v += 1) {
      for (let u = 0; u < maskWidth; u += 1) {
        const cell = coordinateForSlice(axis, slice, uAxis, u, vAxis, v);
        if (!isOccupied(cell, dimensions, occupancy)) {
          continue;
        }
        cell[axis] += normalSign;
        if (!isOccupied(cell, dimensions, occupancy)) {
          mask[u + v * maskWidth] = 1;
        }
      }
    }

    for (let v = 0; v < maskHeight; v += 1) {
      for (let u = 0; u < maskWidth;) {
        if (mask[u + v * maskWidth] === 0) {
          u += 1;
          continue;
        }
        const width = faceWidth(mask, maskWidth, u, v);
        const height = faceHeight(mask, maskWidth, maskHeight, u, v, width);
        clearFace(mask, maskWidth, u, v, width, height);
        emitQuad(axis, normalSign, slice, uAxis, vAxis, u, v, width, height, axes, origin, positions, normals, indices);
        u += width;
      }
    }
  }
}

function emitQuad(
  axis: number,
  normalSign: 1 | -1,
  slice: number,
  uAxis: number,
  vAxis: number,
  u: number,
  v: number,
  width: number,
  height: number,
  axes: number[][],
  origin: Point3,
  positions: number[],
  normals: number[],
  indices: number[],
): void {
  const plane = axes[axis][slice + (normalSign > 0 ? 1 : 0)];
  const vertices: number[][] = Array.from({ length: 4 }, () => [0, 0, 0]);
  for (const vertex of vertices) {
    vertex[axis] = plane;
  }
  vertices[0][uAxis] = vertices[3][uAxis] = axes[uAxis][u];
  vertices[1][uAxis] = vertices[2][uAxis] = axes[uAxis][u + width];
  vertices[0][vAxis] = vertices[1][vAxis] = axes[vAxis][v];
  vertices[2][vAxis] = vertices[3][vAxis] = axes[vAxis][v + height];

  const start = positions.length / 3;
  for (const vertex of vertices) {
    positions.push(vertex[0] - origin[0], vertex[1] - origin[1], vertex[2] - origin[2]);
    normals.push(
      axis === 0 ? normalSign : 0,
      axis === 1 ? normalSign : 0,
      axis === 2 ? normalSign : 0,
    );
  }
  if (normalSign > 0) {
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  } else {
    indices.push(start, start + 3, start + 2, start, start + 2, start + 1);
  }
}

function coordinateForSlice(axis: number, slice: number, uAxis: number, u: number, vAxis: number, v: number): number[] {
  const cell = [0, 0, 0];
  cell[axis] = slice;
  cell[uAxis] = u;
  cell[vAxis] = v;
  return cell;
}

function isOccupied(cell: number[], dimensions: Point3, occupancy: Uint8Array): boolean {
  if (
    cell[0] < 0 || cell[0] >= dimensions[0]
    || cell[1] < 0 || cell[1] >= dimensions[1]
    || cell[2] < 0 || cell[2] >= dimensions[2]
  ) {
    return false;
  }
  return occupancy[cellIndex(cell[0], cell[1], cell[2], dimensions)] !== 0;
}

function cellIndex(x: number, y: number, z: number, dimensions: Point3): number {
  return x + dimensions[0] * (y + dimensions[1] * z);
}

function faceWidth(mask: Uint8Array, width: number, u: number, v: number): number {
  let run = 1;
  while (u + run < width && mask[u + run + v * width] !== 0) {
    run += 1;
  }
  return run;
}

function faceHeight(mask: Uint8Array, width: number, height: number, u: number, v: number, faceWidthValue: number): number {
  let run = 1;
  while (v + run < height) {
    for (let offset = 0; offset < faceWidthValue; offset += 1) {
      if (mask[u + offset + (v + run) * width] === 0) {
        return run;
      }
    }
    run += 1;
  }
  return run;
}

function clearFace(mask: Uint8Array, width: number, u: number, v: number, faceWidthValue: number, faceHeightValue: number): void {
  for (let y = 0; y < faceHeightValue; y += 1) {
    for (let x = 0; x < faceWidthValue; x += 1) {
      mask[u + x + (v + y) * width] = 0;
    }
  }
}

function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function requireIndex(indexes: Map<number, number>, value: number): number {
  const result = indexes.get(value);
  if (result === undefined) {
    throw new Error(`Static box boundary ${value} is not part of compressed mesh axes`);
  }
  return result;
}

function emptyMesh(): StaticChunkMeshData {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    indices: new Uint32Array(0),
  };
}
