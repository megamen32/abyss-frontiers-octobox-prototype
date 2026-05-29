import type { BoidsConfig, BoidState } from './BoidsTypes'
import { GAME_CONFIG } from '../game/config'

export interface BoidsGPUResources {
  device: GPUDevice
  boidBufferA: GPUBuffer
  boidBufferB: GPUBuffer
  cellCountsBuffer: GPUBuffer
  cellBoidIndicesBuffer: GPUBuffer
  overflowCounterBuffer: GPUBuffer
  readbackBuffer: GPUBuffer
  cellMetadataBuffer: GPUBuffer
  cellNeighborRangesBuffer: GPUBuffer
  cellNeighborIdsBuffer: GPUBuffer
  uniformBuffer: GPUBuffer
  clearPipeline: GPUComputePipeline
  assignPipeline: GPUComputePipeline
  simulatePipeline: GPUComputePipeline
  bindGroupLayout: GPUBindGroupLayout
  bindGroupA: GPUBindGroup
  bindGroupB: GPUBindGroup
  readbackStaging: GPUBuffer
  overflowStaging: GPUBuffer
  readbackPending: boolean
  overflowPending: boolean
}

const BOID_STRUCT_SIZE = 64
const UNIFORM_SIZE = 256

export async function initGPUResources(config: BoidsConfig): Promise<BoidsGPUResources | null> {
  if (!navigator.gpu) return null

  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return null

  const device = await adapter.requestDevice({
    requiredLimits: {
      maxComputeWorkgroupsPerDimension: 65535,
    },
  })

  const maxBoids = config.maxBoids
  const maxCells = 16384
  const maxBoidsPerCell = config.maxBoidsPerCell
  const maxTotalNeighbors = maxCells * 16

  const boidBufferSize = maxBoids * BOID_STRUCT_SIZE
  const cellCountsSize = maxCells * 4
  const cellBoidIndicesSize = maxCells * maxBoidsPerCell * 4
  const overflowSize = 4
  const cellMetadataSize = maxCells * 64
  const cellNeighborRangesSize = maxCells * 16
  const cellNeighborIdsSize = maxTotalNeighbors * 4

  const usage: GPUBufferUsageFlags = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC

  const boidBufferA = device.createBuffer({ size: boidBufferSize, usage })
  const boidBufferB = device.createBuffer({ size: boidBufferSize, usage })
  const cellCountsBuffer = device.createBuffer({ size: cellCountsSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
  const cellBoidIndicesBuffer = device.createBuffer({ size: cellBoidIndicesSize, usage })
  const overflowCounterBuffer = device.createBuffer({ size: overflowSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC })

  const readbackSize = Math.min(maxBoids, 50000) * BOID_STRUCT_SIZE
  const readbackBuffer = device.createBuffer({
    size: readbackSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })

  const cellMetadataBuffer = device.createBuffer({
    size: cellMetadataSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const cellNeighborRangesBuffer = device.createBuffer({
    size: cellNeighborRangesSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const cellNeighborIdsBuffer = device.createBuffer({
    size: cellNeighborIdsSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

  const uniformBuffer = device.createBuffer({
    size: UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const overflowStaging = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })

  const shaderModule = device.createShaderModule({ code: BOIDS_COMPUTE_WGSL })

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  })

  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] })

  const clearModule = device.createShaderModule({ code: BOIDS_CLEAR_WGSL })
  const clearPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ],
      })],
    }),
    compute: { module: clearModule, entryPoint: 'main' },
  })

  const assignPipeline = device.createComputePipeline({
    layout: pipelineLayout,
    compute: { module: shaderModule, entryPoint: 'assignCells' },
  })

  const simulatePipeline = device.createComputePipeline({
    layout: pipelineLayout,
    compute: { module: shaderModule, entryPoint: 'simulate' },
  })

  const makeBindGroup = (readBuffer: GPUBuffer, writeBuffer: GPUBuffer): GPUBindGroup =>
    device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: readBuffer } },
        { binding: 1, resource: { buffer: writeBuffer } },
        { binding: 2, resource: { buffer: cellCountsBuffer } },
        { binding: 3, resource: { buffer: cellBoidIndicesBuffer } },
        { binding: 4, resource: { buffer: overflowCounterBuffer } },
        { binding: 5, resource: { buffer: cellMetadataBuffer } },
        { binding: 6, resource: { buffer: cellNeighborRangesBuffer } },
        { binding: 7, resource: { buffer: cellNeighborIdsBuffer } },
        { binding: 8, resource: { buffer: uniformBuffer } },
      ],
    })

  const bindGroupA = makeBindGroup(boidBufferA, boidBufferB)
  const bindGroupB = makeBindGroup(boidBufferB, boidBufferA)

  return {
    device,
    boidBufferA,
    boidBufferB,
    cellCountsBuffer,
    cellBoidIndicesBuffer,
    overflowCounterBuffer,
    readbackBuffer,
    cellMetadataBuffer,
    cellNeighborRangesBuffer,
    cellNeighborIdsBuffer,
    uniformBuffer,
    clearPipeline,
    assignPipeline,
    simulatePipeline,
    bindGroupLayout,
    bindGroupA,
    bindGroupB,
    readbackStaging: readbackBuffer,
    overflowStaging,
    readbackPending: false,
    overflowPending: false,
  }
}

