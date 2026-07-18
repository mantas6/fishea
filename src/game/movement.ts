// Pure movement math for the player fish (and later AI fish).
// Everything here works on plain {x, y, z} objects so it can be unit-tested
// in a plain node environment without importing Three.js / WebGL.

/** A plain 3D vector. The core geometric type shared across the game. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/** World bounds definition. */
export interface WorldBounds {
  radius: number
  seafloorY: number
  surfaceY: number
  fishFloorMargin: number
  fishSurfaceMargin: number
}

/** Tuning for the player's velocity model (thrust + water drag). */
export interface PlayerMotion {
  maxSpeed: number
  sprintMultiplier: number
  accelLambda: number
  dragLambda: number
}

// World bounds — kept here so gameplay + rendering agree on the play space.
export const WORLD: WorldBounds = {
  radius: 180, // max XZ distance from origin
  seafloorY: 0, // top of the sand
  surfaceY: 40, // water surface plane height
  fishFloorMargin: 2, // keep the fish this far above the sand
  fishSurfaceMargin: 2, // keep the fish this far below the surface
}

// Fish cannot pitch straight up/down — keeps orientation math sane.
export const MAX_PITCH = 1.2 // radians (~69 degrees)

// Tuning for the player's velocity model (thrust + water drag).
export const PLAYER_MOTION: PlayerMotion = {
  maxSpeed: 8, // base cruise speed (units/s)
  sprintMultiplier: 1.8, // sprint multiplies max speed
  accelLambda: 4, // how quickly velocity ramps toward the desired velocity
  dragLambda: 1.6, // how quickly velocity bleeds off when there's no input
}

// When the player pushes "backward" (a brake) forward speed bleeds off faster
// than passive drag by this factor.
export const BRAKE_DRAG_MULTIPLIER = 2.5

/**
 * Clamp a pitch angle (radians) to the allowed range.
 */
export function clampPitch(pitch: number, maxPitch = MAX_PITCH): number {
  if (pitch > maxPitch) return maxPitch
  if (pitch < -maxPitch) return -maxPitch
  return pitch
}

/**
 * Wrap a yaw angle into (-PI, PI].
 */
export function wrapAngle(yaw: number): number {
  const twoPi = Math.PI * 2
  let a = yaw % twoPi
  if (a <= -Math.PI) a += twoPi
  if (a > Math.PI) a -= twoPi
  return a
}

/**
 * Convert yaw/pitch into a unit direction vector.
 * yaw is rotation about the Y axis (0 => facing -Z), pitch tilts up/down.
 */
export function headingToDirection(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch)
  return {
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  }
}

/**
 * Horizontal "right" (strafe) unit vector for a given yaw.
 * At yaw 0 the fish faces -Z, so its right is +X.
 */
export function rightFromYaw(yaw: number): { x: number; z: number } {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) }
}

/**
 * Frame-rate independent exponential approach of a scalar toward a target.
 */
export function approach(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt)
}

/**
 * Step a velocity toward a desired velocity. Uses a faster rate while there's
 * input (thrust) and a slower rate when the desired velocity is zero (water
 * drag). Pure — returns a new object.
 */
export function stepVelocity(
  velocity: Vec3,
  desired: Vec3,
  opts: PlayerMotion = PLAYER_MOTION,
  dt = 0,
): Vec3 {
  const moving = desired.x !== 0 || desired.y !== 0 || desired.z !== 0
  const lambda = moving ? opts.accelLambda : opts.dragLambda
  return {
    x: approach(velocity.x, desired.x, lambda, dt),
    y: approach(velocity.y, desired.y, lambda, dt),
    z: approach(velocity.z, desired.z, lambda, dt),
  }
}

/** Result of clamping the forward axis: the safe move plus a brake flag. */
export interface ClampedForward {
  move: Vec3
  braking: boolean
}

/**
 * Fish can't swim in reverse. Clamp the forward axis so backward input
 * (move.z < 0) never produces reverse thrust; instead it flags a brake so the
 * caller can bleed off existing forward speed faster than passive drag.
 * Strafe (x) and vertical (y) are left untouched.
 */
export function clampForward(move: Vec3): ClampedForward {
  if (move.z < 0) {
    return { move: { x: move.x, y: move.y, z: 0 }, braking: true }
  }
  return { move, braking: false }
}

/**
 * Build the desired velocity from a normalized move vector and orientation.
 *  - move.z drives forward thrust along the full heading (includes pitch).
 *  - move.x strafes along the horizontal right vector.
 *  - move.y adds pure vertical thrust.
 */
export function desiredVelocity(move: Vec3, yaw: number, pitch: number, maxSpeed: number): Vec3 {
  const dir = headingToDirection(yaw, pitch)
  const right = rightFromYaw(yaw)
  return {
    x: (dir.x * move.z + right.x * move.x) * maxSpeed,
    y: (dir.y * move.z + move.y) * maxSpeed,
    z: (dir.z * move.z + right.z * move.x) * maxSpeed,
  }
}

/**
 * Integrate a position by a velocity over dt seconds. Pure — returns a new object.
 */
export function integrate(position: Vec3, velocity: Vec3, dt: number): Vec3 {
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
 */
export function clampToBounds(position: Vec3, bounds: WorldBounds = WORLD): Vec3 {
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
 */
export function isWithinBounds(position: Vec3, bounds: WorldBounds = WORLD): boolean {
  const minY = bounds.seafloorY + bounds.fishFloorMargin
  const maxY = bounds.surfaceY - bounds.fishSurfaceMargin
  if (position.y < minY || position.y > maxY) return false
  return Math.hypot(position.x, position.z) <= bounds.radius + 1e-9
}
