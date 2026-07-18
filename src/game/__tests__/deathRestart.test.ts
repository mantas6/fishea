import { describe, it, expect } from 'vitest'
import {
  createRestartGate,
  updateRestartGate,
  RESTART_GRACE,
} from '../deathRestart.js'

describe('createRestartGate', () => {
  it('starts with the full grace period', () => {
    const gate = createRestartGate()
    expect(gate.grace).toBe(RESTART_GRACE)
  })

  it('latches a held button so a release is required first', () => {
    expect(createRestartGate(true).prevPressed).toBe(true)
    expect(createRestartGate(false).prevPressed).toBe(false)
  })

  it('honours a custom grace period', () => {
    expect(createRestartGate(false, 1).grace).toBe(1)
  })
})

describe('updateRestartGate', () => {
  it('does not trigger during the grace period even on a rising edge', () => {
    let gate = createRestartGate(false, 0.6)
    // Button released, then pressed within the grace window: no restart.
    let res = updateRestartGate(gate, false, 0.1)
    gate = res.state
    res = updateRestartGate(gate, true, 0.1)
    expect(res.triggered).toBe(false)
  })

  it('triggers on the rising edge once the grace period has elapsed', () => {
    let gate = createRestartGate(false, 0.1)
    // Drain the grace with the button up.
    let res = updateRestartGate(gate, false, 0.2)
    gate = res.state
    expect(gate.grace).toBe(0)
    // Now a fresh press fires.
    res = updateRestartGate(gate, true, 0.016)
    expect(res.triggered).toBe(true)
  })

  it('does not trigger while a button is held (no rising edge)', () => {
    // Button held from before death: must release before it can fire.
    let gate = createRestartGate(true, 0)
    let res = updateRestartGate(gate, true, 0.016)
    expect(res.triggered).toBe(false)
    gate = res.state
    // Still held on subsequent frames: still nothing.
    res = updateRestartGate(gate, true, 0.016)
    expect(res.triggered).toBe(false)
    // Release, then press again: now it fires.
    gate = res.state
    res = updateRestartGate(gate, false, 0.016)
    gate = res.state
    res = updateRestartGate(gate, true, 0.016)
    expect(res.triggered).toBe(true)
  })

  it('only fires once for a single press (not while held afterwards)', () => {
    let gate = createRestartGate(false, 0)
    let res = updateRestartGate(gate, true, 0.016)
    expect(res.triggered).toBe(true)
    gate = res.state
    res = updateRestartGate(gate, true, 0.016)
    expect(res.triggered).toBe(false)
  })
})