const BOIDS_CLEAR_WGSL = `
@group(0) @binding(0) var<storage, read_write> cellCounts: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> overflow: array<atomic<u32>>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < arrayLength(&cellCounts)) {
    atomicStore(&cellCounts[id.x], 0u);
  }
  if (id.x == 0u) {
    atomicStore(&overflow[0], 0u);
  }
}
`

const BOIDS_COMPUTE_WGSL = `
struct Boid {
  position: vec4<f32>,
  velocity: vec4<f32>,
  state: vec4<f32>,
  extra: vec4<f32>,
};

struct WorldCell {
  boundsMin: vec4<f32>,
  boundsMax: vec4<f32>,
  flow: vec4<f32>,
  data: vec4<f32>,
};

struct CellNeighborRange {
  start: u32,
  count: u32,
  pad0: u32,
  pad1: u32,
};

struct Uniforms {
  dt: f32,
  maxBoids: u32,
  activeBoids: u32,
  pad0: u32,
  gridCellSize: f32,
  perceptionRadius: f32,
  separationRadius: f32,
  maxBoidsPerCell: u32,
  minSpeed: f32,
  maxSpeed: f32,
  maxForce: f32,
  turnRate: f32,
  separationWeight: f32,
  alignmentWeight: f32,
  cohesionWeight: f32,
  wallAvoidanceWeight: f32,
  flowWeight: f32,
  playerAvoidanceWeight: f32,
  avoidPlayerRadius: f32,
  playerPosX: f32,
  playerPosY: f32,
  playerPosZ: f32,
  time: f32,
  playerVelX: f32,
  playerVelY: f32,
  playerVelZ: f32,
  playerFwdX: f32,
  playerFwdY: f32,
  playerFwdZ: f32,
  followMinSeconds: f32,
  followMaxSeconds: f32,
  followPeriod: f32,
  followSpread: f32,
  followWeight: f32,
  cellMetadataCount: u32,
  mineTelegraphDuration: f32,
  mineTargetingMaxSpeed: f32,
  mineTargetingAccel: f32,
  mineRocketAccel: f32,
  mineRocketMaxSpeed: f32,
  mineLaunchSpeed: f32,
  pad1: u32,
};

@group(0) @binding(0) var<storage, read> boidsIn: array<Boid>;
@group(0) @binding(1) var<storage, read_write> boidsOut: array<Boid>;
@group(0) @binding(2) var<storage, read_write> cellCounts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> cellBoidIndices: array<u32>;
@group(0) @binding(4) var<storage, read_write> overflow: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read> cellMetadata: array<WorldCell>;
@group(0) @binding(6) var<storage, read> cellNeighborRanges: array<CellNeighborRange>;
@group(0) @binding(7) var<storage, read> cellNeighborIds: array<u32>;
@group(0) @binding(8) var<uniform> uniforms: Uniforms;

fn hash11(p: f32) -> f32 {
  var h = fract(p * 0.1031);
  h *= h + 33.33;
  h *= h + h;
  return fract(h);
}

fn followTargetForce(pos: vec3<f32>, seed: f32, age: f32) -> vec3<f32> {
  if (uniforms.followWeight <= 0.0 || uniforms.followPeriod <= 0.001) {
    return vec3<f32>(0.0, 0.0, 0.0);
  }
  let phase = (seed * 0.01 + age / uniforms.followPeriod) * 6.28318530718;
  let t = (sin(phase) + 1.0) * 0.5;
  let aheadSeconds = uniforms.followMinSeconds + t * (uniforms.followMaxSeconds - uniforms.followMinSeconds);
  let playerSpeed = length(vec3<f32>(uniforms.playerVelX, uniforms.playerVelY, uniforms.playerVelZ));
  let aheadDist = aheadSeconds * max(playerSpeed, uniforms.minSpeed);
  let lateralAngle = seed * 6.28318530718;
  let targetPos = vec3<f32>(uniforms.playerPosX, uniforms.playerPosY, uniforms.playerPosZ)
    + normalize(vec3<f32>(uniforms.playerFwdX, uniforms.playerFwdY, uniforms.playerFwdZ) + vec3<f32>(0.0, 0.0, 0.001)) * aheadDist
    + vec3<f32>(cos(lateralAngle) * uniforms.followSpread, sin(seed * 2.718) * uniforms.followSpread * 0.5, sin(lateralAngle) * uniforms.followSpread);
  let delta = targetPos - pos;
  let dist = length(delta);
  if (dist <= 0.001) {
    return vec3<f32>(0.0, 0.0, 0.0);
  }
  let pull = min(dist / 8.0, 2.0);
  return delta / dist * pull;
}

fn mineTargetForce(pos: vec3<f32>, vel: vec3<f32>, behavior: i32, stateTimer: f32) -> vec3<f32> {
  if (behavior <= 1) {
    let t = uniforms.time * 0.7 + vel.x * 0.03 + pos.x * 0.01;
    return vec3<f32>(sin(t) * 2.3, cos(t * 0.71) * 1.2, sin(t * 1.13) * 2.3);
  }
  let toPlayer = vec3<f32>(uniforms.playerPosX, uniforms.playerPosY, uniforms.playerPosZ) - pos;
  let distance = length(toPlayer);
  if (distance <= 0.001) {
    return vec3<f32>(0.0, 0.0, 0.0);
  }
  let dir = toPlayer / distance;
  let relativeVelocity = vec3<f32>(uniforms.playerVelX, uniforms.playerVelY, uniforms.playerVelZ) - vel;
  let closingSpeed = max(dot(relativeVelocity, dir), 0.001);
  let leadTime = clamp(distance / closingSpeed, 0.15, 2.5);
  let targetPos = vec3<f32>(uniforms.playerPosX, uniforms.playerPosY, uniforms.playerPosZ)
    + vec3<f32>(uniforms.playerVelX, uniforms.playerVelY, uniforms.playerVelZ) * leadTime;
  let targetDelta = targetPos - pos;
  let targetDist = length(targetDelta);
  if (targetDist <= 0.001) {
    return vec3<f32>(0.0, 0.0, 0.0);
  }
  let targetDir = targetDelta / targetDist;
  if (behavior == 2) {
    let elapsed = uniforms.mineTelegraphDuration - max(0.0, stateTimer);
    let progress = clamp(select(1.0, elapsed / uniforms.mineTelegraphDuration, uniforms.mineTelegraphDuration > 0.0), 0.0, 1.0);
    let ease = progress * progress * (3.0 - 2.0 * progress);
    let desiredVel = targetDir * (uniforms.mineTargetingMaxSpeed * ease);
    var steer = desiredVel - vel;
    let steerLen = length(steer);
    if (steerLen > uniforms.mineTargetingAccel) {
      steer *= uniforms.mineTargetingAccel / steerLen;
    }
    return steer;
  }
  if (behavior == 3) {
    return targetDir * (uniforms.mineRocketAccel * 18.0);
  }
  let desiredVel = targetDir * uniforms.mineLaunchSpeed;
  return (desiredVel - vel) * 1.8;
}

fn findCellId(pos: vec3<f32>) -> i32 {
  for (var i = 0u; i < uniforms.cellMetadataCount; i = i + 1u) {
    let cell = cellMetadata[i];
    let mn = cell.boundsMin.xyz;
    let mx = cell.boundsMax.xyz;
    if (pos.x >= mn.x && pos.x <= mx.x &&
        pos.y >= mn.y && pos.y <= mx.y &&
        pos.z >= mn.z && pos.z <= mx.z) {
      return i32(cell.data.x);
    }
  }
  return -1;
}

fn isCellConnected(a: i32, b: i32) -> bool {
  if (a < 0 || b < 0) { return false; }
  if (a == b) { return true; }
  let ua = u32(a);
  if (u32(a) >= arrayLength(&cellNeighborRanges)) { return false; }
  let range = cellNeighborRanges[ua];
  for (var i = 0u; i < range.count; i = i + 1u) {
    if (cellNeighborIds[range.start + i] == u32(b)) {
      return true;
    }
  }
  return false;
}

@compute @workgroup_size(256)
fn assignCells(@builtin(global_invocation_id) id: vec3<u32>) {
  let boidIdx = id.x;
  if (boidIdx >= uniforms.activeBoids) { return; }

  let boid = boidsIn[boidIdx];
  let flags = i32(boid.state.z);
  if (flags == 4) { return; }

  let pos = boid.position.xyz;
  let cellId = findCellId(pos);

  if (cellId < 0) { return; }
  let ucellId = u32(cellId);

  if (ucellId >= arrayLength(&cellCounts)) { return; }

  let slot = atomicAdd(&cellCounts[ucellId], 1u);
  if (slot < uniforms.maxBoidsPerCell) {
    cellBoidIndices[ucellId * uniforms.maxBoidsPerCell + slot] = boidIdx;
  } else {
    atomicAdd(&overflow[0], 1u);
  }
}

@compute @workgroup_size(256)
fn simulate(@builtin(global_invocation_id) id: vec3<u32>) {
  let boidIdx = id.x;
  if (boidIdx >= uniforms.activeBoids) { return; }

  var boid = boidsIn[boidIdx];
  let flags = i32(boid.state.z);
  if (flags == 4 || flags == 3 || flags == 5) {
    boidsOut[boidIdx] = boid;
    return;
  }

  var life = boid.state.x;
  var age = boid.state.y;
  age = age + uniforms.dt;

  if (flags == 1) {
    life = life + uniforms.dt * 2.0;
    if (life >= 1.0) { life = 1.0; }
  }
  if (flags == 2) {
    life = life - uniforms.dt * 2.0;
    if (life <= 0.0) {
      boid.state.z = 4.0;
      boidsOut[boidIdx] = boid;
      return;
    }
  }

  let pos = boid.position.xyz;
  let vel = boid.velocity.xyz;
  let seed = boid.velocity.w;
  let typeId = i32(boid.extra.x);
  let behavior = i32(boid.extra.y);
  let stateTimer = boid.extra.z;
  let cellId = findCellId(pos);

  var separation = vec3<f32>(0.0, 0.0, 0.0);
  var alignment = vec3<f32>(0.0, 0.0, 0.0);
  var cohesion = vec3<f32>(0.0, 0.0, 0.0);
  var neighborCount = 0u;

  let ucellId = u32(max(cellId, 0));
  let hasValidCell = cellId >= 0 && ucellId < arrayLength(&cellCounts);

  if (hasValidCell) {
    let count = atomicLoad(&cellCounts[ucellId]);
    let maxPerCell = uniforms.maxBoidsPerCell;
    for (var i = 0u; i < count && i < maxPerCell; i = i + 1u) {
      let otherIdx = cellBoidIndices[ucellId * maxPerCell + i];
      if (otherIdx == boidIdx) { continue; }
      let other = boidsIn[otherIdx];
      let otherFlags = i32(other.state.z);
      if (otherFlags == 4 || otherFlags == 3) { continue; }

      let diff = pos - other.position.xyz;
      let dist = length(diff);
      if (dist > uniforms.perceptionRadius || dist < 0.001) { continue; }

      let otherCellId = i32(other.state.w);
      if (!isCellConnected(cellId, otherCellId)) { continue; }

      if (dist < uniforms.separationRadius) {
        separation = separation + diff / (dist * dist);
      }
      alignment = alignment + other.velocity.xyz;
      cohesion = cohesion + other.position.xyz;
      neighborCount = neighborCount + 1u;
    }

    if (cellId >= 0 && u32(cellId) < arrayLength(&cellNeighborRanges)) {
      let range = cellNeighborRanges[ucellId];
      for (var ni = 0u; ni < range.count; ni = ni + 1u) {
        let neighborCellId = cellNeighborIds[range.start + ni];
        if (neighborCellId >= arrayLength(&cellCounts)) { continue; }
        let nCount = atomicLoad(&cellCounts[neighborCellId]);
        for (var i = 0u; i < nCount && i < maxPerCell; i = i + 1u) {
          let otherIdx = cellBoidIndices[neighborCellId * maxPerCell + i];
          if (otherIdx == boidIdx) { continue; }
          let other = boidsIn[otherIdx];
          let otherFlags = i32(other.state.z);
          if (otherFlags == 4 || otherFlags == 3) { continue; }

          let diff = pos - other.position.xyz;
          let dist = length(diff);
          if (dist > uniforms.perceptionRadius || dist < 0.001) { continue; }

          if (dist < uniforms.separationRadius) {
            separation = separation + diff / (dist * dist);
          }
          alignment = alignment + other.velocity.xyz;
          cohesion = cohesion + other.position.xyz;
          neighborCount = neighborCount + 1u;
        }
      }
    }
  }

  if (neighborCount > 0u) {
    let invN = 1.0 / f32(neighborCount);
    alignment = normalize(alignment * invN);
    cohesion = normalize(cohesion * invN - pos);
  }

  var wallForce = vec3<f32>(0.0, 0.0, 0.0);
  if (cellId >= 0 && u32(cellId) < uniforms.cellMetadataCount) {
    let cell = cellMetadata[ucellId];
    let mn = cell.boundsMin.xyz;
    let mx = cell.boundsMax.xyz;
    let margin = 3.0;
    let lookAhead = 4.0;
    let predicted = pos + vel * lookAhead * uniforms.dt;

    if (predicted.x < mn.x + margin) { wallForce.x = wallForce.x + (mn.x + margin - predicted.x) * 0.5; }
    if (predicted.x > mx.x - margin) { wallForce.x = wallForce.x + (mx.x - margin - predicted.x) * 0.5; }
    if (predicted.y < mn.y + margin) { wallForce.y = wallForce.y + (mn.y + margin - predicted.y) * 0.5; }
    if (predicted.y > mx.y - margin) { wallForce.y = wallForce.y + (mx.y - margin - predicted.y) * 0.5; }
    if (predicted.z < mn.z + margin) { wallForce.z = wallForce.z + (mn.z + margin - predicted.z) * 0.5; }
    if (predicted.z > mx.z - margin) { wallForce.z = wallForce.z + (mx.z - margin - predicted.z) * 0.5; }
  }

  var flowForce = vec3<f32>(0.0, 0.0, 0.0);
  if (cellId >= 0 && u32(cellId) < uniforms.cellMetadataCount) {
    flowForce = cellMetadata[ucellId].flow.xyz;
  }

  var playerForce = vec3<f32>(0.0, 0.0, 0.0);
  let toPlayer = pos - vec3<f32>(uniforms.playerPosX, uniforms.playerPosY, uniforms.playerPosZ);
  let playerDist = length(toPlayer);
  if (playerDist < uniforms.avoidPlayerRadius && playerDist > 0.001) {
    let strength = 1.0 - playerDist / uniforms.avoidPlayerRadius;
    playerForce = toPlayer / playerDist * strength;
  }

  let followForce = followTargetForce(pos, seed, age);
  let mineForce = select(vec3<f32>(0.0, 0.0, 0.0), mineTargetForce(pos, vel, behavior, stateTimer), typeId == 4);

  var force = separation * uniforms.separationWeight
    + alignment * uniforms.alignmentWeight
    + cohesion * uniforms.cohesionWeight
    + wallForce * uniforms.wallAvoidanceWeight
    + flowForce * uniforms.flowWeight
    + playerForce * uniforms.playerAvoidanceWeight
    + followForce * uniforms.followWeight
    + mineForce;

  let forceLen = length(force);
  if (forceLen > uniforms.maxForce) {
    force = force * (uniforms.maxForce / forceLen);
  }

  var newVel = vel + force * uniforms.dt;
  var speed = length(newVel);

  if (speed > 0.001) {
    let prevSpeed = length(vel);
    if (prevSpeed > 0.001) {
      let dot = dot(newVel, vel) / (speed * prevSpeed);
      let angle = acos(clamp(dot, -1.0, 1.0));
      let maxAngle = uniforms.turnRate * uniforms.dt;
      if (angle > maxAngle) {
        let t = maxAngle / angle;
        newVel = vel + (newVel - vel) * t;
        speed = length(newVel);
      }
    }
  }

  speed = length(newVel);
  if (typeId == 4 && behavior == 3 && speed > uniforms.mineRocketMaxSpeed) {
    newVel = newVel * (uniforms.mineRocketMaxSpeed / speed);
    speed = uniforms.mineRocketMaxSpeed;
  }
  if (speed > uniforms.maxSpeed) {
    newVel = newVel * (uniforms.maxSpeed / speed);
  } else if (speed < uniforms.minSpeed && speed > 0.001) {
    newVel = newVel * (uniforms.minSpeed / speed);
  }

  var newPos = pos + newVel * uniforms.dt;

  if (uniforms.followWeight <= 0.0 && cellId >= 0 && u32(cellId) < uniforms.cellMetadataCount) {
    let cell = cellMetadata[ucellId];
    let mn = cell.boundsMin.xyz + vec3<f32>(1.0, 1.0, 1.0);
    let mx = cell.boundsMax.xyz - vec3<f32>(1.0, 1.0, 1.0);
    newPos = clamp(newPos, mn, mx);
  }

  boidsOut[boidIdx].position = vec4<f32>(newPos, boid.position.w);
  boidsOut[boidIdx].velocity = vec4<f32>(newVel, seed);
  boidsOut[boidIdx].state.x = life;
  boidsOut[boidIdx].state.y = age;
  boidsOut[boidIdx].state.z = boid.state.z;
  if (flags == 1 && life >= 1.0) {
    boidsOut[boidIdx].state.z = 0.0;
  }
  boidsOut[boidIdx].state.w = f32(max(cellId, 0));
  boidsOut[boidIdx].extra = boid.extra;
}
`

