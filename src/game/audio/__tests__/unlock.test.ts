import { describe, it, expect } from 'vitest'
import { isRunning, shouldResume, decideUnlock, shouldResumeOnResurface } from '../unlock.js'

describe('isRunning', () => {
  it('is true only for the running state', () => {
    expect(isRunning('running')).toBe(true)
    expect(isRunning('suspended')).toBe(false)
    expect(isRunning('interrupted')).toBe(false)
    expect(isRunning('closed')).toBe(false)
    expect(isRunning(null)).toBe(false)
    expect(isRunning(undefined)).toBe(false)
  })
})

describe('shouldResume', () => {
  it('resumes suspended and interrupted contexts', () => {
    expect(shouldResume('suspended')).toBe(true)
    expect(shouldResume('interrupted')).toBe(true)
  })

  it('does not resume running/closed/absent contexts', () => {
    expect(shouldResume('running')).toBe(false)
    expect(shouldResume('closed')).toBe(false)
    expect(shouldResume(null)).toBe(false)
    expect(shouldResume(undefined)).toBe(false)
  })
})

describe('decideUnlock', () => {
  it('fires unlock once when it first reaches running', () => {
    expect(decideUnlock('running', false)).toEqual({ fireUnlock: true, keepArmed: false })
  })

  it('does not re-fire when already fired, and stops re-arming once running', () => {
    expect(decideUnlock('running', true)).toEqual({ fireUnlock: false, keepArmed: false })
  })

  it('keeps listeners armed while suspended (resume resolved but not running yet)', () => {
    expect(decideUnlock('suspended', false)).toEqual({ fireUnlock: false, keepArmed: true })
  })

  it('keeps listeners armed while interrupted', () => {
    expect(decideUnlock('interrupted', false)).toEqual({ fireUnlock: false, keepArmed: true })
  })

  it('keeps armed for a null/absent context', () => {
    expect(decideUnlock(null, false)).toEqual({ fireUnlock: false, keepArmed: true })
  })

  it('never fires more than once across repeated suspended->running transitions', () => {
    // First tap: suspended -> keep armed, nothing fired.
    let fired = false
    let d = decideUnlock('suspended', fired)
    expect(d.fireUnlock).toBe(false)
    expect(d.keepArmed).toBe(true)
    // Second tap: running -> fire once.
    d = decideUnlock('running', fired)
    expect(d.fireUnlock).toBe(true)
    fired = fired || d.fireUnlock
    // Later re-check while running -> no second fire.
    d = decideUnlock('running', fired)
    expect(d.fireUnlock).toBe(false)
    expect(d.keepArmed).toBe(false)
  })
})

describe('shouldResumeOnResurface', () => {
  it('resumes a parked context once previously unlocked and visible', () => {
    expect(shouldResumeOnResurface('suspended', true, false)).toBe(true)
    expect(shouldResumeOnResurface('interrupted', true, false)).toBe(true)
  })

  it('does nothing before the first unlock', () => {
    expect(shouldResumeOnResurface('suspended', false, false)).toBe(false)
  })

  it('does nothing while the page is hidden', () => {
    expect(shouldResumeOnResurface('suspended', true, true)).toBe(false)
  })

  it('does nothing when already running', () => {
    expect(shouldResumeOnResurface('running', true, false)).toBe(false)
  })
})
