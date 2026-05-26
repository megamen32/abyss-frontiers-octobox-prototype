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
import type { BoidState, BoidsConfig } from './BoidsTypes'
import { BoidFlags } from './BoidsTypes'

const _forward = new Vector3()
const _up = new Vector3(0, 1, 0)
const _right = new Vector3()
const _tmpV = new Vector3()

export class BoidsRenderer {
  private readonly mesh: Mesh
  private readonly material: ShaderMaterial
  private readonly instancePositions: Float32Array
  private readonly instanceRotations: Float32Array
  private readonly instanceColors: Float32Array
  private readonly instanceAlphas: Float32Array
  private readonly maxBoids: number

  constructor(config: BoidsConfig) {
    this.maxBoids = Math.min(config.maxBoids, config.fallback.cpuMaxBoids)
    const geometry = this.createFishGeometry()
    const instancedGeo = new InstancedBufferGeometry()
    instancedGeo.index = geometry.index
    instancedGeo.attributes.position = geometry.attributes.position
    instancedGeo.attributes.normal = geometry.attributes.normal

    this.instancePositions = new Float32Array(this.maxBoids * 3)
    this.instanceRotations = new Float32Array(this.maxBoids * 4)
    this.instanceColors = new Float32Array(this.maxBoids * 3)
    this.instanceAlphas = new Float32Array(this.maxBoids)

    instancedGeo.setAttribute('instancePosition', new InstancedBufferAttribute(this.instancePositions, 3))
    instancedGeo.setAttribute('instanceRotation', new InstancedBufferAttribute(this.instanceRotations, 4))
    instancedGeo.setAttribute('instanceColor', new InstancedBufferAttribute(this.instanceColors, 3))
    instancedGeo.setAttribute('instanceAlpha', new InstancedBufferAttribute(this.instanceAlphas, 1))

    this.material = new ShaderMaterial({
      uniforms: {
        fogColor: { value: new Color(0x02070c) },
        fogNear: { value: 0 },
        fogFar: { value: 200 },
        time: { value: 0 },
      },
      vertexShader: BOIDS_VERTEX_SHADER,
      fragmentShader: BOIDS_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      fog: false,
    })

    this.mesh = new Mesh(instancedGeo, this.material)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
  }

  getObject3D(): Object3D {
    return this.mesh
  }

  setFog(color: Color, near: number, far: number): void {
    this.material.uniforms.fogColor.value.copy(color)
    this.material.uniforms.fogNear.value = near
    this.material.uniforms.fogFar.value = far
  }

  updateFromCPUStates(boids: readonly BoidState[], time: number): number {
    let visible = 0
    const posAttr = this.mesh.geometry.getAttribute('instancePosition') as InstancedBufferAttribute
    const rotAttr = this.mesh.geometry.getAttribute('instanceRotation') as InstancedBufferAttribute
    const colAttr = this.mesh.geometry.getAttribute('instanceColor') as InstancedBufferAttribute
    const alphaAttr = this.mesh.geometry.getAttribute('instanceAlpha') as InstancedBufferAttribute

    for (let i = 0; i < boids.length && visible < this.maxBoids; i++) {
      const b = boids[i]
      if (b.flags === BoidFlags.DEAD || b.flags === BoidFlags.SLEEPING) continue

      const o = visible * 3
      const o4 = visible * 4

      this.instancePositions[o] = b.position[0]
      this.instancePositions[o + 1] = b.position[1]
      this.instancePositions[o + 2] = b.position[2]

      _forward.set(b.velocity[0], b.velocity[1], b.velocity[2])
      const speed = _forward.length()
      if (speed > 0.001) {
        _forward.divideScalar(speed)
      } else {
        _forward.set(0, 0, 1)
      }

      const seed = b.seed
      _right.crossVectors(_forward, _up).normalize()
      if (_right.lengthSq() < 0.001) {
        _right.set(1, 0, 0)
      }
      _tmpV.copy(_up)

      const quat = this.lookRotation(_forward, _tmpV)
      this.instanceRotations[o4] = quat.x
      this.instanceRotations[o4 + 1] = quat.y
      this.instanceRotations[o4 + 2] = quat.z
      this.instanceRotations[o4 + 3] = quat.w

      const hue = (seed * 0.001) % 1
      const saturation = 0.3 + Math.min(speed / 15, 0.5)
      const lightness = 0.4 + Math.min(speed / 20, 0.3)
      const c = new Color().setHSL(hue, saturation, lightness)
      this.instanceColors[o] = c.r
      this.instanceColors[o + 1] = c.g
      this.instanceColors[o + 2] = c.b

      let alpha = 1
      if (b.flags === BoidFlags.SPAWNING) alpha = b.life
      else if (b.flags === BoidFlags.DESPAWNING) alpha = b.life
      this.instanceAlphas[visible] = alpha

      visible++
    }

    posAttr.needsUpdate = true
    rotAttr.needsUpdate = true
    colAttr.needsUpdate = true
    alphaAttr.needsUpdate = true
    this.mesh.count = visible

    this.material.uniforms.time.value = time
    return visible
  }