export function uploadUniforms(
  res: BoidsGPUResources,
  dt: number,
  activeBoids: number,
  config: BoidsConfig,
  playerX: number,
  playerY: number,
  playerZ: number,
  playerVelX: number,
  playerVelY: number,
  playerVelZ: number,
  playerFwdX: number,
  playerFwdY: number,
  playerFwdZ: number,
  time: number,
  cellMetadataCount: number,
): void {
  const data = new Float32Array(64)
  const follow = config.boidTypes[0]?.followTarget
  data[0] = dt
  data[1] = config.maxBoids
  data[2] = activeBoids
  data[4] = config.gridCellSize
  data[5] = config.perceptionRadius
  data[6] = config.separationRadius
  data[7] = config.maxBoidsPerCell
  data[8] = config.minSpeed
  data[9] = config.maxSpeed
  data[10] = config.maxForce
  data[11] = config.turnRate
  data[12] = config.separationWeight
  data[13] = config.alignmentWeight
  data[14] = config.cohesionWeight
  data[15] = config.wallAvoidanceWeight
  data[16] = config.flowWeight
  data[17] = config.playerAvoidanceWeight
  data[18] = config.avoidPlayerRadius
  data[19] = playerX
  data[20] = playerY
  data[21] = playerZ
  data[22] = time
  data[23] = playerVelX
  data[24] = playerVelY
  data[25] = playerVelZ
  data[26] = playerFwdX
  data[27] = playerFwdY
  data[28] = playerFwdZ
  data[29] = follow?.minSeconds ?? 0
  data[30] = follow?.maxSeconds ?? 0
  data[31] = follow?.period ?? 0
  data[32] = follow?.spread ?? 0
  data[33] = follow?.weight ?? 0
  data[34] = cellMetadataCount
  data[35] = GAME_CONFIG.mines.telegraphDuration
  data[36] = 9
  data[37] = 18
  data[38] = GAME_CONFIG.mines.rocketAcceleration
  data[39] = GAME_CONFIG.mines.rocketMaxSpeed
  data[40] = GAME_CONFIG.mines.launchSpeed
  res.device.queue.writeBuffer(res.uniformBuffer, 0, data)
}

