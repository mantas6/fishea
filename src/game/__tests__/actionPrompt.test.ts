import { describe, it, expect } from 'vitest'
import {
  createPromptHold,
  updatePromptHold,
  EAT_PROMPT_MIN_HOLD,
} from '../actionPrompt.js'

describe('createPromptHold', () => {
  it('starts hidden with no hold', () => {
    const state = createPromptHold()
    expect(state.visible).toBe(false)
    expect(state.hold).toBe(0)
  })
})

describe('updatePromptHold', () => {
  it('shows immediately when eligible and arms the hold timer', () => {
    const next = updatePromptHold(createPromptHold(), true, 0.016)
    expect(next.visible).toBe(true)
    expect(next.hold).toBe(EAT_PROMPT_MIN_HOLD)
  })

  it('keeps the prompt up for the minimum hold after eligibility ends', () => {
    let state = updatePromptHold(createPromptHold(), true, 0.016)
    // Drain less than the hold window: still visible.
    state = updatePromptHold(state, false, EAT_PROMPT_MIN_HOLD / 2)
    expect(state.visible).toBe(true)
    // Drain past the hold window: now hidden.
    state = updatePromptHold(state, false, EAT_PROMPT_MIN_HOLD)
    expect(state.visible).toBe(false)
    expect(state.hold).toBe(0)
  })

  it('re-arms the hold each eligible frame so brief dropouts do not flicker', () => {
    let state = updatePromptHold(createPromptHold(), true, 0.016)
    // Almost drain, then a single eligible frame refreshes the hold.
    state = updatePromptHold(state, false, EAT_PROMPT_MIN_HOLD - 0.01)
    expect(state.visible).toBe(true)
    state = updatePromptHold(state, true, 0.016)
    expect(state.visible).toBe(true)
    expect(state.hold).toBe(EAT_PROMPT_MIN_HOLD)
    // It survives another near-full drain because the timer was refreshed.
    state = updatePromptHold(state, false, EAT_PROMPT_MIN_HOLD - 0.01)
    expect(state.visible).toBe(true)
  })

  it('stays hidden when never eligible', () => {
    let state = createPromptHold()
    for (let i = 0; i < 5; i++) state = updatePromptHold(state, false, 0.1)
    expect(state.visible).toBe(false)
  })

  it('honours a custom minimum hold', () => {
    let state = updatePromptHold(createPromptHold(), true, 0, 1)
    expect(state.hold).toBe(1)
    state = updatePromptHold(state, false, 0.5, 1)
    expect(state.visible).toBe(true)
    state = updatePromptHold(state, false, 0.6, 1)
    expect(state.visible).toBe(false)
  })
})
