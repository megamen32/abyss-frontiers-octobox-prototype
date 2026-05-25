import { Vector3 } from 'three';
import type {
  AABB,
  CavePathNode,
  CaveSample,
  CaveSystem,
  CaveTunnel,
  ChunkCoord,
  Face,
  GauntletType,
  LeafCell,
  Loot,
  Mine,
  Obstacle,
  Portal,
  StaticChunkMeshData,
} from '../types';
import { GAME_CONFIG } from '../config';
import { chunkKey } from '../utils/chunk';
import { depthBelowSurface } from '../utils/depth';
import { faceSeed } from '../utils/hash';
import { SeededRandom } from '../utils/rng';

export interface CaveEntrance {
  face: Face;
  seed: number;
}

const FACE_INWARD: Record<Face, Vector3> = {
  px: new Vector3(-1, 0, 0),
  nx: new Vector3(1, 0, 0),
  py: new Vector3(0, -1, 0),
  ny: new Vector3(0, 1, 0),
  pz: new Vector3(0, 0, -1),
  nz: new Vector3(0, 0, 1),
};

const GAUNTLET_TYPES: GauntletType[] = [
  'left_passage',
  'right_passage',
  'center_ring',
  'rotating_cylinders',
  'slalom',
  'squeeze',
  'cross_bars',
];

export function detectCaveChunk(
  globalSeed: number,
  coord: ChunkCoord,
): CaveEntrance | null {
  if (!GAME_CONFIG.cave.enabled) return null;
  const chunkMinY = coord.y * GAME_CONFIG.world.chunkSize;
  if (depthBelowSurface(chunkMinY) <= 0) return null;
  for (const face of ['nx', 'ny', 'nz'] as Face[]) {
    const seed = faceSeed(globalSeed, coord, face);
    const rng = new SeededRandom(seed);
    if (rng.next() < GAME_CONFIG.cave.entranceProbability) {
      return { face, seed };
    }
  }
  return null;
}

export function detectCaveEntranceOnPositiveFaces(
  globalSeed: number,
  coord: ChunkCoord,
): CaveEntrance | null {
  if (!GAME_CONFIG.cave.enabled) return null;
  for (const face of ['px', 'py', 'pz'] as Face[]) {
    const seed = faceSeed(globalSeed, coord, face);
    const rng = new SeededRandom(seed);
    if (rng.next() < GAME_CONFIG.cave.entranceProbability) {
      return { face, seed };
    }
  }
  return null;
}

export function generateCaveChunkData(
  coord: ChunkCoord,
  bounds: AABB,
  portals: Portal[],
  entrance: CaveEntrance,
): {
  cells: LeafCell[];
  obstacles: Obstacle[];
  adjacency: [string, string][];
  staticMeshData: StaticChunkMeshData;
  loot: Loot[];
  mines: Mine[];
} {
  const key = chunkKey(coord);
  const entrancePortal = portals.find((p) => p.face === entrance.face);
  if (!entrancePortal) return emptyCaveResult();

  const startDir = FACE_INWARD[entrance.face];
  const system = buildCaveSystem(entrance.seed, entrancePortal.center.clone(), startDir, bounds);
  const allTunnels = collectTunnels(system.mainTunnel);
  const rng = new SeededRandom(entrance.seed);

  const allSamples: CaveSample[] = [];
  const obstacles: Obstacle[] = [];
  for (const tunnel of allTunnels) {
    const samples = sampleTunnelPath(tunnel.nodes, GAME_CONFIG.cave.sampleStep);
    allSamples.push(...samples);
    obstacles.push(...placeGauntlets(tunnel, samples, rng, key));
  }

  const cells = buildCaveCells(allSamples);
  const adjacency: [string, string][] = [];
  for (let i = 1; i < cells.length; i++) {
    adjacency.push([cells[i - 1].id, cells[i].id]);
  }

  const staticMeshData = buildTunnelMesh(
    allSamples,
    GAME_CONFIG.cave.ringSegments,
    bounds.min,
  );

  const loot = placeCaveLoot(cells, portals, rng);
  const mines = placeCaveMines(cells, portals, rng, key);

  return { cells, obstacles, adjacency, staticMeshData, loot, mines };
}

