import { describe, it, expect } from 'vitest'
import {
  WORLD,
  MAX_PITCH,
  clampPitch,
  wrapAngle,
  headingToDirection,
  integrate,
  clampToBounds,
  isWithinBounds,
} from '../movement.js'

describe('clampPitch', () => {
  it('leaves in-range values untouched', () => {
    expect(clampPitch(0)).toBe(0)
    expect(clampPitch(0.5)).toBeCloseTo(0.5)
  })

  it('clamps above max', () => {
    expect(clampPitch(5)).toBe(MAX_PITCH)
  })

  it('clamps below -max', () => {
    expect(clampPitch(-5)).toBe(-MAX_PITCH)
  })

  it('honours a custom max', () => {
    expect(clampPitch(2, 1)).toBe(1)
    expect(clampPitch(-2, 1)).toBe(-1)
  })
})

describe('wrapAngle', () => {
  it('keeps values in (-PI, PI]', () => {
    expect(wrapAngle(0)).toBeCloseTo(0)
    expect(wrapAngle(Math.PI * 2)).toBeCloseTo(0)
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI)
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI * 0.5)
  })
})

describe('headingToDirection', () => {
  it('faces -Z at yaw/pitch 0', () => {
    const d = headingToDirection(0, 0)
    expect(d.x).toBeCloseTo(0)
    expect(d.y).toBeCloseTo(0)
    expect(d.z).toBeCloseTo(-1)
  })

  it('always returns a unit vector', () => {
    for (const [yaw, pitch] of [[0.3, 0.2], [1.1, -0.9], [-2.0, 0.5]]) {
      const d = headingToDirection(yaw, pitch)
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1)
    }
  })

  it('pitch raises the Y component', () => {
    expect(headingToDirection(0, 0.5).y).toBeCloseTo(Math.sin(0.5))
  })
})

describe('integrate', () => {
  it('adds velocity * dt without mutating the input', () => {
    const p = { x: 1, y: 2, z: 3 }
    const v = { x: 1, y: -2, z: 0.5 }
    const out = integrate(p, v, 2)
    expect(out).toEqual({ x: 3, y: -2, z: 4 })
    expect(p).toEqual({ x: 1, y: 2, z: 3 }) // unchanged
  })
})

describe('clampToBounds', () => {
  it('keeps in-bounds positions unchanged', () => {
    const p = { x: 10, y: 20, z: -10 }
    expect(clampToBounds(p)).toEqual(p)
  })

  it('clamps y above the seafloor margin', () => {
    const out = clampToBounds({ x: 0, y: -100, z: 0 })
    expect(out.y).toBe(WORLD.seafloorY + WORLD.fishFloorMargin)
  })

  it('clamps y below the surface margin', () => {
    const out = clampToBounds({ x: 0, y: 999, z: 0 })
    expect(out.y).toBe(WORLD.surfaceY - WORLD.fishSurfaceMargin)
  })

  it('clamps radial XZ distance to the world radius', () => {
    const out = clampToBounds({ x: 1000, y: 20, z: 0 })
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(WORLD.radius)
    // direction preserved
    expect(out.x).toBeGreaterThan(0)
    expect(out.z).toBeCloseTo(0)
  })

  it('preserves diagonal direction when clamping radius', () => {
    const out = clampToBounds({ x: 1000, y: 20, z: 1000 })
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(WORLD.radius)
    expect(out.x).toBeCloseTo(out.z)
  })
})

describe('isWithinBounds', () => {
  it('true inside, false outside', () => {
    expect(isWithinBounds({ x: 0, y: 20, z: 0 })).toBe(true)
    expect(isWithinBounds({ x: 0, y: 0, z: 0 })).toBe(false) // below floor margin
    expect(isWithinBounds({ x: 500, y: 20, z: 0 })).toBe(false) // outside radius
  })
})