export function uploadBoids(res: BoidsGPUResources, boids: BoidState[], buffer: 'A' | 'B'): void {
  const target = buffer === 'A' ? res.boidBufferA : res.boidBufferB
  const data = new Float32Array(boids.length * 16)
  for (let i = 0; i < boids.length; i++) {
    const b = boids[i]
    const o = i * 16
    data[o] = b.position[0]
    data[o + 1] = b.position[1]
    data[o + 2] = b.position[2]
    data[o + 3] = 0
    data[o + 4] = b.velocity[0]
    data[o + 5] = b.velocity[1]
    data[o + 6] = b.velocity[2]
    data[o + 7] = b.seed
    data[o + 8] = b.life
    data[o + 9] = b.age
    data[o + 10] = b.flags
    data[o + 11] = b.cellId
    data[o + 12] = b.typeId
    data[o + 13] = b.behavior
    data[o + 14] = b.stateTimer
    data[o + 15] = 0
  }
  res.device.queue.writeBuffer(target, 0, data)
}

export function uploadBoidSubset(
  res: BoidsGPUResources,
  boids: Array<{ slot: number; boid: BoidState }>,
  buffer: 'A' | 'B' | 'both',
): void {
  for (let i = 0; i < boids.length; i++) {
    const { slot, boid } = boids[i]
    const data = new Float32Array(16)
    data[0] = boid.position[0]
    data[1] = boid.position[1]
    data[2] = boid.position[2]
    data[3] = 0
    data[4] = boid.velocity[0]
    data[5] = boid.velocity[1]
    data[6] = boid.velocity[2]
    data[7] = boid.seed
    data[8] = boid.life
    data[9] = boid.age
    data[10] = boid.flags
    data[11] = boid.cellId
    data[12] = boid.typeId
    data[13] = boid.behavior
    data[14] = boid.stateTimer
    data[15] = 0
    const offset = slot * BOID_STRUCT_SIZE
    if (buffer === 'A' || buffer === 'both') {
      res.device.queue.writeBuffer(res.boidBufferA, offset, data)
    }
    if (buffer === 'B' || buffer === 'both') {
      res.device.queue.writeBuffer(res.boidBufferB, offset, data)
    }
  }
}

