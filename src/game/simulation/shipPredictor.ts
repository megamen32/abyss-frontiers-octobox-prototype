import { Vector3 } from 'three';
import type { PlayerState } from '../types';
import { getRuntimeFlightTuning } from './runtimeTuning';
import { depthBelowSurface, depthProgress } from '../utils/depth';
import { GAME_CONFIG } from '../config';

// Pre-sampled time horizons (seconds). Any t outside this range is clamped to the nearest boundary.
export const SAMPLE_TIMES = [0, 0.25, 0.5, 1.0, 2.0, 4.0, 7.0, 10.0] as const;

/**
 * Per-frame ship trajectory predictor.
 *
 * Uses the analytic solution to  dv/dt = a·thrust - drag·v :
 *   v(t) = (v₀ - v_terminal) · exp(-drag·t) + v_terminal
 *   x(t) = x₀ + (v₀ - v_terminal)/drag · (1 - exp(-drag·t)) + v_terminal · t
 *
 * Positions at SAMPLE_TIMES are computed once on construction; any other t is
 * found by linear interpolation — O(1) per call, no repeated exp() calls.
 *
 * Create one instance per simulation tick via ShipPredictor.forPlayer() and
 * share it across camera, mines, chunk manager, debug renderer.
 */
export class ShipPredictor {
  private readonly samples: Vector3[];

  private constructor(samples: Vector3[]) {
    this.samples = samples;
  }

  static forPlayer(player: PlayerState): ShipPredictor {
    const tuning = getRuntimeFlightTuning();

    const depth = depthBelowSurface(player.position.y);
    const depthRatio = depthProgress(depth, GAME_CONFIG.world.depthDifficultyRamp);
    const acceleration = tuning.baseAcceleration
      * (1 + GAME_CONFIG.ship.depthAccelerationScale * depthRatio);

    // Effective drag at current stall amount and speed — use the same formula as player.ts.
    const drag = Math.max(0.001, tuning.baseDrag + player.stallAmount * GAME_CONFIG.ship.stallDrag);

    // Terminal velocity: the velocity the ship would converge to with continuous thrust.
    const vTerminal = player.thrustForward.clone().multiplyScalar(acceleration / drag);
    const dv = player.velocity.clone().sub(vTerminal);

    const samples = SAMPLE_TIMES.map((t) => {
      if (t === 0) {
        return player.position.clone();
      }
      const expT = Math.exp(-drag * t);
      // x(t) = x₀ + dv/drag·(1 - exp(-drag·t)) + vTerminal·t
      return player.position.clone()
        .addScaledVector(dv, (1 - expT) / drag)
        .addScaledVector(vTerminal, t);
    });

    return new ShipPredictor(samples);
  }

  /**
   * Returns the predicted world position at time t seconds from now.
   * t is clamped to [0, SAMPLE_TIMES.last]. Result is linearly interpolated
   * between the two nearest pre-sampled horizons.
   */
  predict(t: number): Vector3 {
    const last = SAMPLE_TIMES[SAMPLE_TIMES.length - 1];
    const clamped = Math.max(0, Math.min(t, last));

    // Find the surrounding sample interval.
    let hi = 1;
    while (hi < SAMPLE_TIMES.length - 1 && SAMPLE_TIMES[hi] < clamped) {
      hi += 1;
    }
    const lo = hi - 1;
    const t0 = SAMPLE_TIMES[lo];
    const t1 = SAMPLE_TIMES[hi];
    const alpha = t1 > t0 ? (clamped - t0) / (t1 - t0) : 0;
    return this.samples[lo].clone().lerp(this.samples[hi], alpha);
  }

  /** Convenience: predicted velocity direction (unit vector) at time t. */
  predictDirection(t: number): Vector3 {
    const epsilon = 0.02;
    const ahead = this.predict(t + epsilon);
    const behind = this.predict(Math.max(0, t - epsilon));
    const dir = ahead.sub(behind);
    return dir.lengthSq() > 0.0001 ? dir.normalize() : new Vector3(0, 0, 1);
  }
}
