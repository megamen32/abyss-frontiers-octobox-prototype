import { MathUtils, Quaternion, Vector3 } from 'three';

const IDENTITY_QUATERNION = new Quaternion();
const TMP_QUATERNION = new Quaternion();
const TMP_AXIS = new Vector3();

export function angleBetweenVectors(a: Vector3, b: Vector3): number {
  if (a.lengthSq() <= 0.000001 || b.lengthSq() <= 0.000001) {
    return 0;
  }
  return a.angleTo(b);
}

export function clampLength(vector: Vector3, maxLength: number): Vector3 {
  if (vector.lengthSq() <= maxLength * maxLength) {
    return vector;
  }
  return vector.setLength(maxLength);
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) {
    return value >= edge1 ? 1 : 0;
  }
  const t = MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function slerpVector(current: Vector3, target: Vector3, blend: number): Vector3 {
  if (current.lengthSq() <= 0.000001) {
    return current.copy(target).normalize();
  }
  if (target.lengthSq() <= 0.000001) {
    return current;
  }
  const normalizedCurrent = current.clone().normalize();
  const normalizedTarget = target.clone().normalize();
  const angle = normalizedCurrent.angleTo(normalizedTarget);
  if (angle <= 0.000001) {
    return current.copy(normalizedTarget);
  }
  TMP_AXIS.crossVectors(normalizedCurrent, normalizedTarget);
  if (TMP_AXIS.lengthSq() <= 0.000001) {
    return current.copy(normalizedCurrent.lerp(normalizedTarget, blend).normalize());
  }
  TMP_AXIS.normalize();
  TMP_QUATERNION.copy(IDENTITY_QUATERNION).setFromAxisAngle(TMP_AXIS, angle * MathUtils.clamp(blend, 0, 1));
  return current.copy(normalizedCurrent.applyQuaternion(TMP_QUATERNION).normalize());
}
