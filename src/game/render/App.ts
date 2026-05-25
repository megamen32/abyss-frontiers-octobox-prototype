import {
  AdditiveBlending,
  BackSide,
  Box3,
  Box3Helper,
  AmbientLight,
  Color,
  DirectionalLight,
  Euler,
  FogExp2,
  Group,
  LineSegments,
  MathUtils,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Line,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GAME_CONFIG } from '../config';
import type { CameraState, ChunkData, DebugTimingSnapshot, Loot, Obstacle, PlayerState } from '../types';
import { DebugRenderer } from './DebugRenderer';
import { Hud } from './Hud';
import { RenderPools } from './pools';
import { angleBetweenVectors } from '../simulation/flightMath';
import { orientationFromLook, travelDirection } from '../simulation/player';
import type { ChunkCoord } from '../types';
import type { RuntimeFlightTuning } from '../simulation/runtimeTuning';
import type { ShipPredictor } from '../simulation/shipPredictor';
import { fogChunkRenderRadius, fogDensity, fogVisibilityDistance } from '../utils/visibility';
import { PerformanceCapture } from '../diagnostics/performanceCapture';
import { createBlackHoleEntrance, createStaticChunkMesh, isRepresentedByStaticChunkMesh } from './staticChunkMesh';
import { updateShipBank } from './shipBank';
import { computeCameraRig, shipAnchorsToWorld } from './cameraRig';
import { buildFrustumFromSnapshot, fogCullingDistance, type ViewFrustumSnapshot } from '../utils/visibility';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

