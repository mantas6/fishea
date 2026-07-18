import { describe, it, expect } from 'vitest'
import {
  seafloorHeight,
  SEAFLOOR_RELIEF,
  randomAnnulusPoint,
  clampRadius,
  clusteredScatter,
  schoolMemberPosition,
} from '../world.js'
import { WORLD } from '../movement.js'

// A tiny deterministic PRNG so the pure placement helpers can be exercised
// without pulling in the world's private mulberry32 instance.
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('seafloorHeight', () => {
  it('stays within the relief envelope everywhere', () => {
    for (let x = -180; x <= 180; x += 7) {
      for (let z = -180; z <= 180; z += 7) {
        const h = seafloorHeight(x, z)
        expect(h).toBeGreaterThanOrEqual(WORLD.seafloorY - SEAFLOOR_RELIEF - 1e-6)
        expect(h).toBeLessThanOrEqual(WORLD.seafloorY + SEAFLOOR_RELIEF + 1e-6)
      }
    }
  })

  it('has real rolling relief (not a flat plane)', () => {
    let min = Infinity
    let max = -Infinity
    for (let x = -180; x <= 180; x += 5) {
      for (let z = -180; z <= 180; z += 5) {
        const h = seafloorHeight(x, z)
        if (h < min) min = h
        if (h > max) max = h
      }
    }
    // The floor must swing across a big chunk of its envelope — proof that it
    // reads as hills and valleys rather than the near-flat original dunes.
    expect(max - min).toBeGreaterThan(SEAFLOOR_RELIEF)
  })

  it('never rises near the water surface', () => {
    expect(WORLD.seafloorY + SEAFLOOR_RELIEF).toBeLessThan(WORLD.surfaceY - WORLD.fishSurfaceMargin)
  })

  it('is deterministic', () => {
    expect(seafloorHeight(12.5, -7.25)).toBe(seafloorHeight(12.5, -7.25))
  })
})

describe('randomAnnulusPoint', () => {
  it('keeps every point within the annulus', () => {
    const rng = makeRng(42)
    for (let i = 0; i < 500; i++) {
      const p = randomAnnulusPoint(rng, 10, 50)
      const d = Math.hypot(p.x, p.z)
      expect(d).toBeGreaterThanOrEqual(10 - 1e-6)
      expect(d).toBeLessThanOrEqual(50 + 1e-6)
    }
  })

  it('is deterministic for a given seed', () => {
    const a = randomAnnulusPoint(makeRng(7), 5, 20)
    const b = randomAnnulusPoint(makeRng(7), 5, 20)
    expect(a).toEqual(b)
  })
})

describe('clampRadius', () => {
  it('leaves in-range points untouched', () => {
    expect(clampRadius(3, 4, 10)).toEqual({ x: 3, z: 4 })
  })

  it('projects out-of-range points onto the circle', () => {
    const p = clampRadius(30, 40, 10) // magnitude 50 -> 10
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(10)
    // Direction is preserved.
    expect(p.x / p.z).toBeCloseTo(30 / 40)
  })

  it('is a no-op at the origin', () => {
    expect(clampRadius(0, 0, 10)).toEqual({ x: 0, z: 0 })
  })
})

describe('clusteredScatter', () => {
  const opts = { radius: 100, inner: 10, clusters: 5, spread: 15, clusterFraction: 0.8 }

  it('returns exactly `count` points', () => {
    expect(clusteredScatter(makeRng(1), 40, opts)).toHaveLength(40)
  })

  it('keeps every point within the outer radius', () => {
    const pts = clusteredScatter(makeRng(2), 200, opts)
    for (const p of pts) {
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(opts.radius + 1e-6)
    }
  })

  it('is deterministic for a given seed', () => {
    expect(clusteredScatter(makeRng(3), 30, opts)).toEqual(clusteredScatter(makeRng(3), 30, opts))
  })

  it('falls back to uniform scatter with zero clusters', () => {
    const pts = clusteredScatter(makeRng(4), 25, { ...opts, clusters: 0 })
    expect(pts).toHaveLength(25)
    for (const p of pts) {
      const d = Math.hypot(p.x, p.z)
      expect(d).toBeGreaterThanOrEqual(opts.inner - 1e-6)
      expect(d).toBeLessThanOrEqual(opts.radius + 1e-6)
    }
  })

  it('produces zero points for a zero count', () => {
    expect(clusteredScatter(makeRng(5), 0, opts)).toEqual([])
  })
})

describe('schoolMemberPosition', () => {
  const center = { x: 100, y: 20, z: -50 }

  it('stays within radius + bob of the center', () => {
    const radius = 8
    const ySpan = 2
    for (let t = 0; t < 20; t += 0.5) {
      for (let i = 0; i < 16; i++) {
        const p = schoolMemberPosition(center, radius, ySpan, t, 0.3, i, 16)
        const horiz = Math.hypot(p.x - center.x, p.z - center.z)
        expect(horiz).toBeLessThanOrEqual(radius + 1e-6)
        expect(Math.abs(p.y - center.y)).toBeLessThanOrEqual(ySpan + 1e-6)
      }
    }
  })

  it('spaces members apart at a fixed time', () => {
    const a = schoolMemberPosition(center, 8, 2, 0, 0.3, 0, 4)
    const b = schoolMemberPosition(center, 8, 2, 0, 0.3, 1, 4)
    const dist = Math.hypot(a.x - b.x, a.z - b.z)
    expect(dist).toBeGreaterThan(0)
  })

  it('is deterministic and pure', () => {
    const a = schoolMemberPosition(center, 8, 2, 1.25, 0.3, 3, 12)
    const b = schoolMemberPosition(center, 8, 2, 1.25, 0.3, 3, 12)
    expect(a).toEqual(b)
  })

  it('handles a zero member count without dividing by zero', () => {
    const p = schoolMemberPosition(center, 8, 2, 1, 0.3, 0, 0)
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
    expect(Number.isFinite(p.z)).toBe(true)
  })
})
