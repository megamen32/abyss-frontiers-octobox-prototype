import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GAME_CONFIG } from '../config';
import type { CameraState, ChunkData, Loot, Obstacle, PlayerState } from '../types';
import { DebugRenderer } from './DebugRenderer';
import { Hud } from './Hud';
import { RenderPools } from './pools';
import { orientationFromLook } from '../simulation/player';

export class RenderApp {
  readonly hud: Hud;
  readonly cameraState: CameraState = { yaw: 0, pitch: -0.28, lastManualLookAt: 0 };
  private readonly shell = document.createElement('div');
  private readonly viewport = document.createElement('div');
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(
    GAME_CONFIG.camera.fov,
    window.innerWidth / window.innerHeight,
    0.1,
    1500,
  );
  private readonly renderer = new WebGLRenderer({ antialias: true });
  private readonly world = new Group();
  private readonly pools = new RenderPools();
  private readonly debugRenderer = new DebugRenderer();
  private readonly chunkGroups = new Map<string, { group: Group; debug: Group; pooled: Mesh[] }>();
  private readonly playerMesh = new Group();
  private readonly playerRadius = this.debugRenderer.createPlayerRadius(GAME_CONFIG.ship.radius);
  private debugEnabled: boolean = GAME_CONFIG.visuals.debugEnabled;
  private pointerLocked = false;

  constructor(parent: HTMLElement) {
    this.shell.className = 'shell';
    this.viewport.className = 'viewport';
    this.shell.append(this.viewport);
    parent.append(this.shell);
    this.hud = new Hud(this.shell);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(new Color(GAME_CONFIG.visuals.skyColor));
    this.viewport.append(this.renderer.domElement);

    this.scene.fog = new FogExp2(new Color(GAME_CONFIG.visuals.fogColor), 0.012);
    this.scene.add(this.world);
    this.setupLights();
    this.setupPlayerMesh();
    this.installInput();
    this.onResize();
    window.addEventListener('resize', this.onResize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }

  setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled;
    this.playerRadius.visible = enabled;
    for (const chunk of this.chunkGroups.values()) {
      chunk.debug.visible = enabled;
    }
  }

  syncChunks(added: ChunkData[], removed: string[]): void {
    for (const key of removed) {
      const existing = this.chunkGroups.get(key);
      if (!existing) {
        continue;
      }
      this.world.remove(existing.group);
      this.world.remove(existing.debug);
      for (const mesh of existing.pooled) {
        if (mesh.userData.poolKind === 'sphereObstacle') {
          this.pools.sphereObstacle.release(mesh);
        } else if (mesh.userData.poolKind === 'chest') {
          this.pools.chest.release(mesh);
        } else if (mesh.userData.poolKind === 'boxObstacle') {
          this.pools.boxObstacle.release(mesh);
        } else {
          this.pools.coin.release(mesh);
        }
      }
      this.chunkGroups.delete(key);
    }

    for (const chunk of added) {
      const group = new Group();
      const pooled: Mesh[] = [];
      for (const obstacle of chunk.obstacles) {
        const mesh = this.buildObstacleMesh(obstacle);
        group.add(mesh);
        pooled.push(mesh);
      }
      for (const loot of chunk.loot) {
        const mesh = this.buildLootMesh(loot);
        group.add(mesh);
        pooled.push(mesh);
      }
      const debug = this.debugRenderer.createChunkDebug(chunk);
      debug.visible = this.debugEnabled;
      this.world.add(group);
      this.world.add(debug);
      this.chunkGroups.set(chunk.key, { group, debug, pooled });
    }
  }

  updateFrame(frame: {
    player: PlayerState;
    chunks: Iterable<ChunkData>;
    fps: number;
    seed: number;
    chunkCoord: { x: number; y: number; z: number };
    distance: number;
    depth: number;
  }): void {
    const orientation = orientationFromLook(frame.player.lookDirection);
    const now = performance.now() * 0.001;
    if (now - this.cameraState.lastManualLookAt > GAME_CONFIG.camera.followLookDelay) {
      const autoBlend = 1 - Math.exp(-GAME_CONFIG.camera.followLookDamping * 0.016);
      this.cameraState.yaw = dampAngle(this.cameraState.yaw, orientation.yaw, autoBlend);
      this.cameraState.pitch = MathUtils.lerp(this.cameraState.pitch, orientation.pitch * 0.65, autoBlend);
    }
    this.playerMesh.position.copy(frame.player.position);
    this.playerMesh.rotation.set(orientation.pitch, orientation.yaw, 0);
    this.playerRadius.position.copy(frame.player.position);
    this.playerRadius.visible = this.debugEnabled;

    for (const chunk of frame.chunks) {
      const chunkRender = this.chunkGroups.get(chunk.key);
      if (!chunkRender) {
        continue;
      }
      this.updateChunkMeshes(chunk, chunkRender.pooled);
    }

    const cameraOffset = new Vector3(0, GAME_CONFIG.camera.height, -GAME_CONFIG.camera.distance)
      .applyAxisAngle(new Vector3(1, 0, 0), this.cameraState.pitch)
      .applyAxisAngle(new Vector3(0, 1, 0), this.cameraState.yaw);
    const desiredCamera = frame.player.position.clone().add(cameraOffset);
    this.camera.position.lerp(desiredCamera, 1 - Math.exp(-6 * GAME_CONFIG.camera.smoothness));
    this.camera.lookAt(frame.player.position.clone().add(frame.player.lookDirection.clone().multiplyScalar(18)));

    this.hud.render({
      hp: frame.player.hp,
      loot: frame.player.loot,
      fps: frame.fps,
      seed: frame.seed,
      coord: frame.chunkCoord,
      distance: frame.distance,
      depth: frame.depth,
      debugEnabled: this.debugEnabled,
      dead: !frame.player.alive,
    });

    this.renderer.render(this.scene, this.camera);
  }

