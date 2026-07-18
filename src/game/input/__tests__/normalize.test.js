import { describe, it, expect } from 'vitest'
import {
  DEADZONE,
  neutralState,
  applyDeadzone,
  applyStickDeadzone,
  keysToMove,
  stickToMove,
  stickToLook,
  hasInputActivity,
  mergeInputSources,
} from '../normalize.js'

describe('applyDeadzone', () => {
  it('zeroes values inside the deadzone', () => {
    expect(applyDeadzone(0)).toBe(0)
    expect(applyDeadzone(DEADZONE - 0.01)).toBe(0)
    expect(applyDeadzone(-DEADZONE)).toBe(0)
  })

  it('rescales values past the deadzone to reach 1 at full tilt', () => {
    expect(applyDeadzone(1)).toBeCloseTo(1)
    expect(applyDeadzone(-1)).toBeCloseTo(-1)
    // just past deadzone -> near zero
    expect(applyDeadzone(DEADZONE + 1e-6)).toBeCloseTo(0, 4)
  })

  it('preserves sign', () => {
    expect(applyDeadzone(0.5)).toBeGreaterThan(0)
    expect(applyDeadzone(-0.5)).toBeLessThan(0)
  })

  it('honours a custom deadzone', () => {
    expect(applyDeadzone(0.4, 0.5)).toBe(0)
  })
})

describe('applyStickDeadzone', () => {
  it('zeroes a stick resting inside the deadzone', () => {
    expect(applyStickDeadzone(0.1, 0.05)).toEqual({ x: 0, y: 0 })
  })

  it('preserves direction and clamps magnitude to <=1', () => {
    const out = applyStickDeadzone(1, 1)
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(1)
    expect(out.x).toBeCloseTo(out.y) // 45-degree direction preserved
  })

  it('applies a radial (not per-axis) threshold', () => {
    // Each axis below the linear deadzone, but the vector magnitude is above it.
    const out = applyStickDeadzone(0.12, 0.12, 0.15)
    expect(Math.hypot(out.x, out.y)).toBeGreaterThan(0)
  })
})

describe('keysToMove', () => {
  it('is zero with no keys', () => {
    expect(keysToMove({})).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('maps forward/back to +/- z and strafe to +/- x', () => {
    expect(keysToMove({ forward: true }).z).toBe(1)
    expect(keysToMove({ back: true }).z).toBe(-1)
    expect(keysToMove({ right: true }).x).toBe(1)
    expect(keysToMove({ left: true }).x).toBe(-1)
  })

  it('maps up/down to +/- y', () => {
    expect(keysToMove({ up: true }).y).toBe(1)
    expect(keysToMove({ down: true }).y).toBe(-1)
    expect(keysToMove({ up: true, down: true }).y).toBe(0)
  })

  it('normalizes diagonal horizontal movement to unit length', () => {
    const out = keysToMove({ forward: true, right: true })
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1)
  })
})

describe('stickToMove', () => {
  it('pushing the stick up (negative y) is forward (+z)', () => {
    const out = stickToMove({ x: 0, y: -1 })
    expect(out.z).toBe(1)
  })

  it('carries strafe on x and vertical bools on y', () => {
    const out = stickToMove({ x: 0.5, y: 0 }, { up: true })
    expect(out.x).toBe(0.5)
    expect(out.y).toBe(1)
  })
})

describe('stickToLook', () => {
  it('is zero at rest', () => {
    const out = stickToLook({ x: 0, y: 0 }, 0.016)
    expect(out.x).toBeCloseTo(0)
    expect(out.y).toBeCloseTo(0)
  })

  it('stick-right turns right (negative yaw delta), stick-up looks up (positive pitch delta)', () => {
    const out = stickToLook({ x: 1, y: -1 }, 0.5, 2)
    expect(out.x).toBeLessThan(0)
    expect(out.y).toBeGreaterThan(0)
  })

  it('scales with dt and speed', () => {
    expect(stickToLook({ x: 1, y: 0 }, 1, 2).x).toBeCloseTo(-2)
  })
})

describe('hasInputActivity', () => {
  it('false for a neutral state', () => {
    expect(hasInputActivity(neutralState())).toBe(false)
    expect(hasInputActivity(null)).toBe(false)
  })

  it('true when any move / look / button is engaged', () => {
    expect(hasInputActivity({ ...neutralState(), move: { x: 0, y: 0, z: 0.5 } })).toBe(true)
    expect(hasInputActivity({ ...neutralState(), look: { x: 0.01, y: 0 } })).toBe(true)
    expect(hasInputActivity({ ...neutralState(), sprint: true })).toBe(true)
    expect(hasInputActivity({ ...neutralState(), bite: true })).toBe(true)
  })
})

describe('mergeInputSources', () => {
  const gpActive = { ...neutralState(), move: { x: 0, y: 0, z: 1 } }
  const kbmActive = { ...neutralState(), move: { x: 1, y: 0, z: 0 }, bite: true }

  it('gamepad wins when it has any input', () => {
    const out = mergeInputSources(gpActive, kbmActive)
    expect(out.activeSource).toBe('gamepad')
    expect(out.move.z).toBe(1)
    expect(out.bite).toBe(false) // took gamepad's values, not kbm's
  })

  it('keyboard-mouse wins when gamepad is idle', () => {
    const out = mergeInputSources(neutralState(), kbmActive)
    expect(out.activeSource).toBe('keyboard-mouse')
    expect(out.move.x).toBe(1)
    expect(out.bite).toBe(true)
  })

  it('latches the previous source when both are idle', () => {
    const out = mergeInputSources(neutralState(), neutralState(), 'gamepad')
    expect(out.activeSource).toBe('gamepad')
  })

  it('returns copies, not references, of the chosen vectors', () => {
    const out = mergeInputSources(gpActive, neutralState())
    expect(out.move).not.toBe(gpActive.move)
    expect(out.look).not.toBe(gpActive.look)
  })
})
