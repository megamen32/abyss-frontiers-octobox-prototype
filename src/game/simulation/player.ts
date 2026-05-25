import { MathUtils, Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { CameraState, InputState, PlayerState } from '../types';

const UP = new Vector3(0, 1, 0);

export function createInitialPlayerState(): PlayerState {
  return {
    position: new Vector3(GAME_CONFIG.world.spawn.x, GAME_CONFIG.world.spawn.y, GAME_CONFIG.world.spawn.z),
    velocity: new Vector3(0, 0, GAME_CONFIG.ship.cruiseSpeed),
    lookDirection: new Vector3(0, 0, 1),
    speed: GAME_CONFIG.ship.cruiseSpeed,
    radius: GAME_CONFIG.ship.radius,
    hp: GAME_CONFIG.ship.hp,
    loot: 0,
    alive: true,
    invulnerabilityTimer: 0,
  };
}

export function updatePlayer(player: PlayerState, input: InputState, camera: CameraState, dt: number): void {
  if (!player.alive) {
    player.velocity.multiplyScalar(Math.max(0, 1 - dt * 6));
    return;
  }

  const cameraForward = new Vector3(
    Math.sin(camera.yaw) * Math.cos(camera.pitch),
    -Math.sin(camera.pitch),
    Math.cos(camera.yaw) * Math.cos(camera.pitch),
  ).normalize();
  const right = new Vector3().crossVectors(UP, cameraForward).normalize();
  const cameraUp = new Vector3().crossVectors(cameraForward, right).normalize();
  const desiredDirection = new Vector3()
    .addScaledVector(cameraForward, input.forward)
    .addScaledVector(right, input.right)
    .addScaledVector(cameraUp, input.vertical);

  const speedRatio = MathUtils.clamp(
    (player.speed - GAME_CONFIG.ship.cruiseSpeed) / (GAME_CONFIG.ship.boostSpeed - GAME_CONFIG.ship.cruiseSpeed),
    0,
    1,
  );
  const turnRate = MathUtils.lerp(GAME_CONFIG.ship.turnRateAtCruise, GAME_CONFIG.ship.turnRateAtBoost, speedRatio);
  const driftCorrection = MathUtils.lerp(
    GAME_CONFIG.ship.driftCorrectionAtCruise,
    GAME_CONFIG.ship.driftCorrectionAtBoost,
    speedRatio,
  );
  const targetSpeed = input.boost ? GAME_CONFIG.ship.boostSpeed : GAME_CONFIG.ship.cruiseSpeed;
  player.speed = MathUtils.damp(player.speed, targetSpeed, 3.8, dt);

  if (desiredDirection.lengthSq() > 0.0001) {
    desiredDirection.normalize();
    const turnBlend = 1 - Math.exp(-turnRate * dt);
    player.lookDirection.lerp(desiredDirection, turnBlend).normalize();
  } else if (player.velocity.lengthSq() > 0.1) {
    player.lookDirection.lerp(player.velocity.clone().normalize(), 1 - Math.exp(-driftCorrection * dt)).normalize();
  }

  const desiredVelocity = player.lookDirection.clone().multiplyScalar(player.speed);
  const driftBlend = 1 - Math.exp(-driftCorrection * dt);
  player.velocity.lerp(desiredVelocity, driftBlend);
  if (player.velocity.lengthSq() > 0) {
    const clampedSpeed = Math.max(player.velocity.length(), GAME_CONFIG.ship.minSpeedFloor);
    player.velocity.setLength(clampedSpeed);
    player.speed = clampedSpeed;
  }
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

export function orientationFromLook(direction: Vector3): { yaw: number; pitch: number } {
  const planar = Math.sqrt(direction.x ** 2 + direction.z ** 2);
  return {
    yaw: Math.atan2(direction.x, direction.z),
    pitch: MathUtils.clamp(Math.atan2(direction.y, planar), -1.2, 1.2),
  };
}