  updateFromGPUBuffer(data: Float32Array, count: number, time: number): number {
    let visible = 0
    const posAttr = this.mesh.geometry.getAttribute('instancePosition') as InstancedBufferAttribute
    const rotAttr = this.mesh.geometry.getAttribute('instanceRotation') as InstancedBufferAttribute
    const colAttr = this.mesh.geometry.getAttribute('instanceColor') as InstancedBufferAttribute
    const alphaAttr = this.mesh.geometry.getAttribute('instanceAlpha') as InstancedBufferAttribute

    for (let i = 0; i < count && visible < this.maxBoids; i++) {
      const o = i * 12
      const flags = data[o + 10]
      if (flags === 4) continue

      const vo = visible * 3
      const vo4 = visible * 4

      this.instancePositions[vo] = data[o]
      this.instancePositions[vo + 1] = data[o + 1]
      this.instancePositions[vo + 2] = data[o + 2]

      _forward.set(data[o + 4], data[o + 5], data[o + 6])
      const speed = _forward.length()
      if (speed > 0.001) _forward.divideScalar(speed)
      else _forward.set(0, 0, 1)

      const seed = data[o + 7]

      _right.crossVectors(_forward, _up).normalize()
      if (_right.lengthSq() < 0.001) _right.set(1, 0, 0)
      _tmpV.copy(_up)

      const quat = this.lookRotation(_forward, _tmpV)
      this.instanceRotations[vo4] = quat.x
      this.instanceRotations[vo4 + 1] = quat.y
      this.instanceRotations[vo4 + 2] = quat.z
      this.instanceRotations[vo4 + 3] = quat.w

      const hue = (seed * 0.001) % 1
      const saturation = 0.3 + Math.min(speed / 15, 0.5)
      const lightness = 0.4 + Math.min(speed / 20, 0.3)
      const c = new Color().setHSL(hue, saturation, lightness)
      this.instanceColors[vo] = c.r
      this.instanceColors[vo + 1] = c.g
      this.instanceColors[vo + 2] = c.b

      let alpha = 1
      const life = data[o + 8]
      if (flags === 1) alpha = life
      else if (flags === 2) alpha = life
      this.instanceAlphas[visible] = alpha

      visible++
    }

    posAttr.needsUpdate = true
    rotAttr.needsUpdate = true
    colAttr.needsUpdate = true
    alphaAttr.needsUpdate = true
    this.mesh.count = visible
    this.material.uniforms.time.value = time
    return visible
  }

