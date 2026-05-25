import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { computeCameraRig, shipAnchorsToWorld, type Vec3 } from '../src/game/render/cameraRig';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function v(x: number, y: number, z: number): Vec3 { return { x, y, z }; }

/**
 * Project a world-space point through a Three.js camera and return its NDC
 * coordinates (range: -1..1, 0 = center, ±1 = edge of screen).
 */
function projectNDC(
  camera: PerspectiveCamera,
  point: Vec3,
): { ndcX: number; ndcY: number; depth: number } {
  const p = new Vector3(point.x, point.y, point.z);
  p.project(camera);
  return { ndcX: p.x, ndcY: p.y, depth: p.z };
}

/**
 * Build a camera from the rig output and verify that all mustSeePoints
 * have |NDC_x| and |NDC_y| ≤ (1 - margin).
 */
function assertAllVisible(
  cameraPos: Vec3,
  cameraLookAt: Vec3,
  mustSeePoints: Vec3[],
  fovDegrees: number,
  aspect: number,
  margin: number,
  label = '',
): void {
  const cam = new PerspectiveCamera(fovDegrees, aspect, 0.1, 10000);
  cam.position.set(cameraPos.x, cameraPos.y, cameraPos.z);
  cam.lookAt(cameraLookAt.x, cameraLookAt.y, cameraLookAt.z);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();

  for (let i = 0; i < mustSeePoints.length; i++) {
    const { ndcX, ndcY, depth } = projectNDC(cam, mustSeePoints[i]);
    const tag = `${label} point[${i}]`;
    expect(depth, `${tag} must be in front of camera (depth < 1)`).toBeLessThan(1);
    expect(Math.abs(ndcX), `${tag} NDC_x=${ndcX.toFixed(3)} must be ≤ ${(1 - margin).toFixed(2)}`).toBeLessThanOrEqual(1 - margin + 1e-4);
    expect(Math.abs(ndcY), `${tag} NDC_y=${ndcY.toFixed(3)} must be ≤ ${(1 - margin).toFixed(2)}`).toBeLessThanOrEqual(1 - margin + 1e-4);
  }
}

// ---------------------------------------------------------------------------
// computeCameraRig
// ---------------------------------------------------------------------------

