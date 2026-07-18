import * as THREE from 'three'
import { dampFactor } from './movement.js'
import type { Vec3 } from './movement.js'

// Frame-rate independent orientation damping for entity containers.
//
// Setting object3d.lookAt(dir) every frame snaps the mesh whenever the target
// direction jumps (AI mode changes, noisy velocities). Instead we slerp the
// quaternion toward the target orientation with an exp-based blend factor so
// the turn is smooth and independent of frame rate.

// Reusable scratch objects — this code is single-threaded so sharing is safe.
const _matrix = new THREE.Matrix4()
const _targetQuat = new THREE.Quaternion()
const _eye = new THREE.Vector3()
const _origin = new THREE.Vector3(0, 0, 0)
const _up = new THREE.Vector3(0, 1, 0)

// Directions shorter than this are treated as "no meaningful heading" and skip
// reorientation, so near-zero / noisy velocities can't jitter the mesh.
export const ORIENT_MIN_DIR = 1e-4

/**
 * Compute the quaternion that makes an Object3D's +Z axis point along `dir`
 * (matching Object3D.lookAt semantics for non-camera objects). Writes into and
 * returns `out`, or null when `dir` is ~zero-length.
 */
export function targetOrientation(dir: Vec3, out: THREE.Quaternion): THREE.Quaternion | null {
  const len = Math.hypot(dir.x, dir.y, dir.z)
  if (len < ORIENT_MIN_DIR) return null
  _eye.set(dir.x, dir.y, dir.z)
  // Object3D.lookAt uses Matrix4.lookAt(target, position, up) for non-cameras,
  // giving +Z = normalize(eye - origin) = dir.
  _matrix.lookAt(_eye, _origin, _up)
  out.setFromRotationMatrix(_matrix)
  return out
}

/**
 * Damp an object's orientation toward facing `dir` along its +Z axis.
 * Skips ~zero directions (keeps the current orientation). When `instant` is
 * true (or dt <= 0) it snaps — used on spawn / reset.
 */
export function dampOrientation(
  object3d: THREE.Object3D,
  dir: Vec3,
  lambda: number,
  dt: number,
  instant = false,
): void {
  const target = targetOrientation(dir, _targetQuat)
  if (!target) return
  if (instant || dt <= 0) {
    object3d.quaternion.copy(target)
    return
  }
  object3d.quaternion.slerp(target, dampFactor(lambda, dt))
}
