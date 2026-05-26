import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
  type Object3D,
} from 'three'

export interface FishSchoolConfig {
  count: number
  aheadSeconds: number
  spreadRadius: number
  swimSpeed: number
  boidsSepRadius: number
  boidsSepWeight: number
  boidsCohWeight: number
  boidsAliWeight: number
  returnWeight: number
  maxSpeed: number
  minSpeed: number
  drag: number
  scaleMin: number
  scaleMax: number
  color: number
  emissive: number
}

export const DEFAULT_FISH_SCHOOL_CONFIG: FishSchoolConfig = {
  count: 32,
  aheadSeconds: 4,
  spreadRadius: 8,
  swimSpeed: 6,
  boidsSepRadius: 2.5,
  boidsSepWeight: 2.2,
  boidsCohWeight: 0.4,
  boidsAliWeight: 0.6,
  returnWeight: 1.2,
  maxSpeed: 14,
  minSpeed: 2,
  drag: 0.85,
  scaleMin: 0.18,
  scaleMax: 0.38,
  color: 0x55ddff,
  emissive: 0.35,
}

interface FishAgent {
  pos: Vector3
  vel: Vector3
  seed: number
  scale: number
}

const _fwd = new Vector3()
const _sep = new Vector3()
const _ali = new Vector3()
const _coh = new Vector3()
const _ret = new Vector3()
const _force = new Vector3()
const _target = new Vector3()

export class FishSchool {
  private agents: FishAgent[]
  private config: FishSchoolConfig
  private readonly mesh: Mesh
  private readonly material: ShaderMaterial
  private readonly maxCount: number
  private readonly instancePositions: Float32Array
  private readonly instanceData: Float32Array

