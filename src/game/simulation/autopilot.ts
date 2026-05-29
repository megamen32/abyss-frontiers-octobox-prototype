import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { ChunkData, InputState, PlayerState } from '../types';

const UP = new Vector3(0, 1, 0);
const _desired = new Vector3();
const _toTarget = new Vector3();
const _avoid = new Vector3();
const _right = new Vector3();
export class AutopilotBot {
  private enabled = false;
  private currentWaypoint: Vector3 | null = null;
  private waypointAge = 0;

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.currentWaypoint = null;
    }
    return this.enabled;
  }

  setEnabled(value: boolean): void {
    if (this.enabled === value) return;
    this.enabled = value;
    if (!this.enabled) {
      this.currentWaypoint = null;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  computeInput(
    player: PlayerState,
    activeChunks: Iterable<ChunkData>,
    dt: number,
  ): InputState | null {
    if (!this.enabled) return null;

    this.waypointAge += dt;
    const waypoint = this.pickWaypoint(player, activeChunks);
    if (!waypoint) {
      return { ...zeroInput() };
    }
    this.currentWaypoint = waypoint;

    _toTarget.copy(waypoint).sub(player.position);
    const dist = _toTarget.length();
    if (dist < 0.001) {
      return { ...zeroInput() };
    }
    _toTarget.divideScalar(dist);

    _avoid.set(0, 0, 0);
    this.avoidObstacles(player, activeChunks, _avoid);
    this.avoidMines(player, activeChunks, _avoid);

    _desired.copy(_toTarget).addScaledVector(_avoid, 1.0);
    _desired.normalize();

    _right.crossVectors(UP, player.targetThrustForward).normalize();
    const localRight = Math.max(-1, Math.min(1, _desired.dot(_right) * 2.5));
    const localUp = Math.max(-1, Math.min(1, _desired.dot(UP) * 2.5));

    const speed = player.speed;
    const slow = speed < GAME_CONFIG.ship.maxSpeed * 0.4;
    const boost = !slow && dist > 8 && Math.abs(localRight) < 0.6 && Math.abs(localUp) < 0.6;

    return {
      forward: localUp,
      right: -localRight,
      vertical: 0,
      boost,
      brake: false,
      accelerationAdjust: 0,
      dragAdjust: 0,
      turnAdjust: 0,
      restartPressed: false,
      debugTogglePressed: false,
      chunkDebugTogglePressed: false,
      fogTogglePressed: false,
      debugUiTogglePressed: false,
      pausePressed: false,
      autopilotTogglePressed: false,
      cameraYaw: 0,
    };
  }

  private pickWaypoint(player: PlayerState, chunks: Iterable<ChunkData>): Vector3 | null {
    if (this.currentWaypoint && this.waypointAge < 1.5) {
      return this.currentWaypoint;
    }
    this.waypointAge = 0;

    const vel = player.velocity;
    const velDir = vel.lengthSq() > 0.001 ? vel.clone().normalize() : player.forward.clone().normalize();
    let bestPortal: { center: Vector3; score: number } | null = null;

    for (const chunk of chunks) {
      if (chunk.isCaveChunk) continue;
      for (const portal of chunk.portals) {
        const portalCenter = portal.center;
        _toTarget.copy(portalCenter).sub(player.position);
        const dist = _toTarget.length();
        if (dist < 3) continue;
        _toTarget.divideScalar(dist);

        const alignment = _toTarget.dot(velDir);
        const depthBias = (player.position.y - portalCenter.y) * 0.002;
        const distancePenalty = dist > 40 ? (dist - 40) * 0.01 : 0;
        const score = alignment + depthBias - distancePenalty;

        if (!bestPortal || score > bestPortal.score) {
          bestPortal = { center: portalCenter, score };
        }
      }
    }

    if (!bestPortal) {
      const fallback = velDir.clone().multiplyScalar(30).add(player.position);
      return fallback;
    }

    return bestPortal.center;
  }

  private avoidObstacles(player: PlayerState, chunks: Iterable<ChunkData>, out: Vector3): void {
    const avoidRadius = 12;
    for (const chunk of chunks) {
      for (const obs of chunk.obstacles) {
        _toTarget.copy(player.position).sub(obs.position);
        const dist = _toTarget.length();
        if (dist > avoidRadius || dist < 0.1) continue;
        const strength = ((avoidRadius - dist) / avoidRadius) ** 2;
        _toTarget.divideScalar(dist);
        out.addScaledVector(_toTarget, strength * 3);
      }
    }
  }

  private avoidMines(player: PlayerState, chunks: Iterable<ChunkData>, out: Vector3): void {
    const avoidRadius = 20;
    for (const chunk of chunks) {
      for (const mine of chunk.mines) {
        if (mine.state === 'dead') continue;
        _toTarget.copy(player.position).sub(mine.position);
        const dist = _toTarget.length();
        if (dist > avoidRadius || dist < 0.1) continue;
        const urgency = mine.state === 'launched' || mine.state === 'rocket' ? 6 : 2;
        const strength = ((avoidRadius - dist) / avoidRadius) ** 2 * urgency;
        _toTarget.divideScalar(dist);
        out.addScaledVector(_toTarget, strength);
      }
    }
  }
}

function zeroInput(): InputState {
  return {
    forward: 0,
    right: 0,
    vertical: 0,
    boost: false,
    brake: false,
    accelerationAdjust: 0,
    dragAdjust: 0,
    turnAdjust: 0,
    restartPressed: false,
    debugTogglePressed: false,
    chunkDebugTogglePressed: false,
    fogTogglePressed: false,
    debugUiTogglePressed: false,
    pausePressed: false,
    autopilotTogglePressed: false,
    cameraYaw: 0,
  };
}
