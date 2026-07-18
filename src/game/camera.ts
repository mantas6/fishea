// Pure third-person camera math.
// Works on plain {x, y, z} objects so it can be unit-tested without Three.js.

import { headingToDirection, wrapAngle, clampPitch } from './movement.js'
import type { Vec3 } from './movement.js'
import type { Vec2 } from './input/normalize.js'

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
 *
 * When an `orbit` offset is supplied the *position* orbits around the fish
 * using (heading + orbitYaw) and (pitch + orbitPitch), while the look-at target
 * still tracks the fish's actual heading so the fish stays framed. With a zero
 * (or omitted) offset the result is identical to the plain follow camera.
 */
export function computeCameraTarget(
  playerPos: Vec3,
  yaw: number,
  pitch: number,
  opts: CameraOptions = CAMERA_DEFAULTS,
  orbit: OrbitOffset = ZERO_ORBIT_OFFSET,
): { position: Vec3; lookAt: Vec3 } {
  // Heading the fish actually faces — drives where we look.
  const dir = headingToDirection(yaw, pitch)
  // Orbit-adjusted heading — drives where the camera sits.
  const posDir = headingToDirection(yaw + orbit.yaw, pitch + orbit.pitch)

  // Position: move opposite the (orbit-adjusted) heading (behind) and lift up.
  const position = {
    x: playerPos.x - posDir.x * opts.distance,
    y: playerPos.y - posDir.y * opts.distance + opts.height,
    z: playerPos.z - posDir.z * opts.distance,
  }

  // Look slightly ahead of the fish for a nicer chase feel.
  const lookAt = {
    x: playerPos.x + dir.x * opts.lookAhead,
    y: playerPos.y + dir.y * opts.lookAhead,
    z: playerPos.z + dir.z * opts.lookAhead,
  }

  return { position, lookAt }
}

// --- Idle orbit camera --------------------------------------------------
// When the player stops swimming, look input should orbit the camera around
// the fish instead of steering it. The state + decision logic below is pure so
// it can be unit-tested; Game.ts owns the single mutable instance.

/** A yaw/pitch offset (radians) applied to the follow camera when orbiting. */
export interface OrbitOffset {
  yaw: number
  pitch: number
}

const ZERO_ORBIT_OFFSET: OrbitOffset = { yaw: 0, pitch: 0 }

/** Full orbit state: the current offsets plus the mode flag. */
export interface OrbitState {
  /** Accumulated yaw offset from the fish heading (wrapped to (-π, π]). */
  yaw: number
  /** Accumulated pitch offset from the fish heading (clamped ±pitchClamp). */
  pitch: number
  /** Whether the camera is currently in orbit mode (idle look). */
  orbiting: boolean
}

/** Tuning for the idle-orbit behavior. */
export interface OrbitOptions {
  /** Movement magnitude at/below this counts as "not moving" (orbit). */
  moveEpsilon: number
  /** Max absolute orbit pitch offset (radians). */
  pitchClamp: number
  /** Exp-damp rate at which offsets decay back to zero in follow mode. */
  decayLambda: number
}

export const ORBIT_DEFAULTS: OrbitOptions = {
  moveEpsilon: 0.05,
  pitchClamp: 1.2,
  decayLambda: 4,
}

/** A fresh, neutral orbit state (follow mode, no offset). */
export function createOrbitState(): OrbitState {
  return { yaw: 0, pitch: 0, orbiting: false }
}

/**
 * Advance the orbit state one frame. Pure — returns a new state.
 *
 *  - `moveMag` is the magnitude of the movement input this frame.
 *  - `look` is the per-frame look delta (radians) — the SAME value that would
 *    otherwise steer the fish.
 *
 * Decision: any movement input (above `moveEpsilon`) is follow mode; no
 * movement input is orbit mode. The switch is instant in BOTH directions so the
 * moment the player stops swimming, look immediately orbits the camera instead
 * of steering the fish (and the moment they move again, steering resumes). A
 * time-based enter delay is deliberately avoided: during such a delay look
 * would keep steering the stationary fish, which is exactly the behavior this
 * feature must prevent.
 *
 * While orbiting, look accumulates into the offsets (yaw wraps, pitch clamps)
 * and does NOT steer the fish; in follow mode the offsets decay back to zero so
 * the camera glides smoothly behind the fish again.
 */
export function updateOrbitState(
  state: OrbitState,
  moveMag: number,
  look: Vec2,
  dt: number,
  opts: OrbitOptions = ORBIT_DEFAULTS,
): OrbitState {
  // No movement input => orbit the stationary fish; any movement => follow.
  const orbiting = moveMag <= opts.moveEpsilon

  let yaw = state.yaw
  let pitch = state.pitch
  if (orbiting) {
    // Accumulate look into the offsets (yaw wraps, pitch clamps).
    yaw = wrapAngle(yaw + look.x)
    pitch = clampPitch(pitch + look.y, opts.pitchClamp)
  } else {
    // Glide the camera back behind the fish (frame-rate independent decay).
    const f = Math.exp(-opts.decayLambda * dt)
    yaw = wrapAngle(yaw) * f
    pitch = pitch * f
  }

  return { yaw, pitch, orbiting }
}
