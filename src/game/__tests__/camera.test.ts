import { describe, it, expect } from 'vitest'
import {
  damp,
  dampVector,
  computeCameraTarget,
  CAMERA_DEFAULTS,
  createOrbitState,
  updateOrbitState,
  ORBIT_DEFAULTS,
} from '../camera.js'

describe('damp', () => {
  it('returns the current value when dt is 0', () => {
    expect(damp(5, 10, 4, 0)).toBeCloseTo(5)
  })

  it('moves toward the target and reaches it with large dt', () => {
    const mid = damp(0, 10, 4, 0.1)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(10)
    expect(damp(0, 10, 4, 100)).toBeCloseTo(10)
  })

  it('never overshoots', () => {
    const v = damp(0, 10, 8, 0.25)
    expect(v).toBeLessThanOrEqual(10)
  })
})

describe('dampVector', () => {
  it('damps each axis toward the target', () => {
    const out = dampVector({ x: 0, y: 0, z: 0 }, { x: 10, y: 20, z: -10 }, 4, 100)
    expect(out.x).toBeCloseTo(10)
    expect(out.y).toBeCloseTo(20)
    expect(out.z).toBeCloseTo(-10)
  })
})

describe('computeCameraTarget', () => {
  const player = { x: 0, y: 20, z: 0 }

  it('places the camera behind and above the fish', () => {
    // yaw 0 => fish faces -Z, so "behind" is +Z.
    const { position } = computeCameraTarget(player, 0, 0, CAMERA_DEFAULTS)
    expect(position.z).toBeCloseTo(CAMERA_DEFAULTS.distance)
    expect(position.y).toBeCloseTo(player.y + CAMERA_DEFAULTS.height)
    expect(position.x).toBeCloseTo(0)
  })

  it('aims ahead of the fish', () => {
    const { lookAt } = computeCameraTarget(player, 0, 0, CAMERA_DEFAULTS)
    // ahead is -Z of the player
    expect(lookAt.z).toBeCloseTo(-CAMERA_DEFAULTS.lookAhead)
  })

  it('rotates the offset with yaw', () => {
    // yaw = +90deg => fish faces +X (dir.x = -sin(yaw) = -1)... check behind side
    const { position } = computeCameraTarget(player, Math.PI / 2, 0, CAMERA_DEFAULTS)
    // behind is -dir * distance; dir = {x:-1,y:0,z:0} => position.x = +distance
    expect(position.x).toBeCloseTo(CAMERA_DEFAULTS.distance)
    expect(position.z).toBeCloseTo(0)
  })

  it('keeps a constant distance from the fish on the horizontal plane', () => {
    const { position } = computeCameraTarget(player, 1.2, 0, CAMERA_DEFAULTS)
    const horiz = Math.hypot(position.x - player.x, position.z - player.z)
    expect(horiz).toBeCloseTo(CAMERA_DEFAULTS.distance)
  })

  it('an orbit yaw of π places the camera in front of the fish', () => {
    // yaw 0 => fish faces -Z; behind (default) is +Z. Orbiting by π flips the
    // camera to the front (-Z side) while still looking ahead of the fish.
    const { position } = computeCameraTarget(player, 0, 0, CAMERA_DEFAULTS, {
      yaw: Math.PI,
      pitch: 0,
    })
    expect(position.z).toBeCloseTo(-CAMERA_DEFAULTS.distance)
    expect(position.x).toBeCloseTo(0)
    expect(position.y).toBeCloseTo(player.y + CAMERA_DEFAULTS.height)
  })

  it('a zero orbit offset matches the plain follow camera', () => {
    const base = computeCameraTarget(player, 0.7, 0.2, CAMERA_DEFAULTS)
    const orbited = computeCameraTarget(player, 0.7, 0.2, CAMERA_DEFAULTS, { yaw: 0, pitch: 0 })
    expect(orbited.position).toEqual(base.position)
    expect(orbited.lookAt).toEqual(base.lookAt)
  })

  it('orbit still frames the fish by looking ahead of its actual heading', () => {
    // Orbiting the position must not move the look-at target.
    const base = computeCameraTarget(player, 0, 0, CAMERA_DEFAULTS)
    const orbited = computeCameraTarget(player, 0, 0, CAMERA_DEFAULTS, { yaw: 1.0, pitch: 0.3 })
    expect(orbited.lookAt).toEqual(base.lookAt)
  })
})

const noLook = { x: 0, y: 0 }

