// Pure, DOM/AudioContext-free decision logic for the iOS/Safari audio-unlock
// dance. The engine drives real AudioContext side effects; this module only
// answers two questions from plain inputs so the tricky control flow can be
// unit tested in a node environment without a Web Audio API.
//
// Background: iOS Safari creates the AudioContext in a non-'running' state
// (usually 'suspended', sometimes 'interrupted' after an auto-lock/background)
// and only transitions to 'running' when `resume()` is called inside a trusted
// user gesture. `resume()` can also resolve while the state is *still* not
// running. So we must not treat "unlock attempted" as "unlocked": we keep
// retrying on every gesture until the state is actually 'running', and only
// then fire the one-shot unlock callbacks (music start, etc.).

/** The subset of AudioContext states we reason about (plus null when absent). */
export type CtxState = AudioContextState | 'interrupted' | null | undefined

/** Result of evaluating the context state after a resume attempt. */
export interface UnlockDecision {
  /** Fire the one-shot onUnlock callbacks (start music, mark unlocked). */
  fireUnlock: boolean
  /** Keep (or re-arm) gesture listeners for another unlock attempt. */
  keepArmed: boolean
}

/** True when the context is live and audible. */
export function isRunning(state: CtxState): boolean {
  return state === 'running'
}

/**
 * Whether a `resume()` call is worth attempting for this state. iOS parks a
 * backgrounded context in 'interrupted'; a plain suspended context also needs
 * resuming. A closed/running/null context does not.
 */
export function shouldResume(state: CtxState): boolean {
  return state === 'suspended' || state === 'interrupted'
}

/**
 * Decide what to do once we've observed the context state (after a resume
 * settles). Fire the unlock callbacks exactly once — only when actually
 * running and not already fired — and keep the gesture listeners armed for as
 * long as we are not yet running so a later tap can retry.
 */
export function decideUnlock(state: CtxState, alreadyFired: boolean): UnlockDecision {
  const running = isRunning(state)
  return {
    fireUnlock: running && !alreadyFired,
    keepArmed: !running,
  }
}

/**
 * Decide whether an out-of-gesture resume (visibilitychange/focus) should even
 * be attempted: only once we've previously unlocked, the page is visible, and
 * the context is in a resumable state.
 */
export function shouldResumeOnResurface(
  state: CtxState,
  previouslyUnlocked: boolean,
  documentHidden: boolean,
): boolean {
  if (!previouslyUnlocked) return false
  if (documentHidden) return false
  return shouldResume(state)
}

export default { isRunning, shouldResume, decideUnlock, shouldResumeOnResurface }