export function uploadCellMetadata(
  res: BoidsGPUResources,
  cells: { boundsMin: Float32Array; boundsMax: Float32Array; flow: Float32Array; data: Float32Array }[],
): void {
  const data = new Float32Array(cells.length * 16)
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    const o = i * 16
    data.set(c.boundsMin, o)
    data.set(c.boundsMax, o + 4)
    data.set(c.flow, o + 8)
    data.set(c.data, o + 12)
  }
  res.device.queue.writeBuffer(res.cellMetadataBuffer, 0, data)
}

export function uploadNeighborData(
  res: BoidsGPUResources,
  ranges: { start: number; count: number }[],
  ids: number[],
): void {
  const rangeData = new Uint32Array(ranges.length * 4)
  for (let i = 0; i < ranges.length; i++) {
    rangeData[i * 4] = ranges[i].start
    rangeData[i * 4 + 1] = ranges[i].count
  }
  res.device.queue.writeBuffer(res.cellNeighborRangesBuffer, 0, rangeData)
  res.device.queue.writeBuffer(res.cellNeighborIdsBuffer, 0, new Uint32Array(ids))
}

export function runComputePass(
  res: BoidsGPUResources,
  activeBoids: number,
  pingPong: boolean,
): void {
  const commandEncoder = res.device.createCommandEncoder()

  const clearBindGroup = res.device.createBindGroup({
    layout: res.clearPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: res.cellCountsBuffer } },
      { binding: 1, resource: { buffer: res.overflowCounterBuffer } },
    ],
  })

  const cellCountEstimate = 16384
  const clearPass = commandEncoder.beginComputePass()
  clearPass.setPipeline(res.clearPipeline)
  clearPass.setBindGroup(0, clearBindGroup)
  clearPass.dispatchWorkgroups(Math.ceil(cellCountEstimate / 256))
  clearPass.end()

  const bindGroup = pingPong ? res.bindGroupB : res.bindGroupA
  const workgroups = Math.ceil(activeBoids / 256)

  const assignPass = commandEncoder.beginComputePass()
  assignPass.setPipeline(res.assignPipeline)
  assignPass.setBindGroup(0, bindGroup)
  assignPass.dispatchWorkgroups(workgroups)
  assignPass.end()

  const simPass = commandEncoder.beginComputePass()
  simPass.setPipeline(res.simulatePipeline)
  simPass.setBindGroup(0, bindGroup)
  simPass.dispatchWorkgroups(workgroups)
  simPass.end()

  const readSrc = pingPong ? res.boidBufferB : res.boidBufferA
  const readSize = Math.min(activeBoids, 50000) * BOID_STRUCT_SIZE
  if (readSize > 0 && !res.readbackPending) {
    commandEncoder.copyBufferToBuffer(readSrc, 0, res.readbackStaging, 0, readSize)
  }

  if (!res.overflowPending) {
    commandEncoder.copyBufferToBuffer(res.overflowCounterBuffer, 0, res.overflowStaging, 0, 4)
  }

  res.device.queue.submit([commandEncoder.finish()])
}

