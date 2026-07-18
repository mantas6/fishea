// Pure helper backing the contextual "you can eat this" action prompt. Kept
// free of React/Three.js so it can be unit tested in the node environment and
// driven from the game loop.
//
// Eligibility (a biteable target being in range/cone) can flip on and off
// rapidly as the fish swims, so we hold the prompt visible for a short minimum
// after it goes ineligible. This debounces flicker without adding latency to
// the moment the prompt first appears.

/** Minimum time (seconds) the eat prompt stays up after eligibility ends. */
export const EAT_PROMPT_MIN_HOLD = 0.4

/** Rolling visibility state for the eat/attack prompt. */
export interface PromptHoldState {
  /** Whether the prompt should currently be shown. */
  visible: boolean
  /** Seconds of hold remaining before an ineligible frame may hide it. */
  hold: number
}

/** A fresh, hidden prompt-hold state. */
export function createPromptHold(): PromptHoldState {
  return { visible: false, hold: 0 }
}

/**
 * Advance the prompt-hold state by one frame. Pure — returns a new state.
 *
 * While `eligible` the prompt is shown immediately and the hold timer is
 * refreshed. Once ineligible the prompt lingers until the hold timer drains,
 * smoothing over brief eligibility dropouts.
 */
export function updatePromptHold(
  state: PromptHoldState,
  eligible: boolean,
  dt: number,
  minHold = EAT_PROMPT_MIN_HOLD,
): PromptHoldState {
  if (eligible) {
    return { visible: true, hold: minHold }
  }
  const hold = Math.max(0, state.hold - dt)
  return { visible: hold > 0 ? state.visible : false, hold }
}
