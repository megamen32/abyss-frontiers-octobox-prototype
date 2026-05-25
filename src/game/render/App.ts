import {
  Box3,
  Box3Helper,
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
  Line,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GAME_CONFIG } from '../config';
import type { CameraState, ChunkData, Loot, Obstacle, PlayerState } from '../types';
import { DebugRenderer } from './DebugRenderer';
import { Hud } from './Hud';
import { RenderPools } from './pools';
import { angleBetweenVectors } from '../simulation/flightMath';
import { orientationFromLook, travelDirection } from '../simulation/player';
import type { ChunkCoord } from '../types';
import type { RuntimeFlightTuning } from '../simulation/runtimeTuning';
import { fogChunkRenderRadius, fogVisibilityDistance } from '../utils/visibility';

type PooledChunkObject = Group | Mesh;
type ChunkRenderGroup = {
  chunk: ChunkData;
  group: Group;
  debug: Group;
  pooled: PooledChunkObject[];
  coord: ChunkCoord;
  spawnCursor: number;
};

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
  private readonly chunkGroups = new Map<string, ChunkRenderGroup>();
  private readonly playerMesh = new Group();
  private readonly playerRadius = this.debugRenderer.createPlayerRadius(GAME_CONFIG.ship.radius);
  private readonly visibleRadiusHelper = this.debugRenderer.createChunkRadiusHelper('visibleRadius');
  private readonly interactiveRadiusHelper = this.debugRenderer.createChunkRadiusHelper('interactiveRadius');
  private readonly simulationRadiusHelper = this.debugRenderer.createChunkRadiusHelper('simulationRadius');
  private readonly cameraFocus = new Vector3(
    GAME_CONFIG.world.spawn.x,
    GAME_CONFIG.world.spawn.y,
    GAME_CONFIG.world.spawn.z,
  );
  private debugEnabled: boolean = GAME_CONFIG.visuals.debugEnabled;
  private fogEnabled = true;
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

    this.scene.fog = new FogExp2(new Color(GAME_CONFIG.visuals.fogColor), GAME_CONFIG.visuals.fogDensity);
    this.scene.add(this.world);
    this.setupLights();
    this.setupPlayerMesh();
    this.world.add(this.visibleRadiusHelper, this.interactiveRadiusHelper, this.simulationRadiusHelper);
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
    this.visibleRadiusHelper.visible = enabled;
    this.interactiveRadiusHelper.visible = enabled;
    this.simulationRadiusHelper.visible = enabled;
  }

  setFogEnabled(enabled: boolean): void {
    this.fogEnabled = enabled;
    this.scene.fog = enabled
      ? new FogExp2(new Color(GAME_CONFIG.visuals.fogColor), GAME_CONFIG.visuals.fogDensity)
      : null;
  }

  syncChunks(added: ChunkData[], removed: string[]): void {
    for (const key of removed) {
      const existing = this.chunkGroups.get(key);
      if (!existing) {
        continue;
      }
      this.releaseChunkObjects(existing);
      this.world.remove(existing.group);
      this.world.remove(existing.debug);
      this.chunkGroups.delete(key);
    }

    for (const chunk of added) {
      const group = new Group();
      const debug = this.debugRenderer.createChunkDebug(chunk);
      debug.visible = this.debugEnabled;
      this.world.add(group);
      this.world.add(debug);
      this.chunkGroups.set(chunk.key, { chunk, group, debug, pooled: [], coord: chunk.coord, spawnCursor: 0 });
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
    dangerLevel: number;
    depthBand: string;
    dangerAccent: string;
    tuning: RuntimeFlightTuning;
    fogEnabled: boolean;
    spawnBudget: number;
    averageFps: number;
  }): void {
    const desiredLookDirection = this.resolveDesiredLookDirection(frame.player);
    const orientation = orientationFromLook(desiredLookDirection);
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

    this.processChunkSpawnQueue(frame.player, frame.spawnBudget);

    for (const chunkRender of this.chunkGroups.values()) {
      this.updateChunkMeshes(chunkRender);
    }

    this.updateChunkRadiusHelpers(frame.chunkCoord);
    this.updateDebugChunkVisibility(frame.chunkCoord);
    this.updateCameraFocus(frame.player.position);

    const cameraOffset = new Vector3(0, GAME_CONFIG.camera.height, -GAME_CONFIG.camera.distance)
      .applyAxisAngle(new Vector3(1, 0, 0), this.cameraState.pitch)
      .applyAxisAngle(new Vector3(0, 1, 0), this.cameraState.yaw);
    const desiredCamera = this.cameraFocus.clone().add(cameraOffset);
    this.camera.position.lerp(desiredCamera, 1 - Math.exp(-6 * GAME_CONFIG.camera.smoothness));
    this.camera.lookAt(this.cameraFocus.clone().add(desiredLookDirection.multiplyScalar(18)));

    this.hud.render({
      hp: frame.player.hp,
      loot: frame.player.loot,
      fps: frame.fps,
      seed: frame.seed,
      coord: frame.chunkCoord,
      distance: frame.distance,
      depth: frame.depth,
      speed: frame.player.speed,
      stallAmount: frame.player.stallAmount,
      driftAngleDeg: MathUtils.radToDeg(angleBetweenVectors(travelDirection(frame.player), frame.player.thrustForward)),
      dangerLevel: frame.dangerLevel,
      depthBand: frame.depthBand,
      dangerAccent: frame.dangerAccent,
      tuning: frame.tuning,
      debugEnabled: this.debugEnabled,
      fogEnabled: frame.fogEnabled,
      spawnBudget: frame.spawnBudget,
      averageFps: frame.averageFps,
      dead: !frame.player.alive,
    });

    this.renderer.render(this.scene, this.camera);
  }

  private updateChunkMeshes(chunkRender: ChunkRenderGroup): void {
    for (let index = 0; index < chunkRender.pooled.length; index += 1) {
      const target = this.chunkObjectAt(chunkRender.chunk, index);
      if (!target) {
        continue;
      }
      const object = chunkRender.pooled[index];
      if (target.kind === 'obstacle') {
        const mesh = object as Mesh;
        mesh.position.copy(target.data.position);
        if (target.data.type === 'box' && target.data.size) {
          mesh.scale.copy(target.data.size);
        } else if (target.data.radius) {
          mesh.scale.setScalar(target.data.radius);
        }
        if (target.data.motion !== 'static') {
          mesh.rotation.x += target.data.axis.x * target.data.angularSpeed * 0.01;
          mesh.rotation.y += target.data.axis.y * target.data.angularSpeed * 0.01;
          mesh.rotation.z += target.data.axis.z * target.data.angularSpeed * 0.01;
        }
        continue;
      }

      if (target.kind === 'loot') {
        const mesh = object as Mesh;
        mesh.position.copy(target.data.position);
        mesh.visible = !target.data.collected;
        mesh.rotation.y += target.data.type === 'coin' ? 0.03 : 0.015;
        continue;
      }

      const mesh = object as Group;
      mesh.position.copy(target.data.position);
      mesh.visible = target.data.state !== 'dead';
      if (!mesh.visible) {
        continue;
      }
      mesh.rotation.x += 0.04;
      mesh.rotation.y += 0.06;
      mesh.rotation.z += 0.02;

      const core = mesh.getObjectByName('mine-core') as Mesh | undefined;
      const telegraph = mesh.getObjectByName('mine-telegraph') as Line | undefined;
      const scale = target.data.state === 'idle' ? 1 : target.data.state === 'targeting' ? 1.08 : 1.18;
      core?.scale.setScalar(target.data.radius * scale);

      if (telegraph) {
        telegraph.visible = target.data.state === 'targeting' && target.data.targetPosition !== null;
        if (telegraph.visible && target.data.targetPosition) {
          const positions = telegraph.geometry.attributes.position.array as Float32Array;
          positions[0] = 0;
          positions[1] = 0;
          positions[2] = 0;
          positions[3] = target.data.targetPosition.x - target.data.position.x;
          positions[4] = target.data.targetPosition.y - target.data.position.y;
          positions[5] = target.data.targetPosition.z - target.data.position.z;
          telegraph.geometry.attributes.position.needsUpdate = true;
          telegraph.geometry.computeBoundingSphere();
        }
      }
    }
  }

  private processChunkSpawnQueue(player: PlayerState, spawnBudget: number): void {
    const candidates = [...this.chunkGroups.values()]
      .filter((chunk) => {
        const shouldRender = this.shouldRenderChunk(chunk, player);
        if (!shouldRender && chunk.pooled.length > 0) {
          this.releaseChunkObjects(chunk);
        }
        return shouldRender && chunk.spawnCursor < this.chunkObjectCount(chunk.chunk);
      })
      .sort((left, right) => this.chunkSpawnPriority(right, player) - this.chunkSpawnPriority(left, player));

    let remaining = spawnBudget;
    while (remaining > 0) {
      let spawnedAny = false;
      for (const chunk of candidates) {
        if (remaining <= 0 || chunk.spawnCursor >= this.chunkObjectCount(chunk.chunk)) {
          continue;
        }
        this.spawnNextChunkObject(chunk);
        remaining -= 1;
        spawnedAny = true;
        if (remaining <= 0) {
          break;
        }
      }
      if (!spawnedAny) {
        break;
      }
    }
  }

  private shouldRenderChunk(chunkRender: ChunkRenderGroup, player: PlayerState): boolean {
    if (!this.fogEnabled) {
      return true;
    }
    const box = new Box3(chunkRender.chunk.bounds.min.clone(), chunkRender.chunk.bounds.max.clone());
    return box.distanceToPoint(player.position) <= fogVisibilityDistance();
  }

  private chunkSpawnPriority(chunkRender: ChunkRenderGroup, player: PlayerState): number {
    const forward = travelDirection(player);
    const predictedPosition = player.position.clone().addScaledVector(
      forward,
      Math.max(
        GAME_CONFIG.world.chunkSize,
        Math.min(
          fogVisibilityDistance(),
          player.speed * GAME_CONFIG.world.generationLookaheadSeconds,
        ),
      ),
    );
    const chunkCenter = chunkRender.chunk.bounds.min.clone().add(chunkRender.chunk.bounds.max).multiplyScalar(0.5);
    const fromPlayer = chunkCenter.clone().sub(player.position);
    const fromPredicted = chunkCenter.clone().sub(predictedPosition);
    const forwardness = fromPlayer.lengthSq() > 0.0001 ? fromPlayer.normalize().dot(forward) : 1;
    return forwardness * 80 - fromPredicted.length() * 0.65 - fromPlayer.length() * 0.15;
  }

  private spawnNextChunkObject(chunkRender: ChunkRenderGroup): void {
    const target = this.chunkObjectAt(chunkRender.chunk, chunkRender.spawnCursor);
    if (!target) {
      return;
    }

    const object = target.kind === 'obstacle'
      ? this.buildObstacleMesh(target.data)
      : target.kind === 'loot'
        ? this.buildLootMesh(target.data)
        : this.buildMineMesh(target.data);
    chunkRender.group.add(object);
    chunkRender.pooled.push(object);
    chunkRender.spawnCursor += 1;
  }

  private releaseChunkObjects(chunkRender: ChunkRenderGroup): void {
    for (const item of chunkRender.pooled) {
      if (item.userData.poolKind === 'sphereObstacle') {
        this.pools.sphereObstacle.release(item as Mesh);
      } else if (item.userData.poolKind === 'chest') {
        this.pools.chest.release(item as Mesh);
      } else if (item.userData.poolKind === 'boxObstacle') {
        this.pools.boxObstacle.release(item as Mesh);
      } else if (item.userData.poolKind === 'mine') {
        this.pools.mine.release(item as Group);
      } else {
        this.pools.coin.release(item as Mesh);
      }
    }
    chunkRender.pooled = [];
    chunkRender.spawnCursor = 0;
  }

  private chunkObjectCount(chunk: ChunkData): number {
    return chunk.obstacles.length + chunk.loot.length + chunk.mines.length;
  }

  private chunkObjectAt(chunk: ChunkData, index: number):
    | { kind: 'obstacle'; data: Obstacle }
    | { kind: 'loot'; data: Loot }
    | { kind: 'mine'; data: ChunkData['mines'][number] }
    | null {
    if (index < chunk.obstacles.length) {
      return { kind: 'obstacle', data: chunk.obstacles[index] };
    }
    const lootIndex = index - chunk.obstacles.length;
    if (lootIndex < chunk.loot.length) {
      return { kind: 'loot', data: chunk.loot[lootIndex] };
    }
    const mineIndex = lootIndex - chunk.loot.length;
    if (mineIndex < chunk.mines.length) {
      return { kind: 'mine', data: chunk.mines[mineIndex] };
    }
    return null;
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

  private buildMineMesh(mine: ChunkData['mines'][number]): Group {
    const group = this.pools.mine.acquire();
    group.userData.poolKind = 'mine';
    group.position.copy(mine.position);
    group.rotation.set(0, 0, 0);
    const core = group.getObjectByName('mine-core') as Mesh | undefined;
    core?.scale.setScalar(mine.radius);
    const telegraph = group.getObjectByName('mine-telegraph') as Line | undefined;
    if (telegraph) {
      telegraph.visible = false;
    }
    return group;
  }

  private resolveDesiredLookDirection(player: PlayerState): Vector3 {
    const travel = travelDirection(player);
    const intentAngle = angleBetweenVectors(travel, player.targetThrustForward);
    const assistStart = MathUtils.degToRad(GAME_CONFIG.camera.thrustLookAssistStartAngleDeg);
    const assistFull = MathUtils.degToRad(GAME_CONFIG.camera.thrustLookAssistFullAngleDeg);
    const assistAngleBlend = MathUtils.clamp((intentAngle - assistStart) / (assistFull - assistStart), 0, 1);
    const assistSpeedBlend = MathUtils.clamp(
      (player.speed - GAME_CONFIG.camera.thrustLookAssistSpeedThreshold)
        / (GAME_CONFIG.ship.maxSpeed - GAME_CONFIG.camera.thrustLookAssistSpeedThreshold),
      0,
      1,
    );
    const assistBlend = assistAngleBlend * assistSpeedBlend * GAME_CONFIG.camera.thrustLookAssistMaxBlend;
    return player.forward.clone().lerp(player.targetThrustForward, assistBlend).normalize();
  }

  private updateCameraFocus(playerPosition: Vector3): void {
    const followBlend = 1 - Math.exp(-4 * GAME_CONFIG.camera.smoothness);
    this.cameraFocus.lerp(playerPosition, followBlend);

    const forward = new Vector3(
      Math.sin(this.cameraState.yaw) * Math.cos(this.cameraState.pitch),
      -Math.sin(this.cameraState.pitch),
      Math.cos(this.cameraState.yaw) * Math.cos(this.cameraState.pitch),
    ).normalize();
    const right = new Vector3().crossVectors(new Vector3(0, 1, 0), forward).normalize();
    const up = new Vector3().crossVectors(forward, right).normalize();
    const offset = playerPosition.clone().sub(this.cameraFocus);
    const horizontal = offset.dot(right);
    const vertical = offset.dot(up);

    if (Math.abs(horizontal) > GAME_CONFIG.camera.deadlockHalfWidth) {
      this.cameraFocus.addScaledVector(
        right,
        horizontal - Math.sign(horizontal) * GAME_CONFIG.camera.deadlockHalfWidth,
      );
    }
    if (Math.abs(vertical) > GAME_CONFIG.camera.deadlockHalfHeight) {
      this.cameraFocus.addScaledVector(
        up,
        vertical - Math.sign(vertical) * GAME_CONFIG.camera.deadlockHalfHeight,
      );
    }
  }

  private updateChunkRadiusHelpers(chunkCoord: { x: number; y: number; z: number }): void {
    this.updateChunkRadiusHelper(this.visibleRadiusHelper, chunkCoord, fogChunkRenderRadius());
    this.updateChunkRadiusHelper(this.interactiveRadiusHelper, chunkCoord, GAME_CONFIG.world.interactiveRadius);
    this.updateChunkRadiusHelper(this.simulationRadiusHelper, chunkCoord, GAME_CONFIG.world.simulationRadius);
  }

  private updateChunkRadiusHelper(
    helper: Box3Helper,
    chunkCoord: { x: number; y: number; z: number },
    radius: number,
  ): void {
    const chunkSize = GAME_CONFIG.world.chunkSize;
    const min = new Vector3(
      (chunkCoord.x - radius) * chunkSize,
      (chunkCoord.y - radius) * chunkSize,
      (chunkCoord.z - radius) * chunkSize,
    );
    const max = new Vector3(
      (chunkCoord.x + radius + 1) * chunkSize,
      (chunkCoord.y + radius + 1) * chunkSize,
      (chunkCoord.z + radius + 1) * chunkSize,
    );
    helper.box.copy(new Box3(min, max));
    helper.updateMatrixWorld(true);
    helper.visible = this.debugEnabled;
  }

  private updateDebugChunkVisibility(currentCoord: ChunkCoord): void {
    const debugRadius = GAME_CONFIG.visuals.debugChunkRadius;
    for (const chunk of this.chunkGroups.values()) {
      chunk.debug.visible = this.debugEnabled && chunkDistance(currentCoord, chunk.coord) <= debugRadius;
    }
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

function chunkDistance(a: ChunkCoord, b: ChunkCoord): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}