describe('updateOrbitState — mode decision', () => {
  it('starts in follow mode', () => {
    expect(createOrbitState().orbiting).toBe(false)
  })

  it('movement above the epsilon stays in follow mode', () => {
    let s = createOrbitState()
    s = updateOrbitState(s, 1, noLook, 0.1)
    expect(s.orbiting).toBe(false)
  })

  it('enters orbit on the very first idle frame (no enter delay)', () => {
    // The instant movement input drops away, look must orbit the camera rather
    // than steer the fish — there is no grace window where look still steers.
    let s = createOrbitState()
    s = updateOrbitState(s, 0, noLook, 1 / 60)
    expect(s.orbiting).toBe(true)
  })

  it('treats input at/below the epsilon as idle (orbit)', () => {
    let s = createOrbitState()
    s = updateOrbitState(s, ORBIT_DEFAULTS.moveEpsilon, noLook, 1 / 60)
    expect(s.orbiting).toBe(true)
  })

  it('accumulates look into the offset from the first idle frame', () => {
    // A look delta on the same frame the player goes idle must move the camera,
    // never the fish (Game.ts zeroes the fish look while orbiting).
    let s = createOrbitState()
    s = updateOrbitState(s, 0, { x: 0.2, y: 0.1 }, 1 / 60)
    expect(s.orbiting).toBe(true)
    expect(s.yaw).toBeCloseTo(0.2)
    expect(s.pitch).toBeCloseTo(0.1)
  })

  it('exits orbit instantly when movement resumes', () => {
    let s = createOrbitState()
    s = updateOrbitState(s, 0, noLook, 0.2) // enter orbit
    expect(s.orbiting).toBe(true)
    s = updateOrbitState(s, 1, noLook, 0.016)
    expect(s.orbiting).toBe(false)
  })
})

describe('updateOrbitState — orbit accumulation', () => {
  const orbiting = () => updateOrbitState(createOrbitState(), 0, noLook, 0.2)

  it('accumulates look into the yaw/pitch offsets', () => {
    let s = orbiting()
    s = updateOrbitState(s, 0, { x: 0.3, y: 0.2 }, 0.016)
    expect(s.yaw).toBeCloseTo(0.3)
    expect(s.pitch).toBeCloseTo(0.2)
    s = updateOrbitState(s, 0, { x: 0.3, y: 0.2 }, 0.016)
    expect(s.yaw).toBeCloseTo(0.6)
    expect(s.pitch).toBeCloseTo(0.4)
  })

  it('wraps yaw into (-π, π]', () => {
    let s = orbiting()
    for (let i = 0; i < 20; i++) {
      s = updateOrbitState(s, 0, { x: 0.5, y: 0 }, 0.016)
    }
    expect(s.yaw).toBeGreaterThan(-Math.PI)
    expect(s.yaw).toBeLessThanOrEqual(Math.PI)
  })

  it('clamps pitch to ±pitchClamp', () => {
    let s = orbiting()
    for (let i = 0; i < 100; i++) {
      s = updateOrbitState(s, 0, { x: 0, y: 0.5 }, 0.016)
    }
    expect(s.pitch).toBeCloseTo(ORBIT_DEFAULTS.pitchClamp)
    for (let i = 0; i < 200; i++) {
      s = updateOrbitState(s, 0, { x: 0, y: -0.5 }, 0.016)
    }
    expect(s.pitch).toBeCloseTo(-ORBIT_DEFAULTS.pitchClamp)
  })
})

describe('updateOrbitState — decay in follow mode', () => {
  it('decays the offsets back toward zero while moving', () => {
    // Build up an offset in orbit mode.
    let s = updateOrbitState(createOrbitState(), 0, noLook, 0.2)
    s = updateOrbitState(s, 0, { x: 1.0, y: 0.8 }, 0.016)
    const startYaw = s.yaw
    const startPitch = s.pitch
    // Now move: offsets should shrink each frame.
    s = updateOrbitState(s, 1, noLook, 0.1)
    expect(Math.abs(s.yaw)).toBeLessThan(Math.abs(startYaw))
    expect(Math.abs(s.pitch)).toBeLessThan(Math.abs(startPitch))
  })

  it('converges to (near) zero after enough moving frames', () => {
    let s = updateOrbitState(createOrbitState(), 0, noLook, 0.2)
    s = updateOrbitState(s, 0, { x: 1.0, y: 0.8 }, 0.016)
    for (let i = 0; i < 200; i++) {
      s = updateOrbitState(s, 1, noLook, 0.05)
    }
    expect(s.yaw).toBeCloseTo(0)
    expect(s.pitch).toBeCloseTo(0)
  })
})
