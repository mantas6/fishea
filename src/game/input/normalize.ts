// Pure, testable input math. NO DOM / event / navigator access lives here so
// this module can be unit-tested in a plain node environment. The stateful
// listener code (keyboard.js, mouse.js, gamepad.js) feeds raw readings into
// these helpers and the InputManager merges the results.

import type { Vec3 } from '../movement.js'

/** A plain 2D vector (mouse/stick deltas, look deltas). */
export interface Vec2 {
  x: number
  y: number
}

/** Which input device most recently drove the game. */
export type ActiveSource = 'gamepad' | 'keyboard-mouse'

/** A single input source's contribution for one frame (device-agnostic). */
export interface SourceState {
  move: Vec3
  look: Vec2
  sprint: boolean
  bite: boolean
}

/** The merged, per-frame input state consumed by gameplay. */
export interface NormalizedInputState extends SourceState {
  activeSource: ActiveSource
}

/** Semantic keyboard state for a frame. */
export interface KeyState {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  sprint: boolean
  // Arrow keys drive the camera (an alternative to mouse look).
  lookLeft: boolean
  lookRight: boolean
  lookUp: boolean
  lookDown: boolean
}

// Default analog stick / trigger deadzone.
export const DEADZONE = 0.15

// How fast the gamepad right stick turns the view (radians/second at full tilt).
export const GAMEPAD_LOOK_SPEED = 2.6

// How fast the arrow keys turn the view (radians/second while held).
export const KEYBOARD_LOOK_YAW_SPEED = 2.0
export const KEYBOARD_LOOK_PITCH_SPEED = 1.2

// Standard-mapping PS4 (DualShock) button indices we care about.
export const GAMEPAD_BUTTONS: Record<string, number> = {
  BITE: 0, // Cross (X)
  BITE_ALT: 2, // Square
  SPRINT: 4, // L1
  UP: 5, // R1 — swim up
  DOWN: 6, // L2 — swim down
  SPRINT_ALT: 7, // R2
  DPAD_UP: 12, // D-pad up — swim up (alt)
  DPAD_DOWN: 13, // D-pad down — swim down (alt)
}

/** A neutral (no-input) normalized source state. */
export function neutralState(): SourceState {
  return {
    move: { x: 0, y: 0, z: 0 },
    look: { x: 0, y: 0 },
    sprint: false,
    bite: false,
  }
}

/**
 * Apply a 1D deadzone with rescaling so output ramps 0..1 past the threshold.
 */
export function applyDeadzone(value: number, deadzone = DEADZONE): number {
  const mag = Math.abs(value)
  if (mag <= deadzone) return 0
  const sign = value < 0 ? -1 : 1
  const scaled = (mag - deadzone) / (1 - deadzone)
  return sign * Math.min(scaled, 1)
}

/**
 * Radial deadzone for a 2-axis analog stick. Preserves direction while
 * rescaling magnitude past the deadzone. Returns a vector with |v| in 0..1.
 */
export function applyStickDeadzone(x: number, y: number, deadzone = DEADZONE): Vec2 {
  const mag = Math.hypot(x, y)
  if (mag <= deadzone) return { x: 0, y: 0 }
  const scaled = Math.min((mag - deadzone) / (1 - deadzone), 1)
  const k = scaled / mag
  return { x: x * k, y: y * k }
}

/**
 * Turn discrete key booleans into a move vector.
 *  - x: strafe (right positive)
 *  - y: vertical (up positive)
 *  - z: forward (positive positive)
 * Horizontal (x,z) is clamped to unit length so diagonals aren't faster.
 */
export function keysToMove(keys: Partial<KeyState> = {}): Vec3 {
  let x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
  let z = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0)
  const y = (keys.up ? 1 : 0) - (keys.down ? 1 : 0)
  const h = Math.hypot(x, z)
  if (h > 1) {
    x /= h
    z /= h
  }
  return { x, y, z }
}

/**
 * Convert a deadzoned left-stick reading (+ vertical bools) into a move vector.
 * Pushing the stick up (negative axis Y) is forward.
 */
export function stickToMove(
  leftStick: Vec2,
  vertical: { up?: boolean; down?: boolean } = {},
): Vec3 {
  return {
    x: leftStick.x,
    y: (vertical.up ? 1 : 0) - (vertical.down ? 1 : 0),
    z: -leftStick.y,
  }
}

/**
 * Convert a deadzoned right-stick reading into per-frame look deltas (radians).
 * Stick-right turns right (yaw decreases); stick-up looks up (pitch increases).
 */
export function stickToLook(rightStick: Vec2, dt: number, speed = GAMEPAD_LOOK_SPEED): Vec2 {
  return {
    x: -rightStick.x * speed * dt,
    y: -rightStick.y * speed * dt,
  }
}

/**
 * Convert held arrow keys into per-frame look deltas (radians), matching the
 * right-stick sign convention (yaw 0 faces -Z):
 *   Left  -> turn left  (yaw increases, +x)   Right -> turn right (-x)
 *   Up    -> look up     (pitch increases, +y)  Down  -> look down  (-y)
 * Scaled by dt so the turn rate is frame-rate independent.
 */
export function keysToLook(
  keys: Partial<KeyState> = {},
  dt: number,
  yawSpeed = KEYBOARD_LOOK_YAW_SPEED,
  pitchSpeed = KEYBOARD_LOOK_PITCH_SPEED,
): Vec2 {
  const x = ((keys.lookLeft ? 1 : 0) - (keys.lookRight ? 1 : 0)) * yawSpeed * dt
  const y = ((keys.lookUp ? 1 : 0) - (keys.lookDown ? 1 : 0)) * pitchSpeed * dt
  return { x, y }
}

/**
 * Does a normalized source state carry any meaningful input?
 * (Deadzones already zero small analog noise, so any nonzero value counts.)
 */
export function hasInputActivity(state: SourceState | null | undefined, threshold = 1e-4): boolean {
  if (!state) return false
  if (state.sprint || state.bite) return true
  const { move, look } = state
  if (move && (Math.abs(move.x) > threshold || Math.abs(move.y) > threshold || Math.abs(move.z) > threshold)) {
    return true
  }
  if (look && (Math.abs(look.x) > threshold || Math.abs(look.y) > threshold)) {
    return true
  }
  return false
}

/**
 * Merge the two input sources into one normalized state, applying the
 * gamepad-priority rule. When neither source is active the previous
 * ("latched") source is retained so the HUD can keep showing the last device.
 */
export function mergeInputSources(
  gamepad: SourceState,
  keyboardMouse: SourceState,
  lastActive: ActiveSource = 'keyboard-mouse',
): NormalizedInputState {
  let activeSource: ActiveSource = lastActive
  if (hasInputActivity(gamepad)) {
    activeSource = 'gamepad'
  } else if (hasInputActivity(keyboardMouse)) {
    activeSource = 'keyboard-mouse'
  }

  const chosen = activeSource === 'gamepad' ? gamepad : keyboardMouse
  return {
    move: { ...chosen.move },
    look: { ...chosen.look },
    sprint: chosen.sprint,
    bite: chosen.bite,
    activeSource,
  }
}
