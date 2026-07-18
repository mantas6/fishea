import { describe, it, expect } from 'vitest'
import {
  MINOR_PENTATONIC,
  semitoneToFreq,
  buildScale,
  pickNextNote,
  heartbeatActive,
  heartbeatBpm,
  shouldSuppressHurt,
  shouldPlayDeath,
} from '../theory.js'

describe('semitoneToFreq', () => {
  it('returns the base frequency at offset 0', () => {
    expect(semitoneToFreq(440, 0)).toBeCloseTo(440)
  })

  it('doubles an octave up (+12 semitones)', () => {
    expect(semitoneToFreq(220, 12)).toBeCloseTo(440)
  })

  it('halves an octave down (-12 semitones)', () => {
    expect(semitoneToFreq(440, -12)).toBeCloseTo(220)
  })
})

describe('buildScale', () => {
  it('produces intervals * octaves notes', () => {
    const notes = buildScale(110, MINOR_PENTATONIC, 3)
    expect(notes).toHaveLength(MINOR_PENTATONIC.length * 3)
  })

  it('is strictly ascending', () => {
    const notes = buildScale(110)
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i]).toBeGreaterThan(notes[i - 1])
    }
  })

  it('starts at the base frequency', () => {
    const notes = buildScale(110)
    expect(notes[0]).toBeCloseTo(110)
  })
})

describe('pickNextNote', () => {
  it('always returns an index within range', () => {
    let rngState = 0
    const rng = () => {
      rngState += 0.37
      return rngState % 1
    }
    let prev = null
    for (let i = 0; i < 500; i++) {
      const idx = pickNextNote(15, rng, prev)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(15)
      expect(Number.isInteger(idx)).toBe(true)
      prev = idx
    }
  })

  it('seeds a starting note when prevIndex is null', () => {
    // rng at 0 => floor(0) = 0
    expect(pickNextNote(15, () => 0, null)).toBe(0)
  })

  it('takes bounded steps from the previous index', () => {
    // rng = 1 => step = round((1*2-1)*2) = round(2) = 2
    expect(pickNextNote(15, () => 1, 5, 2)).toBe(7)
    // rng = 0 => step = round((-1)*2) = -2
    expect(pickNextNote(15, () => 0, 5, 2)).toBe(3)
  })

  it('reflects off the upper edge instead of clamping flat', () => {
    // prev near top, big positive step reflects back inside range
    const idx = pickNextNote(10, () => 1, 9, 2)
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan(10)
  })

  it('handles an empty scale gracefully', () => {
    expect(pickNextNote(0, () => 0.5, null)).toBe(0)
  })
})

describe('heartbeatActive (hysteresis)', () => {
  it('starts when hp drops below the start threshold', () => {
    expect(heartbeatActive(false, 0.29)).toBe(true)
  })

  it('does not start in the dead band (between start and stop)', () => {
    expect(heartbeatActive(false, 0.32)).toBe(false)
  })

  it('stays on within the dead band once active', () => {
    expect(heartbeatActive(true, 0.32)).toBe(true)
  })

  it('stops only once hp climbs above the stop threshold', () => {
    expect(heartbeatActive(true, 0.36)).toBe(false)
  })

  it('does not flicker: crossing start then hovering keeps it on', () => {
    let active = false
    active = heartbeatActive(active, 0.28) // on
    expect(active).toBe(true)
    active = heartbeatActive(active, 0.31) // dead band -> still on
    expect(active).toBe(true)
    active = heartbeatActive(active, 0.34) // dead band -> still on
    expect(active).toBe(true)
    active = heartbeatActive(active, 0.4) // above stop -> off
    expect(active).toBe(false)
  })

  it('ignores non-finite input', () => {
    expect(heartbeatActive(true, NaN)).toBe(true)
    expect(heartbeatActive(false, NaN)).toBe(false)
  })
})

describe('heartbeatBpm', () => {
  it('is slow at the start threshold', () => {
    expect(heartbeatBpm(0.3, 60, 110)).toBeCloseTo(60)
  })

  it('is fast near death', () => {
    expect(heartbeatBpm(0, 60, 110)).toBeCloseTo(110)
  })

  it('clamps above the threshold to the slow tempo', () => {
    expect(heartbeatBpm(0.9, 60, 110)).toBeCloseTo(60)
  })

  it('interpolates in between', () => {
    expect(heartbeatBpm(0.15, 60, 110)).toBeCloseTo(85)
  })
})

describe('shouldSuppressHurt (fatal-bite window)', () => {
  it('does not suppress when no death has occurred', () => {
    expect(shouldSuppressHurt(1000, null)).toBe(false)
  })

  it('suppresses when the hurt lands within the window after death', () => {
    expect(shouldSuppressHurt(1000, 1000)).toBe(true) // same instant
    expect(shouldSuppressHurt(1050, 1000)).toBe(true) // 50ms later
    expect(shouldSuppressHurt(1100, 1000)).toBe(true) // exactly at edge
  })

  it('does not suppress once the window has elapsed', () => {
    expect(shouldSuppressHurt(1101, 1000)).toBe(false)
    expect(shouldSuppressHurt(2000, 1000)).toBe(false)
  })

  it('does not suppress a hurt that predates the death (negative dt)', () => {
    expect(shouldSuppressHurt(900, 1000)).toBe(false)
  })

  it('respects a custom window', () => {
    expect(shouldSuppressHurt(1300, 1000, 250)).toBe(false) // dt 300 > 250
    expect(shouldSuppressHurt(1200, 1000, 300)).toBe(true) // dt 200 <= 300
  })

  it('ignores non-finite timestamps', () => {
    expect(shouldSuppressHurt(NaN, 1000)).toBe(false)
    expect(shouldSuppressHurt(1000, Infinity)).toBe(false)
  })
})

describe('shouldPlayDeath (retrigger guard)', () => {
  it('plays on a fresh run when no death has occurred', () => {
    expect(shouldPlayDeath(1000, null)).toBe(true)
  })

  it('suppresses a retrigger landing within the window', () => {
    expect(shouldPlayDeath(1000, 1000)).toBe(false) // same instant
    expect(shouldPlayDeath(1500, 1000)).toBe(false) // 500ms later
    expect(shouldPlayDeath(2000, 1000)).toBe(false) // exactly at edge
  })

  it('plays again once the window has elapsed', () => {
    expect(shouldPlayDeath(2001, 1000)).toBe(true)
    expect(shouldPlayDeath(5000, 1000)).toBe(true)
  })

  it('plays for a death timestamp that predates the last (negative dt)', () => {
    expect(shouldPlayDeath(900, 1000)).toBe(true)
  })

  it('respects a custom window', () => {
    expect(shouldPlayDeath(1300, 1000, 250)).toBe(true) // dt 300 > 250
    expect(shouldPlayDeath(1200, 1000, 300)).toBe(false) // dt 200 <= 300
  })

  it('plays through non-finite timestamps rather than swallowing a real death', () => {
    expect(shouldPlayDeath(NaN, 1000)).toBe(true)
    expect(shouldPlayDeath(1000, Infinity)).toBe(true)
  })
})