function buildCaveSystem(
  seed: number,
  startPos: Vector3,
  startDir: Vector3,
  bounds: AABB,
): CaveSystem {
  const rng = new SeededRandom(seed);
  const mainTunnel = buildTunnel(rng, startPos, startDir, bounds, 0, 't');
  return { seed, entrancePosition: startPos.clone(), mainTunnel };
}

function buildTunnel(
  rng: SeededRandom,
  startPos: Vector3,
  startDir: Vector3,
  bounds: AABB,
  depth: number,
  id: string,
): CaveTunnel {
  const cfg = GAME_CONFIG.cave;
  const nodeCount = rng.int(cfg.minNodes, cfg.maxNodes);
  const baseRadius = Math.max(cfg.minRadius, cfg.baseRadius - depth * cfg.radiusDecayPerDepth);

  const nodes: CavePathNode[] = [];
  let pos = startPos.clone();
  let dir = startDir.clone().normalize();

  for (let i = 0; i <= nodeCount; i++) {
    const r = Math.max(cfg.minRadius, baseRadius + rng.range(-1.5, 1.5));
    nodes.push({ position: pos.clone(), radius: r });

    if (i < nodeCount) {
      const twist = new Vector3(
        rng.next() - 0.5,
        rng.next() - 0.5,
        rng.next() - 0.5,
      ).normalize();
      dir.applyAxisAngle(twist, rng.range(0, cfg.maxCurvature));
      dir.normalize();
      pos = pos.clone().add(dir.clone().multiplyScalar(cfg.nodeSpacing));
      const margin = r + 2;
      pos.x = clampMargin(pos.x, bounds.min.x + margin, bounds.max.x - margin);
      pos.y = clampMargin(pos.y, bounds.min.y + margin, bounds.max.y - margin);
      pos.z = clampMargin(pos.z, bounds.min.z + margin, bounds.max.z - margin);
    }
  }

  const gauntletType = rng.pick(GAUNTLET_TYPES);
  const children: CaveTunnel[] = [];

  if (depth < cfg.maxBranchDepth && rng.next() < cfg.branchProbability) {
    const last = nodes[nodes.length - 1];
    const branchCount = rng.next() < 0.6 ? 2 : 3;
    for (let b = 0; b < branchCount - 1; b++) {
      const branchDir = dir.clone();
      const twist = new Vector3(
        rng.next() - 0.5,
        rng.next() - 0.5,
        rng.next() - 0.5,
      ).normalize();
      branchDir.applyAxisAngle(twist, rng.range(0.3, 0.7));
      branchDir.normalize();
      children.push(
        buildTunnel(rng, last.position.clone(), branchDir, bounds, depth + 1, `${id}${b}`),
      );
    }
  }

  return { id, nodes, gauntletType, children, depth };
}

function collectTunnels(tunnel: CaveTunnel): CaveTunnel[] {
  return [tunnel, ...tunnel.children.flatMap(collectTunnels)];
}

function clampMargin(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sampleTunnelPath(
  nodes: CavePathNode[],
  step: number,
): CaveSample[] {
  if (nodes.length < 2) return [];
  const positions = nodes.map((n) => n.position);
  const radii = nodes.map((n) => n.radius);
  const padded = [positions[0], ...positions, positions[positions.length - 1]];
  const samples: CaveSample[] = [];

  for (let i = 0; i < positions.length - 1; i++) {
    const segLen = positions[i].distanceTo(positions[i + 1]);
    const steps = Math.max(2, Math.ceil(segLen / step));

    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const pos = catmullRom(padded[i], padded[i + 1], padded[i + 2], padded[i + 3], t);
      const tan = catmullRomTangent(
        padded[i],
        padded[i + 1],
        padded[i + 2],
        padded[i + 3],
        t,
      ).normalize();
      const radius = radii[i] + (radii[i + 1] - radii[i]) * t;
      const frame = buildFrame(tan);
      samples.push({ position: pos, tangent: tan, ...frame, radius });
    }
  }

  const last = nodes[nodes.length - 1];
  const prevTan =
    samples.length > 0 ? samples[samples.length - 1].tangent : new Vector3(1, 0, 0);
  const frame = buildFrame(prevTan);
  samples.push({
    position: last.position.clone(),
    tangent: prevTan,
    ...frame,
    radius: last.radius,
  });

  return samples;
}

