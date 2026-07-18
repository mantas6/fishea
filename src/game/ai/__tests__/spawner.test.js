import { describe, it, expect } from 'vitest'
import { makeRng } from '../behavior.js'
import { WORLD } from '../../movement.js'
import {
  SPAWN_CONFIG,
  rollSizeCategory,
  rollSize,
  pickSpawnPosition,
  shouldDespawn,
} from '../spawner.js'

describe('rollSizeCategory', () => {
  it('produces roughly the configured 60/25/15 distribution', () => {
    const rng = makeRng(12345)
    const counts = { smaller: 0, similar: 0, bigger: 0 }
    const N = 10000
    for (let i = 0; i < N; i++) counts[rollSizeCategory(rng, SPAWN_CONFIG)]++

    expect(counts.smaller / N).toBeCloseTo(SPAWN_CONFIG.smallerPct, 1)
    expect(counts.similar / N).toBeCloseTo(SPAWN_CONFIG.similarPct, 1)
    expect(counts.bigger / N).toBeCloseTo(1 - SPAWN_CONFIG.smallerPct - SPAWN_CONFIG.similarPct, 1)
  })

  it('is deterministic for a fixed seed', () => {
    const a = makeRng(99)
    const b = makeRng(99)
    for (let i = 0; i < 100; i++) {
      expect(rollSizeCategory(a, SPAWN_CONFIG)).toBe(rollSizeCategory(b, SPAWN_CONFIG))
    }
  })
})

describe('rollSize', () => {
  it('mostly yields smaller-than-player sizes but sometimes bigger', () => {
    const rng = makeRng(2024)
    const playerSize = 2
    let smaller = 0
    let bigger = 0
    const N = 2000
    for (let i = 0; i < N; i++) {
      const s = rollSize(playerSize, rng, SPAWN_CONFIG)
      if (s < playerSize) smaller++
      else if (s > playerSize) bigger++
    }
    expect(smaller).toBeGreaterThan(bigger)
    expect(bigger).toBeGreaterThan(0)
  })

  it('never exceeds the absolute size cap', () => {
    const rng = makeRng(5)
    for (let i = 0; i < 500; i++) {
      const s = rollSize(100, rng, SPAWN_CONFIG, 6)
      expect(s).toBeLessThanOrEqual(6)
      expect(s).toBeGreaterThan(0)
    }
  })
})

describe('pickSpawnPosition', () => {
  it('always spawns at least minSpawnDist (XZ) from the player', () => {
    const rng = makeRng(77)
    const player = { x: 0, y: 20, z: 0 }
    for (let i = 0; i < 500; i++) {
      const p = pickSpawnPosition(player, rng, SPAWN_CONFIG, WORLD)
      const dist = Math.hypot(p.x - player.x, p.z - player.z)
      expect(dist).toBeGreaterThanOrEqual(SPAWN_CONFIG.minSpawnDist - 1e-6)
    }
  })

  it('spawns inside the world bounds (radius + vertical)', () => {
    const rng = makeRng(321)
    const player = { x: 0, y: 20, z: 0 }
    const minY = WORLD.seafloorY + WORLD.fishFloorMargin
    const maxY = WORLD.surfaceY - WORLD.fishSurfaceMargin
    for (let i = 0; i < 500; i++) {
      const p = pickSpawnPosition(player, rng, SPAWN_CONFIG, WORLD)
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(WORLD.radius + 1e-6)
      expect(p.y).toBeGreaterThanOrEqual(minY - 1e-6)
      expect(p.y).toBeLessThanOrEqual(maxY + 1e-6)
    }
  })

  it('keeps its distance even when the player hugs the world edge', () => {
    const rng = makeRng(9)
    const player = { x: WORLD.radius - 5, y: 20, z: 0 }
    for (let i = 0; i < 200; i++) {
      const p = pickSpawnPosition(player, rng, SPAWN_CONFIG, WORLD)
      const dist = Math.hypot(p.x - player.x, p.z - player.z)
      expect(dist).toBeGreaterThanOrEqual(SPAWN_CONFIG.minSpawnDist - 1e-6)
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(WORLD.radius + 1e-6)
    }
  })
})

describe('shouldDespawn', () => {
  it('recycles fish beyond the despawn distance', () => {
    const player = { x: 0, y: 20, z: 0 }
    const near = { x: 10, y: 20, z: 0 }
    const far = { x: SPAWN_CONFIG.despawnDist + 10, y: 20, z: 0 }
    expect(shouldDespawn(near, player, SPAWN_CONFIG)).toBe(false)
    expect(shouldDespawn(far, player, SPAWN_CONFIG)).toBe(true)
  })
})