  constructor(config: FishSchoolConfig = DEFAULT_FISH_SCHOOL_CONFIG) {
    this.config = config
    this.maxCount = config.count
    this.agents = []

    this.instancePositions = new Float32Array(this.maxCount * 3)
    this.instanceData = new Float32Array(this.maxCount * 4)

    const geo = this.buildGeometry()
    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Color(config.color) },
        uEmissive: { value: config.emissive },
        fogColor: { value: new Color(0x02070c) },
        fogNear: { value: 0 },
        fogFar: { value: 200 },
      },
      vertexShader: FISH_VERTEX,
      fragmentShader: FISH_FRAGMENT,
      transparent: true,
      depthWrite: false,
    })

    this.mesh = new Mesh(geo, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
  }

  get object3d(): Object3D {
    return this.mesh
  }

  setFog(color: { r: number; g: number; b: number }, near: number, far: number): void {
    const u = this.material.uniforms
    u.fogColor.value.setRGB(color.r, color.g, color.b)
    u.fogNear.value = near
    u.fogFar.value = far
  }

  update(
    dt: number,
    playerPosition: Vector3,
    playerVelocity: Vector3,
    playerForward: Vector3,
    time: number,
  ): void {
    const cfg = this.config

    _target.copy(playerPosition)
      .addScaledVector(playerForward, cfg.aheadSeconds * Math.max(playerVelocity.length(), 3))

    if (this.agents.length < cfg.count) {
      this.spawnMissing(playerPosition, playerForward, playerVelocity)
    }

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i]

      _sep.set(0, 0, 0)
      _ali.set(0, 0, 0)
      _coh.set(0, 0, 0)
      let count = 0

      for (let j = 0; j < this.agents.length; j++) {
        if (i === j) continue
        const b = this.agents[j]
        const dx = a.pos.x - b.pos.x
        const dy = a.pos.y - b.pos.y
        const dz = a.pos.z - b.pos.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

        if (dist < cfg.boidsSepRadius && dist > 0.001) {
          const s = (1 - dist / cfg.boidsSepRadius) / dist
          _sep.x += dx * s
          _sep.y += dy * s
          _sep.z += dz * s
        }

        if (dist < cfg.spreadRadius * 2.5) {
          _ali.add(b.vel)
          _coh.add(b.pos)
          count++
        }
      }

      if (count > 0) {
        _ali.divideScalar(count)
        const alen = _ali.length()
        if (alen > 0.001) _ali.divideScalar(alen)

        _coh.divideScalar(count)
        _coh.sub(a.pos)
        const clen = _coh.length()
        if (clen > 0.001) _coh.divideScalar(clen)
      }

      _ret.copy(_target).sub(a.pos)
      const retDist = _ret.length()
      const pull = Math.min(retDist / cfg.spreadRadius, 1.0)
      if (retDist > 0.001) _ret.multiplyScalar(pull / retDist)

      _force.set(0, 0, 0)
      _force.addScaledVector(_sep, cfg.boidsSepWeight)
      _force.addScaledVector(_ali, cfg.boidsAliWeight)
      _force.addScaledVector(_coh, cfg.boidsCohWeight)
      _force.addScaledVector(_ret, cfg.returnWeight)

      const wander = a.seed + time * 1.7
      _force.x += Math.sin(wander) * 0.4
      _force.y += Math.cos(wander * 1.3) * 0.25
      _force.z += Math.sin(wander * 0.8 + 1.2) * 0.3

      a.vel.addScaledVector(_force, dt)
      a.vel.multiplyScalar(Math.pow(cfg.drag, dt * 60))

      const spd = a.vel.length()
      if (spd > cfg.maxSpeed) a.vel.multiplyScalar(cfg.maxSpeed / spd)
      else if (spd < cfg.minSpeed && spd > 0.001) a.vel.multiplyScalar(cfg.minSpeed / spd)

      a.pos.addScaledVector(a.vel, dt)
    }

    this.uploadInstances(time)
    this.material.uniforms.uTime.value = time
  }

  private spawnMissing(
    playerPos: Vector3,
    playerFwd: Vector3,
    playerVel: Vector3,
  ): void {
    const cfg = this.config
    const needed = cfg.count - this.agents.length
    for (let i = 0; i < needed; i++) {
      const seed = Math.random() * 100
      const angle = Math.random() * Math.PI * 2
      const r = Math.random() * cfg.spreadRadius
      const rx = Math.cos(angle) * r
      const ry = (Math.random() - 0.5) * cfg.spreadRadius * 0.5
      const rz = Math.sin(angle) * r

      _fwd.copy(playerFwd)
      const pos = playerPos.clone()
        .addScaledVector(_fwd, cfg.aheadSeconds * Math.max(playerVel.length(), 3))
      pos.x += rx
      pos.y += ry
      pos.z += rz

      const swimAngle = Math.random() * Math.PI * 2
      const swimSpeed = cfg.minSpeed + Math.random() * (cfg.swimSpeed - cfg.minSpeed)
      const vel = playerVel.clone().add(new Vector3(
        Math.cos(swimAngle) * swimSpeed,
        (Math.random() - 0.5) * 2,
        Math.sin(swimAngle) * swimSpeed,
      ))

      this.agents.push({
        pos,
        vel,
        seed,
        scale: cfg.scaleMin + Math.random() * (cfg.scaleMax - cfg.scaleMin),
      })
    }
  }

  private uploadInstances(time: number): void {
    const posAttr = this.mesh.geometry.getAttribute('instancePosition') as InstancedBufferAttribute
    const dataAttr = this.mesh.geometry.getAttribute('instanceData') as InstancedBufferAttribute

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i]
      const p = i * 3
      this.instancePositions[p] = a.pos.x
      this.instancePositions[p + 1] = a.pos.y
      this.instancePositions[p + 2] = a.pos.z

      const d = i * 4
      _fwd.copy(a.vel)
      const spd = _fwd.length()
      if (spd > 0.001) _fwd.divideScalar(spd)
      else _fwd.set(0, 0, 1)

      this.instanceData[d] = _fwd.x
      this.instanceData[d + 1] = _fwd.y
      this.instanceData[d + 2] = _fwd.z
      this.instanceData[d + 3] = a.scale + Math.sin(a.seed + time * 3) * 0.04
    }

    posAttr.needsUpdate = true
    dataAttr.needsUpdate = true
    ;(this.mesh.geometry as InstancedBufferGeometry).instanceCount = this.agents.length
  }

  private buildGeometry(): InstancedBufferGeometry {
    const baseGeo = buildFishBody()
    const instGeo = new InstancedBufferGeometry()
    instGeo.index = baseGeo.index
    instGeo.attributes.position = baseGeo.attributes.position
    instGeo.attributes.normal = baseGeo.attributes.normal

    instGeo.setAttribute('instancePosition', new InstancedBufferAttribute(this.instancePositions, 3))
    instGeo.setAttribute('instanceData', new InstancedBufferAttribute(this.instanceData, 4))
    instGeo.instanceCount = 0
    return instGeo
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}