  private lookRotation(forward: Vector3, up: Vector3): { x: number; y: number; z: number; w: number } {
    _right.crossVectors(forward, up).normalize()
    if (_right.lengthSq() < 0.0001) {
      _right.set(1, 0, 0)
    }
    const realUp = new Vector3().crossVectors(_right, forward).normalize()

    const m00 = _right.x, m10 = _right.y, m20 = _right.z
    const m01 = realUp.x, m11 = realUp.y, m21 = realUp.z
    const m02 = forward.x, m12 = forward.y, m22 = forward.z

    const trace = m00 + m11 + m22
    let x: number, y: number, z: number, w: number

    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1)
      w = 0.25 / s
      x = (m12 - m21) * s
      y = (m20 - m02) * s
      z = (m01 - m10) * s
    } else if (m00 > m11 && m00 > m22) {
      const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
      w = (m12 - m21) / s
      x = 0.25 * s
      y = (m10 + m01) / s
      z = (m20 + m02) / s
    } else if (m11 > m22) {
      const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
      w = (m20 - m02) / s
      x = (m10 + m01) / s
      y = 0.25 * s
      z = (m21 + m12) / s
    } else {
      const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
      w = (m01 - m10) / s
      x = (m20 + m02) / s
      y = (m21 + m12) / s
      z = 0.25 * s
    }

    return { x, y, z, w }
  }

  private createFishGeometry(): BufferGeometry {
    const vertices = new Float32Array([
      0, 0, 1.5,
      -0.3, 0.1, 0,
      0.3, 0.1, 0,
      -0.3, -0.1, 0,
      0.3, -0.1, 0,
      0, 0.15, -0.8,
      0, -0.15, -0.8,
      -0.5, 0, -0.6,
      0.5, 0, -0.6,
    ])

    const normals = new Float32Array([
      0, 0, 1,
      -0.5, 0.3, 0.3,
      0.5, 0.3, 0.3,
      -0.5, -0.3, 0.3,
      0.5, -0.3, 0.3,
      0, 0.7, -0.5,
      0, -0.7, -0.5,
      -0.7, 0, -0.3,
      0.7, 0, -0.3,
    ])

    const indices = new Uint16Array([
      0, 1, 2,
      0, 4, 3,
      1, 5, 2,
      3, 4, 6,
      1, 3, 5,
      2, 6, 4,
      5, 7, 8,
      5, 8, 6,
      1, 7, 5,
      2, 6, 8,
      3, 6, 5,
      4, 8, 7,
    ])

    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    geo.setAttribute('normal', new Float32BufferAttribute(normals, 3))
    geo.setIndex(new BufferAttribute(indices, 1))
    return geo
  }

  setEnabled(enabled: boolean): void {
    this.mesh.visible = enabled
  }

  setMaxBoids(maxBoids: number): void {
    this.maxBoids !== maxBoids
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}

const BOIDS_VERTEX_SHADER = `
attribute vec3 instancePosition;
attribute vec4 instanceRotation;
attribute vec3 instanceColor;
attribute float instanceAlpha;

varying vec3 vColor;
varying float vAlpha;
varying float vFogDepth;

uniform float time;

void main() {
  vColor = instanceColor;
  vAlpha = instanceAlpha;

  vec3 v = position;

  // Tail wiggle for fish
  if (v.z < -0.3) {
    float phase = instanceColor.r * 100.0 + time * 4.0;
    float wiggle = sin(phase) * 0.3 * smoothstep(-0.3, -0.8, v.z);
    v.x += wiggle;
  }

  // Quaternion rotation
  vec4 q = instanceRotation;
  vec3 qv = v;
  float qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  float len2 = qx*qx + qy*qy + qz*qz + qw*qw;
  if (len2 > 0.001) {
    float invLen = inversesqrt(len2);
    qx *= invLen; qy *= invLen; qz *= invLen; qw *= invLen;
    vec3 uv = 2.0 * cross(vec3(qx, qy, qz), qv);
    qv = qv + qw * uv + cross(vec3(qx, qy, qz), uv);
  }

  vec3 worldPos = qv * 0.5 + instancePosition;

  vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
  vFogDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
`

const BOIDS_FRAGMENT_SHADER = `
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;

varying vec3 vColor;
varying float vAlpha;
varying float vFogDepth;

void main() {
  float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  vec3 color = mix(vColor, fogColor, fogFactor);

  // Emissive glow
  color += vColor * 0.15 * (1.0 - fogFactor);

  float alpha = vAlpha * (1.0 - fogFactor * 0.8);
  if (alpha < 0.01) discard;

  gl_FragColor = vec4(color, alpha);
}
`
