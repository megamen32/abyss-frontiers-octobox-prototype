import { Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import type { InputState, PlayerState } from '../types';
import { getRuntimeFlightTuning } from './runtimeTuning';
import { slerpVector } from './flightMath';

const UP = new Vector3(0, 1, 0);
const FALLBACK_RIGHT = new Vector3(1, 0, 0);

export function applyKeyboardSteering(player: PlayerState, input: InputState, dt: number): void {
  const tuning = getRuntimeFlightTuning();
  const yawDelta = input.right * tuning.turnInputSpeed * dt;
  const pitchDelta = input.forward * tuning.turnInputSpeed * dt * 0.8;

  if (Math.abs(yawDelta) > 0.0001 || Math.abs(pitchDelta) > 0.0001) {
    const right = new Vector3().crossVectors(UP, player.targetThrustForward).normalize();
    const pitchAxis = right.lengthSq() > 0.0001 ? right : FALLBACK_RIGHT;
    const localUp = new Vector3().crossVectors(player.targetThrustForward, pitchAxis).normalize();
    player.targetThrustForward.applyAxisAngle(localUp, yawDelta);
    const right2 = new Vector3().crossVectors(UP, player.targetThrustForward).normalize();
    const pitchAxis2 = right2.lengthSq() > 0.0001 ? right2 : FALLBACK_RIGHT;
    player.targetThrustForward.applyAxisAngle(pitchAxis2, -pitchDelta).normalize();
  } else {
    // No input — dampen the steering target back toward the actual thrust direction.
    // This prevents the ship from spinning freely after a turn is released.
    const dragBlend = 1 - Math.exp(-GAME_CONFIG.ship.steeringAngularDrag * dt);
    slerpVector(player.targetThrustForward, player.thrustForward, dragBlend);
  }
}