describe('computeCameraRig', () => {
  const fov = 68;
  const aspect = 16 / 9;
  const margin = 0.12;

  it('returns base position when no points are provided', () => {
    const result = computeCameraRig({
      cameraLookAt: v(0, 0, 18),
      cameraBasePosition: v(0, 3.4, -8.5),
      mustSeePoints: [],
      fovDegrees: fov,
      aspect,
      viewMargin: margin,
    });
    expect(result.position.x).toBeCloseTo(0);
    expect(result.position.y).toBeCloseTo(3.4);
    expect(result.position.z).toBeCloseTo(-8.5);
  });

  it('does not reduce camera distance below base', () => {
    // Point at the lookAt position requires no extra distance
    const lookAt = v(0, 0, 18);
    const basePos = v(0, 3, -8);
    const result = computeCameraRig({
      cameraLookAt: lookAt,
      cameraBasePosition: basePos,
      mustSeePoints: [lookAt],
      fovDegrees: fov,
      aspect,
      viewMargin: margin,
    });
    const baseDist = Math.sqrt(
      (basePos.x - lookAt.x) ** 2 +
      (basePos.y - lookAt.y) ** 2 +
      (basePos.z - lookAt.z) ** 2,
    );
    const resultDist = Math.sqrt(
      (result.position.x - lookAt.x) ** 2 +
      (result.position.y - lookAt.y) ** 2 +
      (result.position.z - lookAt.z) ** 2,
    );
    expect(resultDist).toBeGreaterThanOrEqual(baseDist - 1e-4);
  });

  it('preserves the camera direction (only changes distance)', () => {
    const lookAt = v(0, 2, 18);
    const basePos = v(0, 10, -5);
    const pts = [v(5, 8, 0), v(-5, -3, 10)];
    const result = computeCameraRig({
      cameraLookAt: lookAt, cameraBasePosition: basePos,
      mustSeePoints: pts, fovDegrees: fov, aspect, viewMargin: margin,
    });
    // The direction from lookAt to result.position must equal the direction
    // from lookAt to basePos (only distance changes).
    const dirBase = {
      x: basePos.x - lookAt.x, y: basePos.y - lookAt.y, z: basePos.z - lookAt.z,
    };
    const dirResult = {
      x: result.position.x - lookAt.x,
      y: result.position.y - lookAt.y,
      z: result.position.z - lookAt.z,
    };
    const lenBase = Math.sqrt(dirBase.x ** 2 + dirBase.y ** 2 + dirBase.z ** 2);
    const lenResult = Math.sqrt(dirResult.x ** 2 + dirResult.y ** 2 + dirResult.z ** 2);
    // Normalised directions should match
    expect(dirResult.x / lenResult).toBeCloseTo(dirBase.x / lenBase, 4);
    expect(dirResult.y / lenResult).toBeCloseTo(dirBase.y / lenBase, 4);
    expect(dirResult.z / lenResult).toBeCloseTo(dirBase.z / lenBase, 4);
  });

  it('all mustSeePoints are within the frustum (straight-behind camera)', () => {
    // Camera directly behind ship along +Z, ship at origin, lookAt ahead
    const lookAt = v(0, 0, 18);
    const basePos = v(0, 3.4, -8.5); // behind and slightly above
    const shipAnchors = [v(0, 0, 0), v(0, 0, 2), v(0, 0, -2)]; // center, nose, tail
    const result = computeCameraRig({
      cameraLookAt: lookAt, cameraBasePosition: basePos,
      mustSeePoints: shipAnchors, fovDegrees: fov, aspect, viewMargin: margin,
    });
    assertAllVisible(result.position, lookAt, shipAnchors, fov, aspect, margin, 'straight-behind');
  });

  it('keeps ship visible when player presses down (steep upward pitch, camera above)', () => {
    // Simulate pressing "down" key: camera pitches to nearly overhead position.
    // cameraOffset = (0, 3.4, -8.5) rotated 1.15 rad around X (almost vertical)
    const pitchAngle = 1.15;
    const height = 3.4, dist = 8.5;
    const cosP = Math.cos(pitchAngle), sinP = Math.sin(pitchAngle);
    const oy = height * cosP + dist * sinP;  // ≈ 9.1 (camera mostly above)
    const oz = height * sinP - dist * cosP;  // ≈ 0.3

    const lookAt = v(0, 0, 18);
    const basePos = v(0, oy, oz);
    const shipAnchors = [v(0, 0, 0), v(0, 0, 2.5), v(0, 0, -1.5)]; // center, nose, tail

    const result = computeCameraRig({
      cameraLookAt: lookAt, cameraBasePosition: basePos,
      mustSeePoints: shipAnchors, fovDegrees: fov, aspect, viewMargin: margin,
    });

    assertAllVisible(result.position, lookAt, shipAnchors, fov, aspect, margin, 'steep-pitch');
  });

  it('zooms out to include an external focus point (e.g. boss)', () => {
    const lookAt = v(0, 0, 18);
    const basePos = v(0, 3.4, -8.5);
    const shipAnchors = [v(0, 0, 0), v(0, 0, 2)];
    // Boss far to the right
    const boss = v(40, 0, 10);
    const allPoints = [...shipAnchors, boss];

    const result = computeCameraRig({
      cameraLookAt: lookAt, cameraBasePosition: basePos,
      mustSeePoints: allPoints, fovDegrees: fov, aspect, viewMargin: margin,
    });

    assertAllVisible(result.position, lookAt, allPoints, fov, aspect, margin, 'boss-zoom-out');
  });

  it('with no external points, stays near base distance', () => {
    const lookAt = v(0, 0, 18);
    const basePos = v(0, 3.4, -8.5);
    // Anchors very close to origin (near ship center) should not force big pull-back
    const anchors = [v(0, 0, 0), v(0, 0.5, 1.2), v(0, -0.2, -0.8)];
    const result = computeCameraRig({
      cameraLookAt: lookAt, cameraBasePosition: basePos,
      mustSeePoints: anchors, fovDegrees: fov, aspect, viewMargin: margin,
    });
    const baseDist = Math.sqrt(
      (basePos.x - lookAt.x) ** 2 + (basePos.y - lookAt.y) ** 2 + (basePos.z - lookAt.z) ** 2,
    );
    const resultDist = Math.sqrt(
      (result.position.x - lookAt.x) ** 2 +
      (result.position.y - lookAt.y) ** 2 +
      (result.position.z - lookAt.z) ** 2,
    );
    // Should not need to zoom more than 2× base distance for tight ship anchors
    expect(resultDist).toBeLessThan(baseDist * 2);
    assertAllVisible(result.position, lookAt, anchors, fov, aspect, margin, 'no-external');
  });

  it('handles lateral offset of a wide external point (explosion left)', () => {
    const lookAt = v(0, 0, 18);
    const basePos = v(0, 3.4, -8.5);
    const explosion = v(-25, 5, 5); // far to the left and slightly above
    const anchors = [v(0, 0, 0), v(0, 0, 2), explosion];
    const result = computeCameraRig({
      cameraLookAt: lookAt, cameraBasePosition: basePos,
      mustSeePoints: anchors, fovDegrees: fov, aspect, viewMargin: margin,
    });
    assertAllVisible(result.position, lookAt, anchors, fov, aspect, margin, 'explosion-left');
  });
});

// ---------------------------------------------------------------------------
// shipAnchorsToWorld
// ---------------------------------------------------------------------------

describe('shipAnchorsToWorld', () => {
  it('identity: ship facing +Z, anchor at (0,0,1) → 1 unit ahead', () => {
    const world = shipAnchorsToWorld(v(10, 5, 0), v(0, 0, 1), [v(0, 0, 1)]);
    expect(world[0].x).toBeCloseTo(10);
    expect(world[0].y).toBeCloseTo(5);
    expect(world[0].z).toBeCloseTo(1);
  });

  it('ship facing +X, anchor at (0,0,1) → 1 unit in +X', () => {
    const world = shipAnchorsToWorld(v(0, 0, 0), v(1, 0, 0), [v(0, 0, 1)]);
    expect(world[0].x).toBeCloseTo(1);
    expect(world[0].y).toBeCloseTo(0);
    expect(world[0].z).toBeCloseTo(0);
  });

  it('transforms multiple anchors correctly', () => {
    const ship = v(5, 5, 5);
    const fwd = v(0, 0, 1); // +Z
    const nose = v(0, 0, 2);
    const tail = v(0, 0, -1.5);
    const world = shipAnchorsToWorld(ship, fwd, [nose, tail]);
    // nose: ship + 2 * fwd
    expect(world[0].z).toBeCloseTo(7);
    // tail: ship - 1.5 * fwd
    expect(world[1].z).toBeCloseTo(3.5);
  });
});
