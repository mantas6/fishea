// Pure helper gating the "press to restart" action on the death screen. Kept
// free of DOM / Three.js so it can be unit tested in the node environment and
// driven from the game loop.
//
// Two guards stop an accidental instant restart at the moment of death:
//   1. A short grace period must elapse first, so the button is ignored right
//      after death (e.g. the player was mashing ✕/bite on prey as they died).
//   2. Edge detection: only the rising edge (button *just* pressed) counts, so a
//      button held from before death can never trigger a restart on its own.

/** Seconds after death before the restart button is armed. */
export const RESTART_GRACE = 0.6

/** Rolling state for the death-screen restart gate. */
export interface RestartGate {
  /** Seconds remaining before the restart button is armed. */
  grace: number
  /** Whether the button was down last frame (for rising-edge detection). */
  prevPressed: boolean
}

/**
 * A fresh gate. `pressed` should be the button's state at the moment of death so
 * a button already held is latched as "was down" and must be released before it
 * can fire.
 */
export function createRestartGate(pressed = true, grace = RESTART_GRACE): RestartGate {
  return { grace, prevPressed: pressed }
}

/** Result of advancing the gate one frame. */
export interface RestartGateResult {
  state: RestartGate
  /** True on the frame a valid (armed + rising-edge) restart press is seen. */
  triggered: boolean
}

/**
 * Advance the gate by one frame. Pure — returns the next state plus whether a
 * restart should fire this frame.
 */
export function updateRestartGate(
  state: RestartGate,
  pressed: boolean,
  dt: number,
): RestartGateResult {
  const grace = Math.max(0, state.grace - dt)
  const rising = pressed && !state.prevPressed
  const triggered = grace <= 0 && rising
  return { state: { grace, prevPressed: pressed }, triggered }
}