type PooledChunkObject = Group | Mesh;
type ChunkRenderGroup = {
  chunk: ChunkData;
  renderObstacles: Obstacle[];
  group: Group;
  debug: Group | null;
  pooled: PooledChunkObject[];
  staticMesh: Mesh | null;
  blackHoleMesh: Group | null;
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
  private readonly performanceCapture = new PerformanceCapture();
  private readonly debugRenderer = new DebugRenderer();
  private readonly chunkGroups = new Map<string, ChunkRenderGroup>();
  private readonly playerMesh = new Group();
  private readonly shipVisual = new Group();
  private readonly playerRadius = this.debugRenderer.createPlayerRadius(GAME_CONFIG.ship.radius);
  private readonly visibleRadiusHelper = this.debugRenderer.createChunkRadiusHelper('visibleRadius');
  private readonly interactiveRadiusHelper = this.debugRenderer.createChunkRadiusHelper('interactiveRadius');
  private readonly simulationRadiusHelper = this.debugRenderer.createChunkRadiusHelper('simulationRadius');
  // Debug rays: velocity prediction (cyan), camera look-at (yellow), mine targets (red).
  private readonly debugVelocityRay = this.debugRenderer.createDebugRay('#00e5ff');
  private readonly debugCameraRay = this.debugRenderer.createDebugRay('#ffe600');
  private readonly debugMineSegs: LineSegments = this.debugRenderer.createDebugSegments('#ff4444', 32);
  private prevYaw = 0;
  private prevPitch = -0.28;
  private shipBank = 0;
  private prevLateralDrift = 0;
  private readonly cameraFocus = new Vector3(
    GAME_CONFIG.world.spawn.x,
    GAME_CONFIG.world.spawn.y,
    GAME_CONFIG.world.spawn.z,
  );
  // Smoothed look-at target — lerped each frame to prevent teleportation when
  // the ship pitches/yaws sharply.
  private readonly cameraLookAt = new Vector3(
    GAME_CONFIG.world.spawn.x,
    GAME_CONFIG.world.spawn.y,
    GAME_CONFIG.world.spawn.z + GAME_CONFIG.camera.lookAheadMin,
  );
  private readonly sceneFog = new FogExp2(new Color(GAME_CONFIG.visuals.fogColor), fogDensity());
  private readonly ambientLight = new AmbientLight(new Color('#8fb8d2'), GAME_CONFIG.visuals.surfaceAmbientIntensity);
  private readonly fogPlane = this.createFogPlane();
  private readonly skySphere = this.createSkySphere();
  private debugEnabled: boolean = GAME_CONFIG.visuals.debugEnabled;
  private chunkDebugEnabled: boolean = GAME_CONFIG.visuals.debugEnabled;
  private debugUiVisible = false;
  private fogEnabled = true;
  private pointerLocked = false;
  /** World-space points (boss, explosion, etc.) that must also be visible. */
  private externalFocusPoints: Vector3[] = [];

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

    this.scene.fog = this.sceneFog;
    this.scene.add(this.world);
    this.scene.add(this.skySphere);
    this.world.add(this.fogPlane);
    this.setupLights();
    this.setupPlayerMesh();
    this.world.add(this.visibleRadiusHelper, this.interactiveRadiusHelper, this.simulationRadiusHelper);
    this.world.add(this.debugVelocityRay, this.debugCameraRay, this.debugMineSegs);
    this.installInput();
    this.onResize();
    window.addEventListener('resize', this.onResize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    for (const chunk of this.chunkGroups.values()) {
      this.releaseChunkObjects(chunk);
      chunk.staticMesh?.geometry.dispose();
      if (chunk.blackHoleMesh) {
        disposeGroupMeshes(chunk.blackHoleMesh);
      }
    }
    this.chunkGroups.clear();
    this.renderer.dispose();
  }

  setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled;
    this.playerRadius.visible = enabled;
    this.visibleRadiusHelper.visible = enabled;
    this.interactiveRadiusHelper.visible = enabled;
    this.simulationRadiusHelper.visible = enabled;
  }

  setDebugUiVisible(visible: boolean): void {
    this.debugUiVisible = visible;
  }

  setChunkDebugEnabled(enabled: boolean): void {
    this.chunkDebugEnabled = enabled;
  }

  /**
   * Pass world-space points (boss position, explosion centre, etc.) that the
   * camera should keep in frame alongside the ship.  Pass an empty array to
   * clear.  The camera will zoom out as needed to frame everything.
   */
  setExternalFocusPoints(points: Vector3[]): void {
    this.externalFocusPoints = points.map(p => p.clone());
  }

  setFogEnabled(enabled: boolean): void {
    this.fogEnabled = enabled;
    this.scene.fog = enabled ? this.sceneFog : null;
  }

  getViewFrustumSnapshot(): ViewFrustumSnapshot {
    return {
      position: this.camera.position.clone(),
      lookAt: this.cameraLookAt.clone(),
      up: this.camera.up.clone(),
      fov: this.camera.fov,
      aspect: this.camera.aspect,
      near: this.camera.near,
      far: this.camera.far,
    };
  }

  syncChunks(added: ChunkData[], removed: string[]): void {
    for (const key of removed) {
      const existing = this.chunkGroups.get(key);
      if (!existing) {
        continue;
      }
      this.releaseChunkObjects(existing);
      existing.staticMesh?.geometry.dispose();
      if (existing.blackHoleMesh) {
        disposeGroupMeshes(existing.blackHoleMesh);
      }
      this.world.remove(existing.group);
      if (existing.debug) {
        this.world.remove(existing.debug);
      }
      this.chunkGroups.delete(key);
    }

    for (const chunk of added) {
      const group = new Group();
      const staticMesh = createStaticChunkMesh(chunk, this.pools.boxObstacleMaterial);
      if (staticMesh) {
        group.add(staticMesh);
      }
      const blackHole = createBlackHoleEntrance(chunk);
      if (blackHole) {
        group.add(blackHole);
      }
      const debug = this.debugEnabled && this.chunkDebugEnabled ? this.debugRenderer.createChunkDebug(chunk) : null;
      this.world.add(group);
      if (debug) {
        this.world.add(debug);
      }
      this.chunkGroups.set(chunk.key, {
        chunk,
        renderObstacles: chunk.obstacles.filter((obstacle) => !isRepresentedByStaticChunkMesh(chunk, obstacle)),
        group,
        debug,
        pooled: [],
        staticMesh,
        blackHoleMesh: blackHole,
        coord: chunk.coord,
        spawnCursor: 0,
      });
    }
  }

  updateFrame(frame: {
    paused: boolean;
    player: PlayerState;
    predictor: ShipPredictor;
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
    timings: DebugTimingSnapshot;
  }): void {
    const renderTimings: DebugTimingSnapshot = { ...frame.timings };
    const renderStart = performance.now();
    const desiredLookDirection = this.resolveDesiredLookDirection(frame.player);
    const orientation = orientationFromLook(desiredLookDirection);
    const now = performance.now() * 0.001;
    if (now - this.cameraState.lastManualLookAt > GAME_CONFIG.camera.followLookDelay) {
      const autoBlend = 1 - Math.exp(-GAME_CONFIG.camera.followLookDamping * 0.016);
      this.cameraState.yaw = dampAngle(this.cameraState.yaw, orientation.yaw, autoBlend);
      this.cameraState.pitch = MathUtils.lerp(this.cameraState.pitch, orientation.pitch * 0.65, autoBlend);
    }
    this.playerMesh.position.copy(frame.player.position);
    this.playerMesh.quaternion.setFromEuler(
      new Euler(-orientation.pitch, orientation.yaw, 0, 'YXZ'),
    );
    const bank = updateShipBank({
      velocity: frame.player.velocity,
      speed: frame.player.speed,
      orientation: this.playerMesh.quaternion,
      previousBank: this.shipBank,
      previousLateralDrift: this.prevLateralDrift,
      dt: 1 / Math.max(1, frame.fps),
    });
    this.shipBank = bank.bank;
    this.prevLateralDrift = bank.lateralDrift;
    this.shipVisual.rotation.z = this.shipBank;
    this.playerRadius.position.copy(frame.player.position);
    this.playerRadius.visible = this.debugEnabled;
    this.updateDebugVectors(frame.player, frame.predictor, frame.chunks);

    const spawnQueueStart = performance.now();
    this.processChunkSpawnQueue(frame.player, frame.spawnBudget);
    renderTimings.renderSpawnQueueMs = performance.now() - spawnQueueStart;

    const chunkUpdateStart = performance.now();
    let visibleChunks = 0;
    let staticMeshChunks = 0;
    for (const chunkRender of this.chunkGroups.values()) {
      const visible = this.shouldRenderChunk(chunkRender, frame.player);
      if (chunkRender.staticMesh) {
        chunkRender.staticMesh.visible = visible;
      }
      if (visible) {
        visibleChunks += 1;
        if (chunkRender.staticMesh) {
          staticMeshChunks += 1;
        }
      }
      this.updateChunkMeshes(chunkRender);
    }
    renderTimings.renderChunkUpdateMs = performance.now() - chunkUpdateStart;

    const debugStart = performance.now();
    this.updateChunkRadiusHelpers(frame.chunkCoord);
    this.updateDebugChunkVisibility(frame.chunkCoord);
    renderTimings.renderDebugMs = performance.now() - debugStart;

    const hudCameraStart = performance.now();
    this.updateCameraFocus(frame.player.position, desiredLookDirection);

    const MAX_DELTA = 10 * Math.PI / 180;
    this.cameraState.yaw = this.prevYaw + MathUtils.clamp(this.cameraState.yaw - this.prevYaw, -MAX_DELTA, MAX_DELTA);
    this.cameraState.pitch = this.prevPitch + MathUtils.clamp(this.cameraState.pitch - this.prevPitch, -MAX_DELTA, MAX_DELTA);
    this.prevYaw = this.cameraState.yaw;
    this.prevPitch = this.cameraState.pitch;

    const orbitPitch = Math.max(this.cameraState.pitch, 0);
    const cameraOffset = new Vector3(0, GAME_CONFIG.camera.height, -GAME_CONFIG.camera.distance)
      .applyAxisAngle(new Vector3(1, 0, 0), orbitPitch)
      .applyAxisAngle(new Vector3(0, 1, 0), this.cameraState.yaw);

    // Smooth the look-at target so sharp pitch/yaw changes don't teleport the view.
    // Distance scales with speed (1 second of travel) so fast flight opens up the view.
    const lookAheadDist = Math.max(
      GAME_CONFIG.camera.lookAheadMin,
      frame.player.speed * GAME_CONFIG.camera.lookAheadSeconds,
    );
    const desiredLookAt = frame.player.position.clone()
      .addScaledVector(desiredLookDirection, lookAheadDist);
    const lookBlend = 1 - Math.exp(-5 * GAME_CONFIG.camera.smoothness);
    this.cameraLookAt.lerp(desiredLookAt, lookBlend);

    // Must-see world-space points: ship anchors + any external focus points.
    const mustSeePoints = this.buildMustSeePoints(frame.player);

    const { position: desiredCameraPos } = computeCameraRig({
      cameraLookAt: { x: this.cameraLookAt.x, y: this.cameraLookAt.y, z: this.cameraLookAt.z },
      cameraBasePosition: {
        x: this.cameraFocus.x + cameraOffset.x,
        y: this.cameraFocus.y + cameraOffset.y,
        z: this.cameraFocus.z + cameraOffset.z,
      },
      mustSeePoints,
      fovDegrees: GAME_CONFIG.camera.fov,
      aspect: this.camera.aspect,
      viewMargin: GAME_CONFIG.camera.viewMargin,
    });

    this.camera.position.lerp(
      new Vector3(desiredCameraPos.x, desiredCameraPos.y, desiredCameraPos.z),
      1 - Math.exp(-6 * GAME_CONFIG.camera.smoothness),
    );
    this.camera.lookAt(this.cameraLookAt);
    this.skySphere.position.copy(this.camera.position);

    renderTimings.renderHudCameraMs = performance.now() - hudCameraStart;

    this.updateDepthVisuals(frame.dangerLevel);

    const drawStart = performance.now();
    this.renderer.render(this.scene, this.camera);
    renderTimings.renderDrawMs = performance.now() - drawStart;
    renderTimings.renderMs = performance.now() - renderStart;
    renderTimings.drawCalls = this.renderer.info.render.calls;
    renderTimings.drawTriangles = this.renderer.info.render.triangles;
    renderTimings.drawLines = this.renderer.info.render.lines;
    renderTimings.drawPoints = this.renderer.info.render.points;
    renderTimings.visibleChunks = visibleChunks;
    renderTimings.staticMeshChunks = staticMeshChunks;
    this.performanceCapture.record(frame.fps, renderTimings);
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
      debugUiVisible: this.debugUiVisible,
      chunkDebugEnabled: this.chunkDebugEnabled,
      fogEnabled: frame.fogEnabled,
      spawnBudget: frame.spawnBudget,
      averageFps: frame.averageFps,
      timings: renderTimings,
      dead: !frame.player.alive,
      paused: frame.paused,
    });
  }

  private updateChunkMeshes(chunkRender: ChunkRenderGroup): void {
    let pooledIndex = 0;
    const spawnedCount = chunkRender.spawnCursor;
    for (let index = 0; index < spawnedCount; index += 1) {
      const target = this.chunkObjectAt(chunkRender, index);
      if (!target) {
        continue;
      }
      const object = chunkRender.pooled[pooledIndex];
      pooledIndex += 1;
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
      const scale = target.data.state === 'idle' ? 1
        : target.data.state === 'targeting' ? 1.08
        : target.data.state === 'rocket' ? 1.12
        : 1.18;
      core?.scale.setScalar(target.data.radius * scale);

      if (telegraph) {
        telegraph.visible = (target.data.state === 'targeting' && target.data.targetPosition !== null)
          || target.data.state === 'rocket';
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
        } else if (telegraph.visible && target.data.state === 'rocket') {
          const vDir = target.data.velocity.lengthSq() > 0.0001
            ? target.data.velocity.clone().normalize()
            : new Vector3(0, 1, 0);
          const positions = telegraph.geometry.attributes.position.array as Float32Array;
          positions[0] = 0;
          positions[1] = 0;
          positions[2] = 0;
          positions[3] = vDir.x * 3;
          positions[4] = vDir.y * 3;
          positions[5] = vDir.z * 3;
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
        return shouldRender && chunk.spawnCursor < this.chunkObjectCount(chunk);
      })
      .sort((left, right) => this.chunkSpawnPriority(right, player) - this.chunkSpawnPriority(left, player));

    let remaining = spawnBudget;
    while (remaining > 0) {
      let spawnedAny = false;
      for (const chunk of candidates) {
        if (remaining <= 0 || chunk.spawnCursor >= this.chunkObjectCount(chunk)) {
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
    const frustum = buildFrustumFromSnapshot(this.getViewFrustumSnapshot());
    const box = new Box3(chunkRender.chunk.bounds.min.clone(), chunkRender.chunk.bounds.max.clone());
    const distance = box.distanceToPoint(player.position);
    const nearFogBoundary = distance <= fogCullingDistance();
    if (!frustum.intersectsBox(box) && !nearFogBoundary) {
      return false;
    }
    if (!this.fogEnabled) {
      return true;
    }
    return distance <= fogCullingDistance();
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
    const target = this.chunkObjectAt(chunkRender, chunkRender.spawnCursor);
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

  private chunkObjectCount(chunkRender: ChunkRenderGroup): number {
    return chunkRender.renderObstacles.length + chunkRender.chunk.loot.length + chunkRender.chunk.mines.length;
  }

  private chunkObjectAt(chunkRender: ChunkRenderGroup, index: number):
    | { kind: 'obstacle'; data: Obstacle }
    | { kind: 'loot'; data: Loot }
    | { kind: 'mine'; data: ChunkData['mines'][number] }
    | null {
    const chunk = chunkRender.chunk;
    if (index < chunkRender.renderObstacles.length) {
      return { kind: 'obstacle', data: chunkRender.renderObstacles[index] };
    }
    const lootIndex = index - chunkRender.renderObstacles.length;
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

  private updateCameraFocus(playerPosition: Vector3, forward: Vector3): void {
    const rearPoint = playerPosition.clone().addScaledVector(forward, -0.5);
    const frontPoint = playerPosition.clone().addScaledVector(forward, 5);
    const targetFocus = rearPoint.lerp(frontPoint, 0.5);
    const followBlend = 1 - Math.exp(-4 * GAME_CONFIG.camera.smoothness);
    this.cameraFocus.lerp(targetFocus, followBlend);
  }

  private buildMustSeePoints(player: PlayerState): { x: number; y: number; z: number }[] {
    const forward = { x: player.forward.x, y: player.forward.y, z: player.forward.z };
    const ship = { x: player.position.x, y: player.position.y, z: player.position.z };
    const worldAnchors = shipAnchorsToWorld(ship, forward, GAME_CONFIG.camera.shipViewAnchors as unknown as { x: number; y: number; z: number }[]);
    const external = this.externalFocusPoints.map(p => ({ x: p.x, y: p.y, z: p.z }));
    return [...worldAnchors, ...external];
  }

  private updateDebugVectors(player: PlayerState, predictor: ShipPredictor, chunks: Iterable<ChunkData>): void {
    this.debugVelocityRay.visible = this.debugEnabled;
    this.debugCameraRay.visible = this.debugEnabled;
    this.debugMineSegs.visible = this.debugEnabled;

    if (!this.debugEnabled) {
      return;
    }

    // Cyan: ship position → physics-predicted position in 1 second (accounts for drag + thrust).
    const predicted = predictor.predict(1.0);
    this.debugRenderer.updateDebugRay(this.debugVelocityRay, player.position, predicted);

    // Yellow: camera position → smoothed look-at target.
    this.debugRenderer.updateDebugRay(this.debugCameraRay, this.camera.position, this.cameraLookAt);

    // Red: for each non-dead mine — line from mine to its aim point (target or current pos).
    const minePairs: Array<[Vector3, Vector3]> = [];
    for (const chunk of chunks) {
      for (const mine of chunk.mines) {
        if (mine.state === 'dead') {
          continue;
        }
        if (mine.state === 'targeting' && mine.targetPosition) {
          minePairs.push([mine.position.clone(), mine.targetPosition.clone()]);
        } else if (mine.state === 'launched' || mine.state === 'rocket') {
          const ahead = mine.position.clone().addScaledVector(mine.velocity.clone().normalize(), 8);
          minePairs.push([mine.position.clone(), ahead]);
        } else {
          // idle — show trigger radius stub (short line pointing up as a marker)
          const top = mine.position.clone().addScalar(mine.triggerRadius * 0.5);
          top.x = mine.position.x;
          top.z = mine.position.z;
          minePairs.push([mine.position.clone(), top]);
        }
        if (minePairs.length >= 32) {
          break;
        }
      }
      if (minePairs.length >= 32) {
        break;
      }
    }
    this.debugRenderer.updateDebugSegments(this.debugMineSegs, minePairs);
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
      const visible =
        this.debugEnabled
        && this.chunkDebugEnabled
        && chunkDistance(currentCoord, chunk.coord) <= debugRadius;
      if (visible && !chunk.debug) {
        chunk.debug = this.debugRenderer.createChunkDebug(chunk.chunk);
        this.world.add(chunk.debug);
      }
      if (chunk.debug) {
        chunk.debug.visible = visible;
      }
    }
  }

  private setupLights(): void {
    this.scene.add(this.ambientLight);
    const keyLight = new DirectionalLight(new Color('#ffd7a6'), 1.95);
    keyLight.position.set(14, 18, 10);
    this.scene.add(keyLight);
    const rimLight = new DirectionalLight(new Color('#5dbef4'), 1.05);
    rimLight.position.set(-12, 8, -16);
    this.scene.add(rimLight);
  }

  private createFogPlane(): Mesh {
    const geo = new PlaneGeometry(8000, 8000);
    geo.rotateX(-Math.PI / 2);
    const mat = new ShaderMaterial({
      uniforms: {
        colorCenter: { value: new Color(GAME_CONFIG.visuals.fogPlaneColor) },
        colorEdge: { value: new Color(GAME_CONFIG.visuals.fogColor) },
        opacity: { value: GAME_CONFIG.visuals.fogPlaneOpacity },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 colorCenter;
        uniform vec3 colorEdge;
        uniform float opacity;
        varying vec2 vUv;
        void main() {
          vec2 centered = vUv * 2.0 - 1.0;
          float radial = clamp(length(centered), 0.0, 1.0);
          float glow = 1.0 - smoothstep(0.18, 1.0, radial);
          float alpha = glow * opacity;
          vec3 color = mix(colorEdge, colorCenter, glow);
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const mesh = new Mesh(geo, mat);
    mesh.position.y = GAME_CONFIG.world.spawn.y + 5;
    mesh.renderOrder = 1;
    return mesh;
  }

  private updateDepthVisuals(dangerLevel: number): void {
    const d = dangerLevel;
    this.sceneFog.color.set(new Color(GAME_CONFIG.visuals.fogColor).lerp(new Color(GAME_CONFIG.visuals.abyssFogColor), d));
    this.renderer.setClearColor(new Color(GAME_CONFIG.visuals.skyColor).lerp(new Color(GAME_CONFIG.visuals.abyssSkyColor), d));
    this.ambientLight.intensity = GAME_CONFIG.visuals.surfaceAmbientIntensity
      + (GAME_CONFIG.visuals.abyssAmbientIntensity - GAME_CONFIG.visuals.surfaceAmbientIntensity) * d;
    const skyMat = this.skySphere.material as ShaderMaterial;
    (skyMat.uniforms.colorTop.value as Color).copy(
      new Color(GAME_CONFIG.visuals.skyColor).lerp(new Color(GAME_CONFIG.visuals.abyssSkyColor), d),
    );
    (skyMat.uniforms.colorBottom.value as Color).copy(
      new Color(GAME_CONFIG.visuals.fogColor).lerp(new Color(GAME_CONFIG.visuals.abyssFogColor), d),
    );
    const fogPlaneMat = this.fogPlane.material as ShaderMaterial;
    (fogPlaneMat.uniforms.colorCenter.value as Color).copy(
      new Color(GAME_CONFIG.visuals.fogPlaneColor).lerp(new Color(GAME_CONFIG.visuals.fogColor), d * 0.75),
    );
    (fogPlaneMat.uniforms.colorEdge.value as Color).copy(
      new Color(GAME_CONFIG.visuals.fogColor).lerp(new Color(GAME_CONFIG.visuals.abyssFogColor), d),
    );
    fogPlaneMat.uniforms.opacity.value = GAME_CONFIG.visuals.fogPlaneOpacity * (1 - d * 0.55);
  }

  private createSkySphere(): Mesh {
    const geo = new SphereGeometry(9000, 8, 6);
    const mat = new ShaderMaterial({
      uniforms: {
        colorTop: { value: new Color(GAME_CONFIG.visuals.skyColor) },
        colorBottom: { value: new Color(GAME_CONFIG.visuals.fogColor) },
      },
      vertexShader: `
        varying float vY;
        void main() {
          vY = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 colorTop;
        uniform vec3 colorBottom;
        varying float vY;
        void main() {
          float t = smoothstep(-0.4, 0.5, vY);
          gl_FragColor = vec4(mix(colorBottom, colorTop, t), 1.0);
        }
      `,
      side: BackSide,
      depthWrite: false,
    });
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = -1;
    return mesh;
  }

  private setupPlayerMesh(): void {
    this.playerMesh.add(this.playerRadius);
    this.playerMesh.add(this.shipVisual);
    this.scene.add(this.playerMesh);
    this.loadShipModel();
  }

  private loadShipModel(): void {
    const base = import.meta.env.BASE_URL as string;
    const modelPath = `${base}models/speedboat/`;
    const mtlLoader = new MTLLoader();
    mtlLoader.setPath(modelPath);
    mtlLoader.load('speedboat.mtl', (materials) => {
      materials.preload();
      const objLoader = new OBJLoader();
      objLoader.setMaterials(materials);
      objLoader.setPath(modelPath);
      objLoader.load('speedboat.obj', (obj) => {
        // OBJ: nose at -Y, deck at -Z → Three.js forward=+Z, up=+Y.
        // Rx(+90°) Ry(180°): maps OBJ(x,y,z) → (-x, -z, -y).
        obj.rotation.x = Math.PI / 2;
        obj.rotation.y = Math.PI;
        obj.rotation.z = Math.PI;
        // Scale: OBJ Y range ≈ 442 units → target ~3.5 game units long.
        const scale = 3.5 / 442.5;
        obj.scale.setScalar(scale);
        // Center the model on the player origin.
        obj.updateMatrixWorld(true);
        const box = new Box3().setFromObject(obj);
        const center = new Vector3();
        box.getCenter(center);
        obj.position.sub(center);
        // Sit slightly below center so it doesn't clip camera rig.
        obj.position.y = 0.0;
        this.shipVisual.add(obj);
      });
    });
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

function disposeGroupMeshes(group: Group): void {
  group.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    object.geometry.dispose();
    if (Array.isArray(object.material)) {
      for (const material of object.material) {
        material.dispose();
      }
      return;
    }
    object.material.dispose();
  });
}
