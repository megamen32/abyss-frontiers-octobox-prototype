import { MathUtils, Quaternion, Vector3 } from 'three';

export const SHIP_BANK_MAX_DEG = 90;
const SHIP_BANK_MIN_SPEED = 0;
const SHIP_BANK_DRIFT_EXP = 1.35;
const SHIP_BANK_TURN_KICK_GAIN = 0.45;
const SHIP_BANK_TURN_KICK_MAX = 0.16;
const SHIP_BANK_RISE_RATE = 18;
const SHIP_BANK_FALL_RATE = 3.2;

export function updateShipBank(input: {
  velocity: Vector3;
  speed: number;
  orientation: Quaternion;
  previousBank: number;
  previousLateralDrift: number;
  dt: number;
}): { bank: number; lateralDrift: number } {
  const localVelocity = input.velocity.clone().applyQuaternion(input.orientation.clone().invert());
  const active = input.speed >= SHIP_BANK_MIN_SPEED;
  const lateralDrift = active && input.speed > 0.0001
    ? MathUtils.clamp(localVelocity.x / input.speed, -1, 1)
    : 0;

  const driftBank = active
    ? -Math.sign(lateralDrift) * Math.pow(Math.abs(lateralDrift), SHIP_BANK_DRIFT_EXP) * (SHIP_BANK_MAX_DEG * Math.PI / 180)
    : 0;
  const turnKick = active
    ? -Math.sign(lateralDrift - input.previousLateralDrift) * Math.min(
        Math.abs(lateralDrift - input.previousLateralDrift) * SHIP_BANK_TURN_KICK_GAIN,
        SHIP_BANK_TURN_KICK_MAX,
      )
    : 0;

  const targetBank = driftBank + turnKick;
  const bankRate = Math.abs(targetBank) > Math.abs(input.previousBank) ? SHIP_BANK_RISE_RATE : SHIP_BANK_FALL_RATE;
  const bank = MathUtils.lerp(input.previousBank, targetBank, 1 - Math.exp(-bankRate * input.dt));

  return { bank, lateralDrift };
}
