import { describe, it, expect } from 'vitest'
import {
  STATS_CONFIG,
  createStats,
  tickStats,
  eat,
  damage,
  sprintAllowed,
  isDead,
} from '../stats.js'

describe('createStats', () => {
  it('starts full and alive', () => {
    const s = createStats()
    expect(s.hp).toBe(STATS_CONFIG.hpMax)
    expect(s.hunger).toBe(STATS_CONFIG.hungerMax)
    expect(s.stamina).toBe(STATS_CONFIG.staminaMax)
    expect(s.exhausted).toBe(false)
    expect(s.alive).toBe(true)
  })
})

describe('tickStats — hunger drain', () => {
  it('drains hunger over time', () => {
    const s = createStats()
    const next = tickStats(s, 1, { sprinting: false })
    expect(next.hunger).toBeCloseTo(STATS_CONFIG.hungerMax - STATS_CONFIG.hungerDrainRate)
  })

  it('is pure (does not mutate input)', () => {
    const s = createStats()
    tickStats(s, 1, { sprinting: false })
    expect(s.hunger).toBe(STATS_CONFIG.hungerMax)
  })

  it('never drives hunger below zero', () => {
    const s = { ...createStats(), hunger: 0.5 }
    const next = tickStats(s, 5, { sprinting: false })
    expect(next.hunger).toBe(0)
  })
})

describe('tickStats — starvation hp drain', () => {
  it('drains hp when hunger is empty', () => {
    const s = { ...createStats(), hunger: 0 }
    const next = tickStats(s, 1, { sprinting: false })
    expect(next.hp).toBeCloseTo(STATS_CONFIG.hpMax - STATS_CONFIG.starvationHpRate)
  })

  it('does not drain hp while there is still hunger left', () => {
    const s = { ...createStats(), hunger: 50, hp: 80 }
    const next = tickStats(s, 1, { sprinting: false })
    expect(next.hp).toBe(80)
  })

  it('marks the fish dead when starvation empties hp', () => {
    const s = { ...createStats(), hunger: 0, hp: 1 }
    const next = tickStats(s, 1, { sprinting: false })
    expect(next.hp).toBe(0)
    expect(next.alive).toBe(false)
    expect(isDead(next)).toBe(true)
  })
})

describe('tickStats — hp regen when well fed', () => {
  it('regenerates hp when hunger is high', () => {
    const s = { ...createStats(), hunger: STATS_CONFIG.wellFedThreshold + 20, hp: 50 }
    const next = tickStats(s, 1, { sprinting: false })
    expect(next.hp).toBeCloseTo(50 + STATS_CONFIG.hpRegenRate)
  })

  it('does not exceed hpMax', () => {
    const s = { ...createStats(), hunger: 100, hp: STATS_CONFIG.hpMax }
    const next = tickStats(s, 5, { sprinting: false })
    expect(next.hp).toBe(STATS_CONFIG.hpMax)
  })

  it('does not regen when hunger is only moderate', () => {
    const s = { ...createStats(), hunger: STATS_CONFIG.wellFedThreshold, hp: 50 }
    const next = tickStats(s, 1, { sprinting: false })
    expect(next.hp).toBe(50)
  })
})

describe('tickStats — stamina drain / regen', () => {
  it('drains stamina while sprinting', () => {
    const s = createStats()
    const next = tickStats(s, 1, { sprinting: true })
    expect(next.stamina).toBeCloseTo(STATS_CONFIG.staminaMax - STATS_CONFIG.staminaDrainRate)
  })

  it('regenerates stamina while not sprinting', () => {
    const s = { ...createStats(), stamina: 40 }
    const next = tickStats(s, 1, { sprinting: false })
    expect(next.stamina).toBeCloseTo(40 + STATS_CONFIG.staminaRegenRate)
  })

  it('caps stamina at max', () => {
    const s = { ...createStats(), stamina: STATS_CONFIG.staminaMax }
    const next = tickStats(s, 5, { sprinting: false })
    expect(next.stamina).toBe(STATS_CONFIG.staminaMax)
  })
})

describe('stamina exhaustion lockout', () => {
  it('locks out sprinting once stamina hits zero', () => {
    const s = { ...createStats(), stamina: 5 }
    const next = tickStats(s, 1, { sprinting: true })
    expect(next.stamina).toBe(0)
    expect(next.exhausted).toBe(true)
    expect(sprintAllowed(next)).toBe(false)
  })

  it('stays locked out until stamina recovers above the threshold', () => {
    let s = { ...createStats(), stamina: 0, exhausted: true }
    // Tick a little: still below the recover threshold => still locked.
    s = tickStats(s, 1, { sprinting: false })
    expect(s.stamina).toBeLessThan(STATS_CONFIG.exhaustionRecover)
    expect(s.exhausted).toBe(true)
    expect(sprintAllowed(s)).toBe(false)

    // Keep recovering until we cross the threshold => lockout clears.
    for (let i = 0; i < 10; i++) s = tickStats(s, 1, { sprinting: false })
    expect(s.stamina).toBeGreaterThanOrEqual(STATS_CONFIG.exhaustionRecover)
    expect(s.exhausted).toBe(false)
    expect(sprintAllowed(s)).toBe(true)
  })

  it('sprintAllowed is false when stamina is empty even without the flag', () => {
    const s = { ...createStats(), stamina: 0, exhausted: false }
    expect(sprintAllowed(s)).toBe(false)
  })
})

describe('eat', () => {
  it('restores hunger proportional to prey size', () => {
    const s = { ...createStats(), hunger: 20 }
    const next = eat(s, 2)
    expect(next.hunger).toBeCloseTo(20 + 2 * STATS_CONFIG.hungerPerSize)
  })

  it('caps hunger at max', () => {
    const s = { ...createStats(), hunger: 90 }
    const next = eat(s, 5)
    expect(next.hunger).toBe(STATS_CONFIG.hungerMax)
  })

  it('does nothing when dead', () => {
    const s = { ...createStats(), alive: false, hunger: 10 }
    expect(eat(s, 3)).toBe(s)
  })
})

describe('damage', () => {
  it('reduces hp and reports not dead', () => {
    const s = createStats()
    const { stats, dead } = damage(s, 30)
    expect(stats.hp).toBe(STATS_CONFIG.hpMax - 30)
    expect(dead).toBe(false)
    expect(stats.alive).toBe(true)
  })

  it('reports death when hp reaches zero', () => {
    const s = { ...createStats(), hp: 20 }
    const { stats, dead } = damage(s, 25)
    expect(stats.hp).toBe(0)
    expect(dead).toBe(true)
    expect(stats.alive).toBe(false)
  })

  it('ignores negative damage', () => {
    const s = createStats()
    const { stats } = damage(s, -10)
    expect(stats.hp).toBe(STATS_CONFIG.hpMax)
  })

  it('is a no-op reporting dead when already dead', () => {
    const s = { ...createStats(), alive: false, hp: 0 }
    const { stats, dead } = damage(s, 10)
    expect(stats).toBe(s)
    expect(dead).toBe(true)
  })
})

describe('tickStats — dead is frozen', () => {
  it('returns the same object once dead', () => {
    const s = { ...createStats(), alive: false }
    expect(tickStats(s, 1, { sprinting: true })).toBe(s)
  })
})