  private updateChunkMeshes(chunk: ChunkData, pooled: Mesh[]): void {
    let obstacleIndex = 0;
    for (const obstacle of chunk.obstacles) {
      const mesh = pooled[obstacleIndex];
      obstacleIndex += 1;
      mesh.position.copy(obstacle.position);
      if (obstacle.type === 'box' && obstacle.size) {
        mesh.scale.copy(obstacle.size);
      } else if (obstacle.radius) {
        mesh.scale.setScalar(obstacle.radius);
      }
      if (obstacle.motion !== 'static') {
        mesh.rotation.x += obstacle.axis.x * obstacle.angularSpeed * 0.01;
        mesh.rotation.y += obstacle.axis.y * obstacle.angularSpeed * 0.01;
        mesh.rotation.z += obstacle.axis.z * obstacle.angularSpeed * 0.01;
      }
    }
    for (const loot of chunk.loot) {
      const mesh = pooled[obstacleIndex];
      obstacleIndex += 1;
      mesh.position.copy(loot.position);
      mesh.visible = !loot.collected;
      mesh.rotation.y += loot.type === 'coin' ? 0.03 : 0.015;
    }
  }

  private buildObstacleMesh(obstacle: Obstacle): Mesh {
    const mesh = obstacle.type === 'sphere' ? this.pools.sphereObstacle.acquire() : this.pools.boxObstacle.acquire();
    mesh.userData.poolKind = obstacle.type === 'sphere' ? 'sphereObstacle' : 'boxObstacle';
    mesh.position.copy(obstacle.position);
    if (obstacle.type === 'sphere' && obstacle.radius) {
      mesh.scale.setScalar(obstacle.radius);
    }
    if (obstacle.type === 'box' && obstacle.size) {
      mesh.scale.copy(obstacle.size);
    }
    return mesh;
  }

  private buildLootMesh(loot: Loot): Mesh {
    const mesh = loot.type === 'coin' ? this.pools.coin.acquire() : this.pools.chest.acquire();
    mesh.userData.poolKind = loot.type === 'coin' ? 'coin' : 'chest';
    mesh.position.copy(loot.position);
    mesh.scale.setScalar(loot.type === 'coin' ? 1 : 1);
    return mesh;
  }

  private setupLights(): void {
    this.scene.add(new AmbientLight(new Color('#8fb8d2'), 1.6));
    const keyLight = new DirectionalLight(new Color('#ffd7a6'), 1.95);
    keyLight.position.set(14, 18, 10);
    this.scene.add(keyLight);
    const rimLight = new DirectionalLight(new Color('#5dbef4'), 1.05);
    rimLight.position.set(-12, 8, -16);
    this.scene.add(rimLight);
  }

  private setupPlayerMesh(): void {
    const hull = new Mesh(
      new SphereGeometry(1.05, 18, 18),
      new MeshStandardMaterial({ color: new Color('#d9edf9'), metalness: 0.35, roughness: 0.4 }),
    );
    hull.scale.set(1, 0.65, 1.5);
    const prow = new Mesh(
      new BoxGeometry(0.45, 0.35, 1.8),
      new MeshStandardMaterial({ color: new Color('#5dd1ff'), emissive: new Color('#0d3048') }),
    );
    prow.position.z = 1.2;
    this.playerMesh.add(hull, prow, this.playerRadius);
    this.scene.add(this.playerMesh);
  }

  private installInput(): void {
    this.renderer.domElement.addEventListener('click', async () => {
      if (!this.pointerLocked) {
        await this.renderer.domElement.requestPointerLock();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    });
    document.addEventListener('mousemove', (event) => {
      if (!this.pointerLocked) {
        return;
      }
      this.cameraState.yaw += event.movementX * 0.0028;
      this.cameraState.pitch = MathUtils.clamp(
        this.cameraState.pitch - event.movementY * 0.0024,
        GAME_CONFIG.camera.pitchMin,
        GAME_CONFIG.camera.pitchMax,
      );
      this.cameraState.lastManualLookAt = performance.now() * 0.001;
    });
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}

function dampAngle(current: number, target: number, blend: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * blend;
}
