import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { updateShipBank } from '../src/game/render/shipBank';

describe('updateShipBank', () => {
  it('keeps bank near zero at low speed when turning from rest', () => {
    const result = updateShipBank({
      velocity: new Vector3(0.3, 0, 0.6),
      speed: 0.67,
      orientation: new Quaternion(),
      previousBank: 0,
      previousLateralDrift: 0,
      dt: 1 / 60,
    });

    expect(Math.abs(result.bank)).toBeLessThan(0.01);
  });

  it('banks into drift once the ship is moving fast enough', () => {
    const result = updateShipBank({
      velocity: new Vector3(6, 0, 6),
      speed: Math.sqrt(72),
      orientation: new Quaternion(),
      previousBank: 0,
      previousLateralDrift: 0,
      dt: 1 / 60,
    });

    expect(Math.abs(result.bank)).toBeGreaterThan(0.01);
  });
});
