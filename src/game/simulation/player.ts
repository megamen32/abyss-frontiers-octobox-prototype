import { MathUtils, Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { PlayerState } from '../types';
import { depthBelowSurface, depthProgress } from '../utils/depth';
import { angleBetweenVectors, clampLength, smoothstep, slerpVector } from './flightMath';
import { getRuntimeFlightTuning } from './runtimeTuning';

const SOFT_TURN_ANGLE = MathUtils.degToRad(GAME_CONFIG.ship.softTurnAngleDeg);
const STALL_ANGLE = MathUtils.degToRad(GAME_CONFIG.ship.stallAngleDeg);

export function createInitialPlayerState(): PlayerState {
  return {
    position: new Vector3(GAME_CONFIG.world.spawn.x, GAME_CONFIG.world.spawn.y, GAME_CONFIG.world.spawn.z),
    previousPosition: new Vector3(GAME_CONFIG.world.spawn.x, GAME_CONFIG.world.spawn.y, GAME_CONFIG.world.spawn.z),
    velocity: new Vector3(0, 0, GAME_CONFIG.ship.baseAcceleration * 0.35),
    forward: new Vector3(0, 0, 1),
    thrustForward: new Vector3(0, 0, 1),
    targetThrustForward: new Vector3(0, 0, 1),
    speed: GAME_CONFIG.ship.baseAcceleration * 0.35,
    stallAmount: 0,
    radius: GAME_CONFIG.ship.radius,
    hp: GAME_CONFIG.ship.hp,
    loot: 0,
    alive: true,
    invulnerabilityTimer: 0,
  };
}

export function updatePlayer(player: PlayerState, dt: number): void {
  player.previousPosition.copy(player.position);

  if (!player.alive) {
    player.velocity.multiplyScalar(Math.max(0, 1 - GAME_CONFIG.ship.baseDrag * 2.5 * dt));
    player.position.addScaledVector(player.velocity, dt);
    player.speed = player.velocity.length();
    return;
  }

  const steeringBlend = 1 - Math.exp(-GAME_CONFIG.ship.steeringResponsiveness * dt);
  slerpVector(player.thrustForward, player.targetThrustForward, steeringBlend);

  const tuning = getRuntimeFlightTuning();
  const baseAcceleration = accelerationAtDepth(player.position.y, tuning.baseAcceleration);
  const velocityDir = travelDirection(player);
  const turnAngle = angleBetweenVectors(velocityDir, player.thrustForward);
  const turnRatio = MathUtils.clamp(turnAngle / STALL_ANGLE, 0, 1);
  player.stallAmount = smoothstep(SOFT_TURN_ANGLE, STALL_ANGLE, turnAngle);

  const thrustEfficiency = MathUtils.lerp(1, GAME_CONFIG.ship.thrustEfficiencyAtFullStall, player.stallAmount);
  const speedRatio = MathUtils.clamp(player.velocity.length() / GAME_CONFIG.ship.maxSpeed, 0, 1);
  const speedLimitDrag = speedRatio > 0.8
    ? ((speedRatio - 0.8) / 0.2) ** 2 * GAME_CONFIG.ship.speedLimitExtraDrag
    : 0;
  const totalDrag = tuning.baseDrag
    + turnRatio * GAME_CONFIG.ship.turnDrag
    + player.stallAmount * GAME_CONFIG.ship.stallDrag
    + speedLimitDrag;

  player.velocity.addScaledVector(player.thrustForward, baseAcceleration * thrustEfficiency * dt);
  player.velocity.multiplyScalar(Math.max(0, 1 - totalDrag * dt));
  clampLength(player.velocity, GAME_CONFIG.ship.maxSpeed);

  player.speed = player.velocity.length();
  const desiredForward = player.speed > 0.0001 ? player.velocity.clone().normalize() : player.thrustForward;
  const visualTurnRate = MathUtils.lerp(
    GAME_CONFIG.ship.visualForwardTurnRateMax,
    GAME_CONFIG.ship.visualForwardTurnRateMin,
    MathUtils.clamp(player.speed / GAME_CONFIG.ship.maxSpeed, 0, 1),
  );
  const forwardError = angleBetweenVectors(player.forward, desiredForward);
  const recoveryTurnBoost = smoothstep(MathUtils.degToRad(18), Math.PI * 0.5, forwardError);
  const visualBlend = 1 - Math.exp(-(visualTurnRate + recoveryTurnBoost * 18) * dt);
  slerpVector(player.forward, desiredForward, visualBlend);

  player.position.addScaledVector(player.velocity, dt);
  player.invulnerabilityTimer = Math.max(0, player.invulnerabilityTimer - dt);
}

export function applyDamage(player: PlayerState, damage: number): void {
  if (!player.alive || player.invulnerabilityTimer > 0) {
    return;
  }
  player.hp = Math.max(0, player.hp - damage);
  player.invulnerabilityTimer = GAME_CONFIG.ship.hitInvulnerabilityTime;
  if (player.hp <= 0) {
    player.alive = false;
    player.velocity.multiplyScalar(0);
  }
}

export function alignPlayerToDirection(player: PlayerState, direction: Vector3, blend = 1): void {
  if (direction.lengthSq() <= 0.0001) {
    return;
  }

  const clampedBlend = MathUtils.clamp(blend, 0, 1);
  const normalizedDirection = direction.clone().normalize();
  slerpVector(player.forward, normalizedDirection, clampedBlend);
  slerpVector(player.thrustForward, normalizedDirection, clampedBlend);
  slerpVector(player.targetThrustForward, normalizedDirection, clampedBlend);
}

export function orientationFromLook(direction: Vector3): { yaw: number; pitch: number } {
  const planar = Math.sqrt(direction.x ** 2 + direction.z ** 2);
  return {
    yaw: Math.atan2(direction.x, direction.z),
    pitch: MathUtils.clamp(Math.atan2(direction.y, planar), -1.2, 1.2),
  };
}

export function travelDirection(player: PlayerState): Vector3 {
  if (player.velocity.lengthSq() > 0.0001) {
    return player.velocity.clone().normalize();
  }
  if (player.thrustForward.lengthSq() > 0.0001) {
    return player.thrustForward.clone().normalize();
  }
  return player.forward.clone().normalize();
}

function accelerationAtDepth(positionY: number, baseAcceleration: number): number {
  const depth = depthBelowSurface(positionY);
  const depthRatio = depthProgress(depth, GAME_CONFIG.world.depthDifficultyRamp);
  return baseAcceleration * MathUtils.lerp(1, 1 + GAME_CONFIG.ship.depthAccelerationScale, depthRatio);
}
