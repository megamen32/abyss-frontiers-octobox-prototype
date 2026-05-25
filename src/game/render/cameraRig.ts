export interface Vec3 { x: number; y: number; z: number }

export interface CameraRigInput {
  /** Actual camera.lookAt() target in world space */
  cameraLookAt: Vec3;
  /** Initial/desired camera world position (before distance adjustment) */
  cameraBasePosition: Vec3;
  /** World-space points that must all be visible in the camera frustum */
  mustSeePoints: Vec3[];
  fovDegrees: number;
  aspect: number;
  /** Safety margin as fraction of half-FOV, e.g. 0.12 keeps points 12% away from edges */
  viewMargin?: number;
}

export interface CameraRigOutput {
  /** Camera world position that frames all mustSeePoints */
  position: Vec3;
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
function lenSq(v: Vec3): number {
  return dot(v, v);
}
function len(v: Vec3): number {
  return Math.sqrt(lenSq(v));
}
function normalize(v: Vec3): Vec3 {
  const l = len(v);
  if (l < 1e-9) return { x: 0, y: 0, z: 1 };
  return scale(v, 1 / l);
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Build camera orthonormal basis (right, up, forward) from the direction
 * pointing FROM the lookAt target TOWARD the camera (i.e. -cameraForward).
 */
function cameraBasis(toCamera: Vec3): { right: Vec3; up: Vec3; forward: Vec3 } {
  const forward = normalize(scale(toCamera, -1)); // camera forward = toward lookAt
  const ref: Vec3 = Math.abs(dot(forward, { x: 0, y: 1, z: 0 })) > 0.999
    ? { x: 1, y: 0, z: 0 }
    : { x: 0, y: 1, z: 0 };
  // In a right-handed system, cross(forward, ref) gives the right-hand side when
  // the camera forward is in the -Z half-space (standard Three.js convention).
  // For cameras rotated into other orientations the same formula stays consistent.
  const right = normalize(cross(forward, ref));
  const up = normalize(cross(right, forward));
  return { right, up, forward };
}

/**
 * Given a fixed camera.lookAt() target and an initial camera position, return
 * a (possibly pulled-back) camera position that guarantees every point in
 * mustSeePoints projects within the view frustum with the requested margin.
 *
 * The camera's pointing direction is preserved — only the distance from the
 * lookAt is increased when needed.
 */
export function computeCameraRig(input: CameraRigInput): CameraRigOutput {
  const { cameraLookAt, cameraBasePosition, mustSeePoints, fovDegrees, aspect } = input;
  const viewMargin = input.viewMargin ?? 0.12;

  if (mustSeePoints.length === 0) {
    return { position: cameraBasePosition };
  }

  const toCamera = sub(cameraBasePosition, cameraLookAt);
  const baseDistance = len(toCamera);
  if (baseDistance < 1e-6) {
    return { position: cameraBasePosition };
  }

  const camDir = normalize(toCamera); // unit vector: from lookAt toward camera
  const { right, up } = cameraBasis(camDir);

  const halfFovY = (fovDegrees * Math.PI / 180) / 2;
  const halfFovX = Math.atan(Math.tan(halfFovY) * aspect);
  // Shrink effective FOV by margin so points stay away from edges
  const tanX = Math.tan(halfFovX * (1 - viewMargin));
  const tanY = Math.tan(halfFovY * (1 - viewMargin));

  let minDist = baseDistance;

  for (const p of mustSeePoints) {
    // q = offset of point from the camera's lookAt pivot
    const q = sub(p, cameraLookAt);
    // qd: component along camDir (positive = point is on the camera side of lookAt)
    const qd = dot(q, camDir);
    // lateral components in the camera's image plane
    const qx = dot(q, right);
    const qy = dot(q, up);
    // Required distance so that point stays within the effective frustum:
    //   NDC_x = qx / (dist - qd) / tanX  ≤ 1  →  dist ≥ |qx|/tanX + qd
    const requiredForX = tanX > 0 ? Math.abs(qx) / tanX + qd : qd;
    const requiredForY = tanY > 0 ? Math.abs(qy) / tanY + qd : qd;
    minDist = Math.max(minDist, requiredForX, requiredForY);
  }

  return { position: add(cameraLookAt, scale(camDir, minDist)) };
}

/**
 * Transform ship-local anchor offsets to world space.
 * shipForward must be a unit vector.
 */
export function shipAnchorsToWorld(
  shipPosition: Vec3,
  shipForward: Vec3,
  anchors: Vec3[],
): Vec3[] {
  const fwd = normalize(shipForward);
  const worldUp: Vec3 = Math.abs(dot(fwd, { x: 0, y: 1, z: 0 })) > 0.9
    ? { x: 1, y: 0, z: 0 }
    : { x: 0, y: 1, z: 0 };
  const right = normalize(cross(fwd, worldUp));
  const up = normalize(cross(right, fwd));

  return anchors.map(a => add(
    add(
      add(shipPosition, scale(right, a.x)),
      scale(up, a.y),
    ),
    scale(fwd, a.z),
  ));
}