function buildFrame(tangent: Vector3): {
  normal: Vector3;
  binormal: Vector3;
} {
  const ref =
    Math.abs(tangent.y) < 0.95 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const binormal = new Vector3().crossVectors(tangent, ref).normalize();
  const normal = new Vector3().crossVectors(binormal, tangent).normalize();
  return { normal, binormal };
}

function catmullRom(
  p0: Vector3,
  p1: Vector3,
  p2: Vector3,
  p3: Vector3,
  t: number,
): Vector3 {
  const t2 = t * t;
  const t3 = t2 * t;
  return new Vector3(
    0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    0.5 *
      (2 * p1.z +
        (-p0.z + p2.z) * t +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  );
}

function catmullRomTangent(
  p0: Vector3,
  p1: Vector3,
  p2: Vector3,
  p3: Vector3,
  t: number,
): Vector3 {
  const t2 = t * t;
  return new Vector3(
    0.5 *
      (-p0.x +
        p2.x +
        (4 * p0.x - 10 * p1.x + 8 * p2.x - 2 * p3.x) * t +
        (-3 * p0.x + 9 * p1.x - 9 * p2.x + 3 * p3.x) * t2),
    0.5 *
      (-p0.y +
        p2.y +
        (4 * p0.y - 10 * p1.y + 8 * p2.y - 2 * p3.y) * t +
        (-3 * p0.y + 9 * p1.y - 9 * p2.y + 3 * p3.y) * t2),
    0.5 *
      (-p0.z +
        p2.z +
        (4 * p0.z - 10 * p1.z + 8 * p2.z - 2 * p3.z) * t +
        (-3 * p0.z + 9 * p1.z - 9 * p2.z + 3 * p3.z) * t2),
  );
}

function placeGauntlets(
  tunnel: CaveTunnel,
  samples: CaveSample[],
  rng: SeededRandom,
  chunkKey: string,
): Obstacle[] {
  const spacing = GAME_CONFIG.cave.gauntletSpacing;
  const step = GAME_CONFIG.cave.sampleStep;
  const obstacles: Obstacle[] = [];
  let idx = 0;

  for (let i = 0; i < samples.length; i++) {
    const dist = i * step;
    if (dist < spacing * 0.5) continue;
    if (
      i > 0 &&
      Math.floor(dist / spacing) === Math.floor((dist - step) / spacing)
    )
      continue;

    obstacles.push(
      ...createGauntlet(
        tunnel.gauntletType,
        samples[i],
        rng,
        `${chunkKey}:${tunnel.id}:g${idx}`,
        tunnel.depth,
      ),
    );
    idx++;
  }

  return obstacles;
}

function createGauntlet(
  type: GauntletType,
  s: CaveSample,
  rng: SeededRandom,
  prefix: string,
  depth: number,
): Obstacle[] {
  const { position: p, tangent: tan, normal: n, binormal: b, radius: r } = s;
  const danger = depth * 0.15;

  switch (type) {
    case 'left_passage': {
      const pos = p.clone().add(b.clone().multiplyScalar(r * 0.35));
      return [boxObs(`${prefix}:0`, pos, new Vector3(r * 1.2, r * 1.8, r * 0.8), danger)];
    }
    case 'right_passage': {
      const pos = p.clone().add(b.clone().multiplyScalar(-r * 0.35));
      return [boxObs(`${prefix}:0`, pos, new Vector3(r * 1.2, r * 1.8, r * 0.8), danger)];
    }
    case 'center_ring': {
      const obs: Obstacle[] = [];
      for (let c = 0; c < 4; c++) {
        const angle = (c * Math.PI) / 2 + Math.PI / 4;
        const offset = n
          .clone()
          .multiplyScalar(Math.cos(angle) * r * 0.5)
          .add(b.clone().multiplyScalar(Math.sin(angle) * r * 0.5));
        obs.push(
          boxObs(
            `${prefix}:${c}`,
            p.clone().add(offset),
            new Vector3(r * 0.5, r * 0.5, r * 0.6),
            danger,
          ),
        );
      }
      return obs;
    }
    case 'rotating_cylinders': {
      const obs: Obstacle[] = [];
      const count = 1 + (rng.next() < 0.4 + danger ? 1 : 0);
      for (let c = 0; c < count; c++) {
        const pos = p
          .clone()
          .add(tan.clone().multiplyScalar(c * r * 0.8 - r * 0.4));
        const o = boxObs(
          `${prefix}:${c}`,
          pos,
          new Vector3(r * 0.3, r * 2, r * 0.3),
          danger,
        );
        o.motion = 'slow_rotate';
        o.axis = tan.clone().normalize();
        o.angularSpeed =
          rng.range(0.5, 1.5) * (rng.next() < 0.5 ? 1 : -1);
        obs.push(o);
      }
      return obs;
    }
    case 'slalom': {
      const side = rng.next() < 0.5 ? 1 : -1;
      const offset = n
        .clone()
        .multiplyScalar(side * r * 0.4)
        .add(b.clone().multiplyScalar((rng.next() - 0.5) * r * 0.3));
      return [
        boxObs(
          `${prefix}:0`,
          p.clone().add(offset),
          new Vector3(r * 0.8, r * 0.6, r * 0.6),
          danger,
        ),
      ];
    }
    case 'squeeze': {
      return [
        boxObs(
          `${prefix}:t`,
          p.clone().add(n.clone().multiplyScalar(r * 0.35)),
          new Vector3(r * 0.7, r * 0.5, r * 0.6),
          danger,
        ),
        boxObs(
          `${prefix}:b`,
          p.clone().add(n.clone().multiplyScalar(-r * 0.35)),
          new Vector3(r * 0.7, r * 0.5, r * 0.6),
          danger,
        ),
      ];
    }
    case 'cross_bars': {
      return [
        boxObs(
          `${prefix}:h`,
          p.clone(),
          new Vector3(r * 1.6, r * 0.25, r * 0.25),
          danger,
        ),
        boxObs(
          `${prefix}:v`,
          p.clone(),
          new Vector3(r * 0.25, r * 1.6, r * 0.25),
          danger,
        ),
      ];
    }
  }
}

function boxObs(
  id: string,
  position: Vector3,
  size: Vector3,
  danger: number,
): Obstacle {
  const half = size.clone().multiplyScalar(0.5);
  return {
    id,
    type: 'box',
    motion: 'static',
    bounds: { min: position.clone().sub(half), max: position.clone().add(half) },
    position: position.clone(),
    basePosition: position.clone(),
    size,
    damage: GAME_CONFIG.collision.obstacleDamage + Math.floor(danger * 10),
    cellId: id,
    axis: new Vector3(0, 1, 0),
    angularSpeed: 0,
    driftAmplitude: 0,
    phase: 0,
  };
}

function buildTunnelMesh(
  samples: CaveSample[],
  ringSegs: number,
  origin: Vector3,
): StaticChunkMeshData {
  if (samples.length < 2)
    return { positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0) };

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (const s of samples) {
    for (let j = 0; j < ringSegs; j++) {
      const angle = (j / ringSegs) * Math.PI * 2;
      const cx = Math.cos(angle);
      const cy = Math.sin(angle);
      const v = s.position
        .clone()
        .add(s.normal.clone().multiplyScalar(cx * s.radius))
        .add(s.binormal.clone().multiplyScalar(cy * s.radius));
      v.x = Math.max(origin.x, Math.min(v.x, origin.x + GAME_CONFIG.world.chunkSize));
      v.y = Math.max(origin.y, Math.min(v.y, origin.y + GAME_CONFIG.world.chunkSize));
      v.z = Math.max(origin.z, Math.min(v.z, origin.z + GAME_CONFIG.world.chunkSize));
      v.sub(origin);
      positions.push(v.x, v.y, v.z);
      normals.push(
        s.normal.x * cx + s.binormal.x * cy,
        s.normal.y * cx + s.binormal.y * cy,
        s.normal.z * cx + s.binormal.z * cy,
      );
    }
  }

  for (let i = 0; i < samples.length - 1; i++) {
    for (let j = 0; j < ringSegs; j++) {
      const a = i * ringSegs + j;
      const b = i * ringSegs + ((j + 1) % ringSegs);
      const c = (i + 1) * ringSegs + j;
      const d = (i + 1) * ringSegs + ((j + 1) % ringSegs);
      indices.push(a, c, d, a, d, b);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

function buildCaveCells(samples: CaveSample[]): LeafCell[] {
  const cells: LeafCell[] = [];
  const groupSize = 4;

  for (let i = 0; i < samples.length; i += groupSize) {
    const end = Math.min(i + groupSize, samples.length);
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    for (let j = i; j < end; j++) {
      const s = samples[j];
      minX = Math.min(minX, s.position.x - s.radius);
      minY = Math.min(minY, s.position.y - s.radius);
      minZ = Math.min(minZ, s.position.z - s.radius);
      maxX = Math.max(maxX, s.position.x + s.radius);
      maxY = Math.max(maxY, s.position.y + s.radius);
      maxZ = Math.max(maxZ, s.position.z + s.radius);
    }

    cells.push({
      id: `cave:${cells.length}`,
      depth: 0,
      bounds: {
        min: new Vector3(minX, minY, minZ),
        max: new Vector3(maxX, maxY, maxZ),
      },
      kind: 'free',
      caveBias: 1,
    });
  }

  return cells;
}

function placeCaveLoot(
  cells: LeafCell[],
  _portals: Portal[],
  rng: SeededRandom,
): Loot[] {
  const loot: Loot[] = [];
  const max = GAME_CONFIG.world.maxLootPerChunk;

  for (const cell of cells) {
    if (loot.length >= max) break;
    if (cell.kind !== 'free' || rng.next() > 0.22) continue;

    const center = cell.bounds.min
      .clone()
      .add(cell.bounds.max)
      .multiplyScalar(0.5);
    const type = rng.next() < 0.12 ? 'chest' : 'coin';
    loot.push({
      id: `${cell.id}:loot:${loot.length}`,
      type,
      position: center,
      radius:
        type === 'coin'
          ? GAME_CONFIG.collision.coinRadius
          : GAME_CONFIG.collision.chestRadius,
      value: type === 'coin' ? 1 : 10,
      collected: false,
      cellId: cell.id,
    });
  }

  return loot;
}

function placeCaveMines(
  cells: LeafCell[],
  _portals: Portal[],
  rng: SeededRandom,
  chunkKeyStr: string,
): Mine[] {
  const mines: Mine[] = [];
  for (const cell of cells) {
    if (mines.length >= GAME_CONFIG.mines.maxPerChunk) break;
    if (cell.kind === 'obstacle') continue;
    if (rng.next() > 0.12) continue;

    const center = cell.bounds.min
      .clone()
      .add(cell.bounds.max)
      .multiplyScalar(0.5);
    mines.push({
      id: `${cell.id}:mine:${mines.length}`,
      originChunkKey: chunkKeyStr,
      anchorCellId: cell.id,
      position: center,
      velocity: new Vector3(),
      radius: GAME_CONFIG.mines.radius,
      triggerRadius: GAME_CONFIG.mines.triggerRadius,
      speed: GAME_CONFIG.mines.launchSpeed,
      damage: GAME_CONFIG.mines.damage,
      state: 'idle',
      armed: true,
      targetPosition: null,
      telegraphTimer: 0,
    });
  }
  return mines;
}

function emptyCaveResult(): {
  cells: LeafCell[];
  obstacles: Obstacle[];
  adjacency: [string, string][];
  staticMeshData: StaticChunkMeshData;
  loot: Loot[];
  mines: Mine[];
} {
  return {
    cells: [],
    obstacles: [],
    adjacency: [],
    staticMeshData: {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      indices: new Uint32Array(0),
    },
    loot: [],
    mines: [],
  };
}
