// Pure third-person camera math.
// Works on plain {x, y, z} objects so it can be unit-tested without Three.js.

import { headingToDirection } from './movement.js'

export const CAMERA_DEFAULTS = {
  distance: 9, // how far behind the fish
  height: 3, // how far above the fish
  lookAhead: 4, // how far in front of the fish to aim
  lambda: 4, // smoothing rate (higher = snappier)
}

/**
 * Frame-rate independent exponential damping toward a target scalar.
 * @param {number} current
 * @param {number} target
 * @param {number} lambda
 * @param {number} dt
 * @returns {number}
 */
export function damp(current, target, lambda, dt) {
  return target + (current - target) * Math.exp(-lambda * dt)
}

/**
 * Damp a {x,y,z} vector toward a target. Pure — returns a new object.
 * @param {{x:number,y:number,z:number}} current
 * @param {{x:number,y:number,z:number}} target
 * @param {number} lambda
 * @param {number} dt
 * @returns {{x:number,y:number,z:number}}
 */
export function dampVector(current, target, lambda, dt) {
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
 * @param {{x:number,y:number,z:number}} playerPos
 * @param {number} yaw
 * @param {number} pitch
 * @param {typeof CAMERA_DEFAULTS} [opts]
 * @returns {{position:{x:number,y:number,z:number},lookAt:{x:number,y:number,z:number}}}
 */
export function computeCameraTarget(playerPos, yaw, pitch, opts = CAMERA_DEFAULTS) {
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
