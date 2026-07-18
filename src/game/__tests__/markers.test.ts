import { describe, it, expect } from 'vitest'
import {
  ndcToScreenPct,
  isOnScreen,
  markerFade,
  edgeMarker,
  biteCloseness,
} from '../markers.js'

describe('ndcToScreenPct', () => {
  it('maps the NDC centre to the viewport centre', () => {
    expect(ndcToScreenPct(0, 0)).toEqual({ xPct: 50, yPct: 50 })
  })

  it('maps NDC corners to viewport corners (y is flipped)', () => {
    // NDC (-1, 1) is top-left; (1, -1) is bottom-right.
    expect(ndcToScreenPct(-1, 1)).toEqual({ xPct: 0, yPct: 0 })
    expect(ndcToScreenPct(1, -1)).toEqual({ xPct: 100, yPct: 100 })
  })
})

describe('isOnScreen', () => {
  it('accepts points inside the NDC box in front of the camera', () => {
    expect(isOnScreen({ x: 0, y: 0, z: 0 })).toBe(true)
    expect(isOnScreen({ x: -1, y: 1, z: 0.9 })).toBe(true)
  })

  it('rejects points outside the NDC box', () => {
    expect(isOnScreen({ x: 1.2, y: 0, z: 0 })).toBe(false)
    expect(isOnScreen({ x: 0, y: -1.5, z: 0 })).toBe(false)
  })

  it('rejects points behind the camera (z > 1)', () => {
    expect(isOnScreen({ x: 0, y: 0, z: 1.4 })).toBe(false)
  })
})

describe('markerFade', () => {
  it('is fully opaque at or under the near distance', () => {
    expect(markerFade(0, 10, 100)).toBe(1)
    expect(markerFade(10, 10, 100)).toBe(1)
  })

  it('clamps to the minimum at or past the far distance', () => {
    expect(markerFade(100, 10, 100, 0.25)).toBe(0.25)
    expect(markerFade(200, 10, 100, 0.25)).toBe(0.25)
  })

  it('interpolates linearly between near and far', () => {
    // Halfway (dist 55 of 10..100) => halfway between 1 and min.
    expect(markerFade(55, 10, 100, 0.2)).toBeCloseTo(0.6)
  })

  it('degrades gracefully when far <= near', () => {
    expect(markerFade(5, 10, 10)).toBe(1)
    expect(markerFade(20, 10, 10, 0.3)).toBe(0.3)
  })
})

describe('biteCloseness', () => {
  it('is 0 at or beyond the engage distance', () => {
    // range 4 => default engage 16.
    expect(biteCloseness(16, 4)).toBe(0)
    expect(biteCloseness(30, 4)).toBe(0)
  })

  it('is 1 at or within the eat range', () => {
    expect(biteCloseness(4, 4)).toBe(1)
    expect(biteCloseness(1, 4)).toBe(1)
  })

  it('ramps linearly from engage down to range', () => {
    // range 4, engage 16 => halfway distance (10) gives 0.5.
    expect(biteCloseness(10, 4)).toBeCloseTo(0.5)
    // Quarter of the way in from engage (13) gives 0.25.
    expect(biteCloseness(13, 4)).toBeCloseTo(0.25)
  })

  it('honours an explicit engage distance', () => {
    // range 2, engage 6 => midpoint 4 gives 0.5.
    expect(biteCloseness(4, 2, 6)).toBeCloseTo(0.5)
  })

  it('degrades gracefully when engage <= range', () => {
    expect(biteCloseness(3, 4, 4)).toBe(1)
    expect(biteCloseness(5, 4, 4)).toBe(0)
  })
})

describe('edgeMarker', () => {
  it('clamps a target to the right edge and points right', () => {
    const m = edgeMarker(2, 0, false, 0.1)
    expect(m.xPct).toBeCloseTo(95) // limit 0.9 => (0.9*0.5+0.5)*100
    expect(m.yPct).toBeCloseTo(50)
    expect(m.angle).toBeCloseTo(0)
  })

  it('points up for a target directly above', () => {
    const m = edgeMarker(0, 2, false, 0.1)
    expect(m.xPct).toBeCloseTo(50)
    expect(m.yPct).toBeCloseTo(5)
    expect(m.angle).toBeCloseTo(-Math.PI / 2)
  })

  it('points down for a target directly below', () => {
    const m = edgeMarker(0, -2, false, 0.1)
    expect(m.yPct).toBeCloseTo(95)
    expect(m.angle).toBeCloseTo(Math.PI / 2)
  })

  it('negates the direction when the target is behind the camera', () => {
    // Projection mirrors behind-camera points, so a raw +x must flip to -x.
    const m = edgeMarker(2, 0, true, 0.1)
    expect(m.xPct).toBeCloseTo(5)
    expect(m.angle).toBeCloseTo(Math.PI)
  })

  it('keeps the dominant axis on the margin boundary', () => {
    // Diagonal but x-dominant: x hits the limit, y scales proportionally.
    const m = edgeMarker(2, 1, false, 0.1)
    expect(m.xPct).toBeCloseTo(95)
    // ey = 1 * (0.9 / 2) = 0.45 => (1 - (0.45*0.5+0.5))*100 = 27.5
    expect(m.yPct).toBeCloseTo(27.5)
  })

  it('falls back to pointing up for a degenerate centre target', () => {
    const m = edgeMarker(0, 0, false, 0.1)
    expect(m.xPct).toBeCloseTo(50)
    expect(m.yPct).toBeCloseTo(5)
    expect(m.angle).toBeCloseTo(-Math.PI / 2)
  })
})
