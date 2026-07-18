// Pure third-person camera math.
// Works on plain {x, y, z} objects so it can be unit-tested without Three.js.

import { headingToDirection } from './movement.js'
import type { Vec3 } from './movement.js'

/** Third-person camera tuning. */
export interface CameraOptions {
  distance: number
  height: number
  lookAhead: number
  lambda: number
}

export const CAMERA_DEFAULTS: CameraOptions = {
  distance: 9, // how far behind the fish
  height: 3, // how far above the fish
  lookAhead: 4, // how far in front of the fish to aim
  lambda: 4, // smoothing rate (higher = snappier)
}

/**
 * Frame-rate independent exponential damping toward a target scalar.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt)
}

/**
 * Damp a {x,y,z} vector toward a target. Pure — returns a new object.
 */
export function dampVector(current: Vec3, target: Vec3, lambda: number, dt: number): Vec3 {
  return {
    x: damp(current.x, target.x, lambda, dt),
    y: damp(current.y, target.y, lambda, dt),
    z: damp(current.z, target.z, lambda, dt),
  }
}

/**
 * Compute the ideal (un-smoothed) camera position + look-at target for a fish.
 * The camera sits behind and above the fish along its heading and looks a bit
 * ahead of it.
 */
export function computeCameraTarget(
  playerPos: Vec3,
  yaw: number,
  pitch: number,
  opts: CameraOptions = CAMERA_DEFAULTS,
): { position: Vec3; lookAt: Vec3 } {
  const dir = headingToDirection(yaw, pitch)

  // Position: move opposite the heading (behind) and lift up.
  const position = {
    x: playerPos.x - dir.x * opts.distance,
    y: playerPos.y - dir.y * opts.distance + opts.height,
    z: playerPos.z - dir.z * opts.distance,
  }

  // Look slightly ahead of the fish for a nicer chase feel.
  const lookAt = {
    x: playerPos.x + dir.x * opts.lookAhead,
    y: playerPos.y + dir.y * opts.lookAhead,
    z: playerPos.z + dir.z * opts.lookAhead,
  }

  return { position, lookAt }
}
