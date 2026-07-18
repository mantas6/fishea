import { describe, it, expect } from 'vitest'
import {
  WORLD,
  MAX_PITCH,
  PLAYER_MOTION,
  clampPitch,
  wrapAngle,
  headingToDirection,
  integrate,
  clampToBounds,
  isWithinBounds,
  rightFromYaw,
  approach,
  stepVelocity,
  desiredVelocity,
  clampForward,
  stepPhase,
  dampFactor,
  limitTurn,
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

describe('rightFromYaw', () => {
  it('points +X when facing -Z (yaw 0)', () => {
    const r = rightFromYaw(0)
    expect(r.x).toBeCloseTo(1)
    expect(r.z).toBeCloseTo(0)
  })

  it('is perpendicular to the horizontal heading', () => {
    for (const yaw of [0.3, 1.1, -2.0]) {
      const d = headingToDirection(yaw, 0)
      const r = rightFromYaw(yaw)
      expect(d.x * r.x + d.z * r.z).toBeCloseTo(0)
      expect(Math.hypot(r.x, r.z)).toBeCloseTo(1)
    }
  })
})

describe('approach', () => {
  it('returns current when dt is 0', () => {
    expect(approach(3, 10, 4, 0)).toBeCloseTo(3)
  })

  it('converges to the target with large dt', () => {
    expect(approach(0, 10, 4, 100)).toBeCloseTo(10)
  })
})

describe('stepVelocity', () => {
  it('ramps toward a nonzero desired velocity', () => {
    const v = stepVelocity({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 8 }, PLAYER_MOTION, 0.1)
    expect(v.z).toBeGreaterThan(0)
    expect(v.z).toBeLessThan(8)
  })

  it('bleeds velocity toward zero (drag) when idle', () => {
    const v = stepVelocity({ x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: 0 }, PLAYER_MOTION, 0.1)
    expect(v.z).toBeGreaterThan(0)
    expect(v.z).toBeLessThan(8)
    // Eventually settles at rest.
    expect(stepVelocity({ x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: 0 }, PLAYER_MOTION, 100).z).toBeCloseTo(0)
  })
})

describe('desiredVelocity', () => {
  it('forward thrust (move.z) follows the heading', () => {
    const v = desiredVelocity({ x: 0, y: 0, z: 1 }, 0, 0, 8)
    // yaw/pitch 0 => heading -Z
    expect(v.z).toBeCloseTo(-8)
    expect(v.x).toBeCloseTo(0)
    expect(v.y).toBeCloseTo(0)
  })

  it('strafe (move.x) follows the right vector', () => {
    const v = desiredVelocity({ x: 1, y: 0, z: 0 }, 0, 0, 8)
    expect(v.x).toBeCloseTo(8) // right is +X at yaw 0
    expect(v.z).toBeCloseTo(0)
  })

  it('vertical (move.y) adds pure Y thrust', () => {
    const v = desiredVelocity({ x: 0, y: 1, z: 0 }, 0, 0, 8)
    expect(v.y).toBeCloseTo(8)
  })

  it('pitched-up forward thrust gains a +Y component', () => {
    const v = desiredVelocity({ x: 0, y: 0, z: 1 }, 0, 0.5, 8)
    expect(v.y).toBeGreaterThan(0)
  })
})

describe('stepPhase', () => {
  it('advances by frequency * dt', () => {
    expect(stepPhase(0, 4, 0.5)).toBeCloseTo(2)
  })

  it('wraps into [0, 2π)', () => {
    const p = stepPhase(0, 10, 1) // 10 rad -> 10 - 2π*1 = 3.7168...
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThan(Math.PI * 2)
    expect(p).toBeCloseTo(10 - Math.PI * 2)
  })

  it('keeps the phase continuous across a frequency change (no snapping)', () => {
    // Integrate at a low frequency for a while, then switch to a high one. The
    // phase must only change by (freq * dt) on the switching step — never jump
    // by the whole accumulated-time-times-new-frequency amount.
    const dt = 1 / 60
    let phase = 0
    for (let i = 0; i < 120; i++) phase = stepPhase(phase, 6, dt) // 2s at freq 6

    const before = Math.sin(phase)
    const next = stepPhase(phase, 30, dt) // frequency jumps 6 -> 30
    const after = Math.sin(next)

    // The sine value can only move by ~ (30 * dt) worth of phase, i.e. small.
    expect(Math.abs(after - before)).toBeLessThan(0.6)
    // And the phase delta equals exactly freq*dt (mod 2π), proving continuity.
    const delta = (next - phase + Math.PI * 2) % (Math.PI * 2)
    expect(delta).toBeCloseTo(30 * dt)
  })
})

describe('dampFactor', () => {
  it('is 0 at dt 0 (no movement) and approaches 1 for large dt', () => {
    expect(dampFactor(4, 0)).toBeCloseTo(0)
    expect(dampFactor(4, 100)).toBeCloseTo(1)
  })

  it('lies in (0,1) for a normal frame and is frame-rate independent', () => {
    const f = dampFactor(8, 1 / 60)
    expect(f).toBeGreaterThan(0)
    expect(f).toBeLessThan(1)
    // Two half-steps compose to one full step: (1-f_half)^2 == (1-f_full).
    const half = dampFactor(8, 1 / 120)
    expect((1 - half) * (1 - half)).toBeCloseTo(1 - dampFactor(8, 1 / 60))
  })
})

describe('limitTurn', () => {
  const unit = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z)

  it('snaps to the target when it is within the allowed turn', () => {
    const from = { x: 1, y: 0, z: 0 }
    const to = { x: Math.cos(0.05), y: Math.sin(0.05), z: 0 } // 0.05 rad away
    const out = limitTurn(from, to, 0.2)
    expect(out.x).toBeCloseTo(to.x)
    expect(out.y).toBeCloseTo(to.y)
  })

  it('rotates only by maxAngle when the target is further', () => {
    const from = { x: 1, y: 0, z: 0 }
    const to = { x: 0, y: 1, z: 0 } // π/2 away
    const maxAngle = 0.1
    const out = limitTurn(from, to, maxAngle)
    expect(unit(out)).toBeCloseTo(1) // stays unit length
    const dot = out.x * from.x + out.y * from.y + out.z * from.z
    expect(Math.acos(Math.max(-1, Math.min(1, dot)))).toBeCloseTo(maxAngle)
  })

  it('turns toward the target (correct direction)', () => {
    const from = { x: 1, y: 0, z: 0 }
    const to = { x: 0, y: 1, z: 0 } // π/2 away, +Y
    const out = limitTurn(from, to, 0.3)
    expect(out.y).toBeGreaterThan(0) // moved toward +Y
    expect(out.x).toBeGreaterThan(0) // but not all the way
  })

  it('returns the target when the source is zero-length', () => {
    const out = limitTurn({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 0.1)
    expect(out.z).toBeCloseTo(1)
  })
})

describe('clampForward (no reverse)', () => {
  it('leaves forward input (z > 0) unchanged and does not brake', () => {
    const out = clampForward({ x: 0.3, y: -0.2, z: 1 })
    expect(out.move).toEqual({ x: 0.3, y: -0.2, z: 1 })
    expect(out.braking).toBe(false)
  })

  it('zeroes reverse input (z < 0) and flags braking, keeping strafe/vertical', () => {
    const out = clampForward({ x: 0.5, y: 0.4, z: -1 })
    expect(out.move.z).toBe(0)
    expect(out.move.x).toBe(0.5)
    expect(out.move.y).toBe(0.4)
    expect(out.braking).toBe(true)
  })

  it('produces zero reverse desired velocity for backward input', () => {
    const { move } = clampForward({ x: 0, y: 0, z: -1 })
    const v = desiredVelocity(move, 0, 0, 8)
    // heading is -Z at yaw 0; reverse thrust would give +Z. It must be zero.
    expect(v.z).toBeCloseTo(0)
    expect(v.x).toBeCloseTo(0)
    expect(v.y).toBeCloseTo(0)
  })

  it('lets existing forward speed decay toward zero under a brake (no reversal)', () => {
    // Start moving forward (-Z) then hold backward: desired forward is zero,
    // so velocity approaches zero without ever crossing into reverse (+Z).
    const { move } = clampForward({ x: 0, y: 0, z: -1 })
    const desired = desiredVelocity(move, 0, 0, 8)
    let vel = { x: 0, y: 0, z: -8 }
    for (let i = 0; i < 5; i++) {
      vel = stepVelocity(vel, desired, PLAYER_MOTION, 0.1)
    }
    expect(vel.z).toBeGreaterThan(-8) // decayed toward zero
    expect(vel.z).toBeLessThanOrEqual(0) // never reversed past zero into +Z
  })
})
