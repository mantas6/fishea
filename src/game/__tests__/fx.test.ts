import { describe, it, expect } from 'vitest'
import { wobbleOffset, reachedSurface, wrapCoord, drainEmission } from '../fx.js'

describe('wobbleOffset', () => {
  it('is zero at phase 0 and pi', () => {
    expect(wobbleOffset(0, 1)).toBeCloseTo(0)
    expect(wobbleOffset(Math.PI, 1)).toBeCloseTo(0)
  })

  it('scales with amplitude', () => {
    expect(wobbleOffset(Math.PI / 2, 0.4)).toBeCloseTo(0.4)
    expect(wobbleOffset(Math.PI / 2, 2)).toBeCloseTo(2)
  })
})

describe('reachedSurface', () => {
  it('is false well below the surface', () => {
    expect(reachedSurface(10, 40)).toBe(false)
  })

  it('is true at or above the surface', () => {
    expect(reachedSurface(40, 40)).toBe(true)
    expect(reachedSurface(41, 40)).toBe(true)
  })

  it('honours a pop margin below the surface', () => {
    // margin 1 => pop line sits at 39
    expect(reachedSurface(38.5, 40, 1)).toBe(false)
    expect(reachedSurface(39, 40, 1)).toBe(true)
    expect(reachedSurface(39.5, 40, 1)).toBe(true)
  })
})

describe('wrapCoord', () => {
  it('leaves in-range values untouched', () => {
    expect(wrapCoord(5, 0, 10)).toBeCloseTo(5)
    expect(wrapCoord(-5, 0, 10)).toBeCloseTo(-5)
  })

  it('wraps past the max edge back to the min side', () => {
    // span = 20, min = -10: 12 -> 12 - 20 = -8
    expect(wrapCoord(12, 0, 10)).toBeCloseTo(-8)
  })

  it('wraps past the min edge to the max side', () => {
    // -12 -> -12 + 20 = 8
    expect(wrapCoord(-12, 0, 10)).toBeCloseTo(8)
  })

  it('works around a non-zero center', () => {
    // center 100, half 5 => range [95, 105); 107 -> 97
    expect(wrapCoord(107, 100, 5)).toBeCloseTo(97)
  })

  it('collapses to the center for a non-positive half-extent', () => {
    expect(wrapCoord(50, 3, 0)).toBe(3)
  })

  it('keeps results within the range across many wraps', () => {
    for (let v = -100; v <= 100; v += 7) {
      const w = wrapCoord(v, 0, 10)
      expect(w).toBeGreaterThanOrEqual(-10)
      expect(w).toBeLessThan(10)
    }
  })
})

describe('drainEmission', () => {
  it('emits nothing before a whole particle accrues', () => {
    const { count, accumulator } = drainEmission(0, 10, 0.05) // 0.5
    expect(count).toBe(0)
    expect(accumulator).toBeCloseTo(0.5)
  })

  it('emits whole particles and carries the fraction', () => {
    const { count, accumulator } = drainEmission(0.5, 10, 0.12) // 0.5 + 1.2 = 1.7
    expect(count).toBe(1)
    expect(accumulator).toBeCloseTo(0.7)
  })

  it('emits multiple particles in one large step', () => {
    const { count, accumulator } = drainEmission(0, 30, 0.1) // 3.0
    expect(count).toBe(3)
    expect(accumulator).toBeCloseTo(0)
  })

  it('clamps negative rate / dt to no emission', () => {
    expect(drainEmission(0, -5, 0.1).count).toBe(0)
    expect(drainEmission(0, 30, -0.1).count).toBe(0)
  })

  it('is frame-rate independent over a fixed duration', () => {
    // One 0.5s step vs ten 0.05s steps at 30/s should both total 15.
    const oneStep = drainEmission(0, 30, 0.5).count
    let acc = 0
    let total = 0
    for (let i = 0; i < 10; i++) {
      const r = drainEmission(acc, 30, 0.05)
      acc = r.accumulator
      total += r.count
    }
    expect(oneStep).toBe(15)
    expect(total).toBe(15)
  })
})
