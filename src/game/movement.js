// Pure movement math for the player fish (and later AI fish).
// Everything here works on plain {x, y, z} objects so it can be unit-tested
// in a plain node environment without importing Three.js / WebGL.

// World bounds — kept here so gameplay + rendering agree on the play space.
export const WORLD = {
  radius: 180, // max XZ distance from origin
  seafloorY: 0, // top of the sand
  surfaceY: 40, // water surface plane height
  fishFloorMargin: 2, // keep the fish this far above the sand
  fishSurfaceMargin: 2, // keep the fish this far below the surface
}

// Fish cannot pitch straight up/down — keeps orientation math sane.
export const MAX_PITCH = 1.2 // radians (~69 degrees)

/**
 * Clamp a pitch angle (radians) to the allowed range.
 * @param {number} pitch
 * @param {number} [maxPitch]
 * @returns {number}
 */
export function clampPitch(pitch, maxPitch = MAX_PITCH) {
  if (pitch > maxPitch) return maxPitch
  if (pitch < -maxPitch) return -maxPitch
  return pitch
}

/**
 * Wrap a yaw angle into (-PI, PI].
 * @param {number} yaw
 * @returns {number}
 */
export function wrapAngle(yaw) {
  const twoPi = Math.PI * 2
  let a = yaw % twoPi
  if (a <= -Math.PI) a += twoPi
  if (a > Math.PI) a -= twoPi
  return a
}

/**
 * Convert yaw/pitch into a unit direction vector.
 * yaw is rotation about the Y axis (0 => facing -Z), pitch tilts up/down.
 * @param {number} yaw
 * @param {number} pitch
 * @returns {{x:number,y:number,z:number}}
 */
export function headingToDirection(yaw, pitch) {
  const cosPitch = Math.cos(pitch)
  return {
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  }
}

/**
 * Integrate a position by a velocity over dt seconds. Pure — returns a new object.
 * @param {{x:number,y:number,z:number}} position
 * @param {{x:number,y:number,z:number}} velocity
 * @param {number} dt
 * @returns {{x:number,y:number,z:number}}
 */
export function integrate(position, velocity, dt) {
  return {
    x: position.x + velocity.x * dt,
    y: position.y + velocity.y * dt,
    z: position.z + velocity.z * dt,
  }
}

/**
 * Clamp a position so the fish stays inside the play volume:
 *  - y between (seafloorY + margin) and (surfaceY - margin)
 *  - XZ radial distance <= radius
 * Pure — returns a new clamped object.
 * @param {{x:number,y:number,z:number}} position
 * @param {typeof WORLD} [bounds]
 * @returns {{x:number,y:number,z:number}}
 */
export function clampToBounds(position, bounds = WORLD) {
  const minY = bounds.seafloorY + bounds.fishFloorMargin
  const maxY = bounds.surfaceY - bounds.fishSurfaceMargin

  let { x, y, z } = position
  if (y < minY) y = minY
  if (y > maxY) y = maxY

  const dist = Math.hypot(x, z)
  if (dist > bounds.radius && dist > 0) {
    const scale = bounds.radius / dist
    x *= scale
    z *= scale
  }

  return { x, y, z }
}

/**
 * Returns true when a position is within the play volume (inclusive).
 * @param {{x:number,y:number,z:number}} position
 * @param {typeof WORLD} [bounds]
 * @returns {boolean}
 */
export function isWithinBounds(position, bounds = WORLD) {
  const minY = bounds.seafloorY + bounds.fishFloorMargin
  const maxY = bounds.surfaceY - bounds.fishSurfaceMargin
  if (position.y < minY || position.y > maxY) return false
  return Math.hypot(position.x, position.z) <= bounds.radius + 1e-9
}
