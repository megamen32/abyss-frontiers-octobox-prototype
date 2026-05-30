import { MathUtils } from 'three';
import { GAME_CONFIG } from '../config';
import type { InputState } from '../types';

export interface RuntimeFlightTuning {
  baseAcceleration: number;
  baseDrag: number;
  turnInputSpeed: number;
}

const runtimeTuning: RuntimeFlightTuning = {
  baseAcceleration: GAME_CONFIG.ship.baseAcceleration,
  baseDrag: GAME_CONFIG.ship.baseDrag,
  turnInputSpeed: GAME_CONFIG.camera.keyboardYawSpeed,
};

export function getRuntimeFlightTuning(): RuntimeFlightTuning {
  return { ...runtimeTuning };
}

export function applyRuntimeTuning(input: InputState): RuntimeFlightTuning {
  runtimeTuning.baseAcceleration = MathUtils.clamp(
    runtimeTuning.baseAcceleration + input.accelerationAdjust * 0.5,
    0.1,
    40,
  );
  runtimeTuning.baseDrag = MathUtils.clamp(
    runtimeTuning.baseDrag + input.dragAdjust * 0.02,
    0.04,
    1.5,
  );
  runtimeTuning.turnInputSpeed = MathUtils.clamp(
    runtimeTuning.turnInputSpeed + input.turnAdjust * 0.1,
    0.4,
    4.2,
  );
  return getRuntimeFlightTuning();
}

export function resetRuntimeFlightTuning(): void {
  runtimeTuning.baseAcceleration = GAME_CONFIG.ship.baseAcceleration;
  runtimeTuning.baseDrag = GAME_CONFIG.ship.baseDrag;
  runtimeTuning.turnInputSpeed = GAME_CONFIG.camera.keyboardYawSpeed;
}
