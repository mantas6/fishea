// Pure, testable input math. NO DOM / event / navigator access lives here so
// this module can be unit-tested in a plain node environment. The stateful
// listener code (keyboard.js, mouse.js, gamepad.js) feeds raw readings into
// these helpers and the InputManager merges the results.

// Default analog stick / trigger deadzone.
export const DEADZONE = 0.15

// How fast the gamepad right stick turns the view (radians/second at full tilt).
export const GAMEPAD_LOOK_SPEED = 2.6

// Standard-mapping PS4 (DualShock) button indices we care about.
export const GAMEPAD_BUTTONS = {
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
export function neutralState() {
  return {
    move: { x: 0, y: 0, z: 0 },
    look: { x: 0, y: 0 },
    sprint: false,
    bite: false,
  }
}

/**
 * Apply a 1D deadzone with rescaling so output ramps 0..1 past the threshold.
 * @param {number} value raw axis value (-1..1)
 * @param {number} [deadzone]
 * @returns {number}
 */
export function applyDeadzone(value, deadzone = DEADZONE) {
  const mag = Math.abs(value)
  if (mag <= deadzone) return 0
  const sign = value < 0 ? -1 : 1
  const scaled = (mag - deadzone) / (1 - deadzone)
  return sign * Math.min(scaled, 1)
}

/**
 * Radial deadzone for a 2-axis analog stick. Preserves direction while
 * rescaling magnitude past the deadzone. Returns a vector with |v| in 0..1.
 * @param {number} x
 * @param {number} y
 * @param {number} [deadzone]
 * @returns {{x:number,y:number}}
 */
export function applyStickDeadzone(x, y, deadzone = DEADZONE) {
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
 * @param {{forward?:boolean,back?:boolean,left?:boolean,right?:boolean,up?:boolean,down?:boolean}} keys
 * @returns {{x:number,y:number,z:number}}
 */
export function keysToMove(keys = {}) {
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
 * @param {{x:number,y:number}} leftStick already deadzoned
 * @param {{up?:boolean,down?:boolean}} [vertical]
 * @returns {{x:number,y:number,z:number}}
 */
export function stickToMove(leftStick, vertical = {}) {
  return {
    x: leftStick.x,
    y: (vertical.up ? 1 : 0) - (vertical.down ? 1 : 0),
    z: -leftStick.y,
  }
}

/**
 * Convert a deadzoned right-stick reading into per-frame look deltas (radians).
 * Stick-right turns right (yaw decreases); stick-up looks up (pitch increases).
 * @param {{x:number,y:number}} rightStick already deadzoned
 * @param {number} dt seconds
 * @param {number} [speed] radians/sec at full tilt
 * @returns {{x:number,y:number}}
 */
export function stickToLook(rightStick, dt, speed = GAMEPAD_LOOK_SPEED) {
  return {
    x: -rightStick.x * speed * dt,
    y: -rightStick.y * speed * dt,
  }
}

/**
 * Does a normalized source state carry any meaningful input?
 * (Deadzones already zero small analog noise, so any nonzero value counts.)
 * @param {ReturnType<typeof neutralState>} state
 * @param {number} [threshold]
 * @returns {boolean}
 */
export function hasInputActivity(state, threshold = 1e-4) {
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
 * @param {ReturnType<typeof neutralState>} gamepad
 * @param {ReturnType<typeof neutralState>} keyboardMouse
 * @param {'gamepad'|'keyboard-mouse'} [lastActive]
 * @returns {ReturnType<typeof neutralState> & {activeSource:'gamepad'|'keyboard-mouse'}}
 */
export function mergeInputSources(gamepad, keyboardMouse, lastActive = 'keyboard-mouse') {
  let activeSource = lastActive
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
