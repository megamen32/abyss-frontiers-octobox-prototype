import {
  BufferGeometry,
  BoxGeometry,
  Color,
  ConeGeometry,
  InstancedMesh,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  IcosahedronGeometry,
  Object3D,
  OctahedronGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { GAME_CONFIG } from '../config';
import { patchDither, setFogFade } from './fogDither';

type ObjectFactory<T extends Object3D> = () => T;

function installFadeCallback(mesh: Mesh): void {
  mesh.onBeforeRender = () => {
    const fade = mesh.userData.fadeOpacity ?? 1;
    if (mesh.material instanceof MeshStandardMaterial) {
      setFogFade(mesh.material, fade);
    }
  };
}

function installMineShaderCallback(object: Mesh | InstancedMesh, material: ShaderMaterial): void {
  object.onBeforeRender = () => {
    const danger = object.userData.mineDanger ?? 0;
    const time = object.userData.mineTime ?? 0;
    material.uniforms.uDanger.value = danger;
    material.uniforms.uTime.value = time;
    if (GAME_CONFIG.visuals.fogDitherEnabled) {
      material.uniforms.uFogFade.value = object.userData.fadeOpacity ?? 1;
    }
  };
}

class ObjectPool<T extends Object3D> {
  private readonly available: T[] = [];

  constructor(private readonly factory: ObjectFactory<T>, initialSize = 0) {
    for (let index = 0; index < initialSize; index += 1) {
      const object = this.factory();
      object.visible = false;
      this.available.push(object);
    }
  }

  acquire(): T {
    const object = this.available.pop() ?? this.factory();
    object.visible = true;
    return object;
  }

  release(object: T): void {
    object.visible = false;
    object.parent?.remove(object);
    this.available.push(object);
  }
}

export class RenderPools {
  readonly sphereObstacleGeometry = new SphereGeometry(1, 18, 18);
  readonly sphereObstacleMaterial = new MeshStandardMaterial({ color: new Color('#a4563f'), roughness: 0.7, metalness: 0.12 });
  readonly boxObstacleGeometry = new BoxGeometry(1, 1, 1);
  readonly boxObstacleMaterial = new MeshStandardMaterial({
    color: new Color('#b46843'),
    emissive: new Color('#34170f'),
    roughness: 0.72,
    metalness: 0.08,
  });
  readonly coinGeometry = new OctahedronGeometry(0.9, 0);
  readonly coinMaterial = new MeshStandardMaterial({ color: new Color('#f8c95f'), emissive: new Color('#5e4310') });
  readonly chestGeometry = new BoxGeometry(1.8, 1.4, 1.2);
  readonly chestMaterial = new MeshStandardMaterial({ color: new Color('#5d8fbc'), roughness: 0.45, metalness: 0.4 });
  readonly mineCoreGeometry = new IcosahedronGeometry(1, 0);
  readonly mineSpikeGeometry = new ConeGeometry(0.16, 0.55, 3, 1);
  readonly mineCoreMaterial = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDanger: { value: 0 },
      uFogColor: { value: new Color('#02070c') },
      uFogNear: { value: 0 },
      uFogFar: { value: 200 },
      uFogFade: { value: 1.0 },
      uBaseColor: { value: new Color('#10161d') },
      uRustColor: { value: new Color('#5c2f20') },
      uGlowColor: { value: new Color('#36ffc8') },
    },
    vertexShader: `
      #include <common>
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying float vFogDepth;

      void main() {
        #include <beginnormal_vertex>
        #include <defaultnormal_vertex>
        #include <begin_vertex>

        vNormal = normalize(transformedNormal);
        vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
        vWorldPos = worldPos.xyz;

        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        vFogDepth = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      #include <common>
      uniform float uTime;
      uniform float uDanger;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform float uFogFade;
      uniform vec3 uBaseColor;
      uniform vec3 uRustColor;
      uniform vec3 uGlowColor;

      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying float vFogDepth;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      void main() {
        vec3 n = normalize(vNormal);
        float dirt = hash(floor(vWorldPos * 5.0));
        float rustMask = smoothstep(0.35, 0.9, dirt);
        vec3 color = mix(uBaseColor, uRustColor, rustMask);

        float wake = smoothstep(0.08, 0.45, uDanger);
        float pulseSpeed = mix(0.8, 7.0, wake);
        float pulse = mix(1.0, 0.5 + 0.5 * sin(uTime * pulseSpeed + dirt * 3.14159), wake);
        float rim = pow(1.0 - max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0), 2.2);
        float glow = rim * (0.06 + pulse * 0.94) * mix(0.2, 1.8, wake);
        color += uGlowColor * glow;

        float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
        color = mix(color, uFogColor, fogFactor);
        if (uFogFade < 0.999) {
          float threshold = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          if (threshold > uFogFade) discard;
        }
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    depthWrite: true,
  });
  readonly mineSpikeMaterial = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDanger: { value: 0 },
      uFogColor: { value: new Color('#02070c') },
      uFogNear: { value: 0 },
      uFogFar: { value: 200 },
      uFogFade: { value: 1.0 },
      uGlowColor: { value: new Color('#36ffc8') },
    },
    vertexShader: `
      #include <common>
      varying float vFogDepth;
      varying float vTip;

      void main() {
        #include <begin_vertex>
        vTip = position.y;
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        vFogDepth = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      #include <common>
      uniform float uTime;
      uniform float uDanger;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform float uFogFade;
      uniform vec3 uGlowColor;

      varying float vFogDepth;
      varying float vTip;

      void main() {
        float tip = smoothstep(0.08, 0.56, vTip);
        float wake = smoothstep(0.08, 0.45, uDanger);
        float pulse = mix(1.0, 0.5 + 0.5 * sin(uTime * mix(2.0, 9.0, wake)), wake);
        vec3 base = vec3(0.035, 0.045, 0.05);
        vec3 color = base + uGlowColor * tip * pulse * mix(0.15, 1.8, wake);
        float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
        color = mix(color, uFogColor, fogFactor);
        if (uFogFade < 0.999) {
          float threshold = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          if (threshold > uFogFade) discard;
        }
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    depthWrite: true,
  });

  private static readonly mineSpikeDirections = [
    new Vector3(1, 0, 0),
    new Vector3(-1, 0, 0),
    new Vector3(0, 1, 0),
    new Vector3(0, -1, 0),
    new Vector3(0, 0, 1),
    new Vector3(0, 0, -1),
    new Vector3(1, 1, 1).normalize(),
    new Vector3(-1, 1, 1).normalize(),
    new Vector3(1, -1, 1).normalize(),
    new Vector3(1, 1, -1).normalize(),
  ];

  constructor() {
    if (GAME_CONFIG.visuals.fogDitherEnabled) {
      patchDither(this.sphereObstacleMaterial);
      patchDither(this.boxObstacleMaterial);
      patchDither(this.coinMaterial);
      patchDither(this.chestMaterial);
    }
  }

  readonly sphereObstacle = new ObjectPool<Mesh>(
    () => {
      const m = new Mesh(this.sphereObstacleGeometry, this.sphereObstacleMaterial);
      installFadeCallback(m);
      return m;
    },
    24,
  );

  readonly boxObstacle = new ObjectPool<Mesh>(
    () => {
      const m = new Mesh(this.boxObstacleGeometry, this.boxObstacleMaterial);
      installFadeCallback(m);
      return m;
    },
    180,
  );

  readonly coin = new ObjectPool<Mesh>(
    () => {
      const m = new Mesh(this.coinGeometry, this.coinMaterial);
      installFadeCallback(m);
      return m;
    },
    40,
  );

  readonly chest = new ObjectPool<Mesh>(
    () => {
      const m = new Mesh(this.chestGeometry, this.chestMaterial);
      installFadeCallback(m);
      return m;
    },
    12,
  );

  readonly mine = new ObjectPool<Group>(
    () => {
      const group = new Group();
      const core = new Mesh(this.mineCoreGeometry, this.mineCoreMaterial);
      core.name = 'mine-core';
      installFadeCallback(core);
      installMineShaderCallback(core, this.mineCoreMaterial);

      const spikes = new InstancedMesh(this.mineSpikeGeometry, this.mineSpikeMaterial, RenderPools.mineSpikeDirections.length);
      spikes.name = 'mine-spikes';
      installMineShaderCallback(spikes, this.mineSpikeMaterial);
      const dummy = new Object3D();
      const quat = new Quaternion();
      for (let index = 0; index < RenderPools.mineSpikeDirections.length; index += 1) {
        const dir = RenderPools.mineSpikeDirections[index];
        dummy.position.copy(dir).multiplyScalar(1.12);
        quat.setFromUnitVectors(new Vector3(0, 1, 0), dir);
        dummy.quaternion.copy(quat);
        dummy.updateMatrix();
        spikes.setMatrixAt(index, dummy.matrix);
      }
      spikes.instanceMatrix.needsUpdate = true;

      const telegraph = new Line(
        new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(0, 0, 1)]),
        new LineBasicMaterial({ color: new Color('#ffb38a') }),
      );
      telegraph.name = 'mine-telegraph';
      telegraph.visible = false;
      group.add(core, spikes, telegraph);
      return group;
    },
    12,
  );

  releaseObjects(items: Object3D[]): void {
    for (const item of items) {
      if (!(item instanceof Mesh)) {
        item.parent?.remove(item);
        continue;
      }

      if (item.geometry instanceof SphereGeometry) {
        this.sphereObstacle.release(item);
      } else if (item.geometry instanceof OctahedronGeometry) {
        this.coin.release(item);
      } else if (item.scale.x > 1.5 && item.scale.y > 1.2) {
        this.chest.release(item);
      } else {
        this.boxObstacle.release(item);
      }
    }
  }
}
