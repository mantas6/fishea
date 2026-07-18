import { describe, it, expect } from 'vitest'
import { AI_CONFIG, canEat, makeRng } from '../behavior.js'
import { WORLD } from '../../movement.js'
import {
  SPAWN_CONFIG,
  Spawner,
  rollSizeCategory,
  rollSize,
  rollEatableSize,
  countEatable,
  pickSpawnPosition,
  shouldDespawn,
} from '../spawner.js'
import type { SpawnerPlayer } from '../spawner.js'

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

describe('rollEatableSize', () => {
  it('always yields a size the player can eat', () => {
    const rng = makeRng(4242)
    for (const playerSize of [0.8, 1.6, 3, 5]) {
      for (let i = 0; i < 500; i++) {
        const s = rollEatableSize(playerSize, rng, SPAWN_CONFIG, AI_CONFIG)
        expect(canEat({ size: playerSize }, { size: s }, AI_CONFIG)).toBe(true)
        expect(s).toBeGreaterThan(0)
      }
    }
  })

  it('never exceeds the absolute size cap', () => {
    const rng = makeRng(11)
    for (let i = 0; i < 500; i++) {
      const s = rollEatableSize(100, rng, SPAWN_CONFIG, AI_CONFIG, 6)
      expect(s).toBeLessThanOrEqual(6)
    }
  })
})

describe('countEatable', () => {
  it('counts only fish below the player eat threshold', () => {
    const playerSize = 2
    const fish = [
      { size: 1 }, // eatable
      { size: 1.6 }, // == 2 * preyRatio(0.8) => eatable (<=)
      { size: 1.7 }, // above threshold => not eatable
      { size: 3 }, // bigger => not eatable
    ]
    expect(countEatable(fish, playerSize, AI_CONFIG)).toBe(2)
  })

  it('returns zero for an empty population', () => {
    expect(countEatable([], 2, AI_CONFIG)).toBe(0)
  })
})

describe('pickSpawnPosition', () => {
  it('respects a tighter maxDist override for prey spawns', () => {
    const rng = makeRng(555)
    const player = { x: 0, y: 20, z: 0 }
    for (let i = 0; i < 500; i++) {
      const p = pickSpawnPosition(player, rng, SPAWN_CONFIG, WORLD, SPAWN_CONFIG.preyMaxSpawnDist)
      const dist = Math.hypot(p.x - player.x, p.z - player.z)
      expect(dist).toBeGreaterThanOrEqual(SPAWN_CONFIG.minSpawnDist - 1e-6)
      expect(dist).toBeLessThanOrEqual(SPAWN_CONFIG.preyMaxSpawnDist + 1e-6)
    }
  })

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

describe('Spawner eatable floor', () => {
  function makePlayer(size: number): SpawnerPlayer {
    return { position: { x: 0, y: 20, z: 0 }, size, yaw: 0, pitch: 0, bite: false }
  }

  it('seeds with at least minEatable player-eatable fish', () => {
    const spawner = new Spawner({ scene: null, player: makePlayer(1.6), rng: makeRng(1) })
    spawner.seed()
    expect(countEatable(spawner.fish, spawner.player.size, spawner.aiConfig)).toBeGreaterThanOrEqual(
      SPAWN_CONFIG.minEatable,
    )
  })

  it('refills the eatable floor after prey are eaten away', () => {
    const spawner = new Spawner({ scene: null, player: makePlayer(1.6), rng: makeRng(2) })
    spawner.seed()
    // Simulate the player eating every prey-sized fish (frees population slots,
    // just like real bites do), dropping the stock below the floor.
    for (let i = spawner.fish.length - 1; i >= 0; i--) {
      if (canEat({ size: spawner.player.size }, spawner.fish[i], spawner.aiConfig)) {
        spawner._removeAt(i)
      }
    }
    expect(countEatable(spawner.fish, spawner.player.size, spawner.aiConfig)).toBe(0)
    // One update should restore the eatable floor relative to the player size.
    spawner.update(0.016, { attackPlayer: false })
    expect(countEatable(spawner.fish, spawner.player.size, spawner.aiConfig)).toBeGreaterThanOrEqual(
      SPAWN_CONFIG.minEatable,
    )
    spawner.dispose()
  })

  it('never exceeds the max population while topping up prey', () => {
    const spawner = new Spawner({ scene: null, player: makePlayer(0.5), rng: makeRng(3) })
    spawner.seed()
    for (let i = 0; i < 20; i++) spawner.update(0.016, { attackPlayer: false })
    expect(spawner.population).toBeLessThanOrEqual(SPAWN_CONFIG.maxPopulation)
    spawner.dispose()
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