function buildFishBody(): BufferGeometry {
  const verts = new Float32Array([
    0,     0,   1.2,
   -0.12,  0.05,  0.4,
    0.12,  0.05,  0.4,
   -0.12, -0.05,  0.4,
    0.12, -0.05,  0.4,
   -0.12,  0.05, -0.4,
    0.12,  0.05, -0.4,
   -0.12, -0.05, -0.4,
    0.12, -0.05, -0.4,
    0,     0,  -1.0,
   -0.22,  0.0, -0.55,
    0.22,  0.0, -0.55,
    0,     0.22, -0.7,
    0,    -0.22, -0.7,
  ])
  const norms = new Float32Array([
    0, 0, 1,
   -0.5, 0.3, 0.3,   0.5, 0.3, 0.3,
   -0.5,-0.3, 0.3,   0.5,-0.3, 0.3,
   -0.4, 0.3,-0.3,   0.4, 0.3,-0.3,
   -0.4,-0.3,-0.3,   0.4,-0.3,-0.3,
    0,  0,  -1,
   -0.8, 0, -0.2,    0.8, 0, -0.2,
    0,  0.8, -0.2,   0, -0.8, -0.2,
  ])
  const idx = new Uint16Array([
    0,1,2,  0,4,3,
    1,5,2,  3,4,7,  4,6,5,  2,6,8,
    1,3,5,  4,8,7,
    5,7,9,  6,9,8,
    7,8,13, 5,6,12,
    10,11,9,  11,10,9,
    12,13,9,
    1,2,5,  2,6,5,
    3,7,4,  7,8,4,
  ])
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(verts, 3))
  geo.setAttribute('normal', new Float32BufferAttribute(norms, 3))
  geo.setIndex(new BufferAttribute(idx, 1))
  return geo
}

const FISH_VERTEX = `
attribute vec3 instancePosition;
attribute vec4 instanceData; // xyz=forward, w=scale

uniform float uTime;

varying vec3 vNormal;
varying float vFogDepth;
varying float vWiggle;

void main() {
  vec3 fwd = normalize(instanceData.xyz + vec3(0.0, 0.0, 0.001));
  float scale = instanceData.w;

  // tail wiggle: more toward -z of local fish
  float tailFactor = clamp(-position.z * 0.9, 0.0, 1.0);
  float wiggle = sin(uTime * 5.5 + instancePosition.x * 0.3 + instancePosition.z * 0.2) * 0.18 * tailFactor;

  vec3 localPos = position;
  localPos.x += wiggle;
  localPos *= scale;

  // orient toward fwd
  vec3 up = vec3(0.0, 1.0, 0.0);
  if (abs(dot(fwd, up)) > 0.99) up = vec3(1.0, 0.0, 0.0);
  vec3 right = normalize(cross(fwd, up));
  up = normalize(cross(right, fwd));
  mat3 rot = mat3(right, up, fwd);

  vec3 worldPos = rot * localPos + instancePosition;

  vNormal = rot * normal;
  vWiggle = abs(wiggle) * 5.0;

  vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
  vFogDepth = -mvPos.z;
  gl_Position = projectionMatrix * mvPos;
}
`

const FISH_FRAGMENT = `
uniform vec3 uColor;
uniform float uEmissive;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;

varying vec3 vNormal;
varying float vFogDepth;
varying float vWiggle;

void main() {
  vec3 n = normalize(vNormal);
  vec3 light = normalize(vec3(0.8, 1.0, 0.5));
  float diff = clamp(dot(n, light) * 0.5 + 0.5, 0.0, 1.0);

  vec3 col = uColor * diff;
  col += uColor * uEmissive;
  col += uColor * vWiggle * 0.25;

  float fog = smoothstep(fogNear, fogFar, vFogDepth);
  col = mix(col, fogColor, fog);

  float alpha = 0.88 * (1.0 - fog * 0.7);
  if (alpha < 0.02) discard;

  gl_FragColor = vec4(col, alpha);
}
`
