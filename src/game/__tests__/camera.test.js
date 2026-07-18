import { describe, it, expect } from 'vitest'
import {
  damp,
  dampVector,
  computeCameraTarget,
  CAMERA_DEFAULTS,
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
})