export async function readbackPositions(
  res: BoidsGPUResources,
  count: number,
): Promise<Float32Array | null> {
  if (count === 0) return null
  if (res.readbackPending) return null
  const size = Math.min(count, 50000) * BOID_STRUCT_SIZE
  try {
    res.readbackPending = true
    await res.readbackStaging.mapAsync(GPUMapMode.READ, 0, size)
    const data = new Float32Array(res.readbackStaging.getMappedRange(0, size).slice(0))
    res.readbackStaging.unmap()
    res.readbackPending = false
    return data
  } catch {
    res.readbackPending = false
    return null
  }
}

export async function readbackOverflow(res: BoidsGPUResources): Promise<number> {
  if (res.overflowPending) return 0
  try {
    res.overflowPending = true
    await res.overflowStaging.mapAsync(GPUMapMode.READ, 0, 4)
    const data = new Uint32Array(res.overflowStaging.getMappedRange(0, 4))
    const val = data[0]
    res.overflowStaging.unmap()
    res.overflowPending = false
    return val
  } catch {
    res.overflowPending = false
    return 0
  }
}

export function disposeGPUResources(res: BoidsGPUResources): void {
  res.boidBufferA.destroy()
  res.boidBufferB.destroy()
  res.cellCountsBuffer.destroy()
  res.cellBoidIndicesBuffer.destroy()
  res.overflowCounterBuffer.destroy()
  res.readbackBuffer.destroy()
  res.cellMetadataBuffer.destroy()
  res.cellNeighborRangesBuffer.destroy()
  res.cellNeighborIdsBuffer.destroy()
  res.uniformBuffer.destroy()
  res.readbackStaging.destroy()
  res.overflowStaging.destroy()
  res.device.destroy()
}
