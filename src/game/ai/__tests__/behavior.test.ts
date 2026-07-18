import { describe, it, expect } from 'vitest'
import {
  AI_CONFIG,
  TRAIT_CONFIG,
  FLEE_FATIGUE,
  DEFAULT_TRAITS,
  makeRng,
  rollFishTraits,
  applyTraits,
  classifyNeighbor,
  perceive,
  nearestThreat,
  nearestPrey,
  fleeDirection,
  jitterDirection,
  chaseDirection,
  wanderStep,
  fishCruiseSpeed,
  fishChaseSpeed,
  fishFleeSpeed,
  stepFleeStamina,
  fatiguedFleeSpeed,
  eatRange,
  canEat,
  inEatRange,
  resolveEat,
  scanBiteTargets,
  BITE_FACING_DOT,
  decideBehavior,
  vlen,
  vdot,
  vsub,
} from '../behavior.js'
import { PLAYER_MOTION } from '../../movement.js'

describe('classifyNeighbor', () => {
  it('flags bigger fish as threats at the 1.25x threshold', () => {
    expect(classifyNeighbor(2, 2 * 1.25)).toBe('threat')
    expect(classifyNeighbor(2, 2 * 1.25 + 0.01)).toBe('threat')
    expect(classifyNeighbor(2, 2 * 1.24)).toBe('neutral')
  })

  it('flags smaller fish as prey at the 0.8x threshold', () => {
    expect(classifyNeighbor(2, 2 * 0.8)).toBe('prey')
    expect(classifyNeighbor(2, 2 * 0.8 - 0.01)).toBe('prey')
    expect(classifyNeighbor(2, 2 * 0.81)).toBe('neutral')
  })

  it('similar sizes are neutral', () => {
    expect(classifyNeighbor(2, 2)).toBe('neutral')
    expect(classifyNeighbor(2, 2.1)).toBe('neutral')
  })
})

describe('perceive', () => {
  const self = { position: { x: 0, y: 0, z: 0 }, size: 2 }

  it('buckets neighbours within sense radius and ignores far ones', () => {
    const neighbors = [
      { position: { x: 5, y: 0, z: 0 }, size: 4 }, // threat, close
      { position: { x: 0, y: 0, z: 5 }, size: 1 }, // prey, close
      { position: { x: 0, y: 0, z: 3 }, size: 2 }, // neutral, close
      { position: { x: 999, y: 0, z: 0 }, size: 1 }, // prey but out of range
    ]
    const { threats, prey, neutral } = perceive(self, neighbors, AI_CONFIG)
    expect(threats).toHaveLength(1)
    expect(prey).toHaveLength(1)
    expect(neutral).toHaveLength(1)
  })

  it('excludes self by identity', () => {
    const result = perceive(self, [self], AI_CONFIG)
    expect(result.threats.length + result.prey.length + result.neutral.length).toBe(0)
  })
})

describe('nearestThreat / nearestPrey', () => {
  const self = { position: { x: 0, y: 0, z: 0 }, size: 2 }

  it('returns the closest threat within sense radius', () => {
    const near = { position: { x: 10, y: 0, z: 0 }, size: 5 }
    const far = { position: { x: 20, y: 0, z: 0 }, size: 5 }
    expect(nearestThreat(self, [far, near], AI_CONFIG)).toBe(near)
  })

  it('ignores threats beyond sense radius', () => {
    const tooFar = { position: { x: 100, y: 0, z: 0 }, size: 5 }
    expect(nearestThreat(self, [tooFar], AI_CONFIG)).toBeNull()
  })

  it('only chases prey within the shorter aggro radius', () => {
    const inside = { position: { x: 10, y: 0, z: 0 }, size: 1 }
    const outside = { position: { x: AI_CONFIG.aggroRadius + 5, y: 0, z: 0 }, size: 1 }
    expect(nearestPrey(self, [outside], AI_CONFIG)).toBeNull()
    expect(nearestPrey(self, [inside], AI_CONFIG)).toBe(inside)
  })
})

describe('fleeDirection', () => {
  it('points directly away from the threat (unit length)', () => {
    const self = { x: 0, y: 0, z: 0 }
    const threat = { x: 10, y: 0, z: 0 }
    const dir = fleeDirection(self, threat)
    expect(vlen(dir)).toBeCloseTo(1)
    // Away from threat => negative dot with (threat - self).
    expect(vdot(dir, vsub(threat, self))).toBeLessThan(0)
    expect(dir.x).toBeCloseTo(-1)
  })
})

describe('chaseDirection', () => {
  it('points toward the prey (unit length)', () => {
    const self = { x: 0, y: 0, z: 0 }
    const prey = { x: 0, y: 0, z: 8 }
    const dir = chaseDirection(self, prey)
    expect(vlen(dir)).toBeCloseTo(1)
    expect(vdot(dir, vsub(prey, self))).toBeGreaterThan(0)
    expect(dir.z).toBeCloseTo(1)
  })
})

describe('wanderStep', () => {
  it('always returns a unit heading', () => {
    const rng = makeRng(42)
    let h = { x: 0, y: 0, z: -1 }
    for (let i = 0; i < 50; i++) {
      h = wanderStep(h, rng, 0.1, AI_CONFIG)
      expect(vlen(h)).toBeCloseTo(1)
    }
  })

  it('changes heading over time', () => {
    const rng = makeRng(7)
    const start = { x: 0, y: 0, z: -1 }
    const next = wanderStep(start, rng, 0.5, AI_CONFIG)
    expect(vdist2(start, next)).toBeGreaterThan(0)
  })
})

function vdist2(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

describe('eatRange / canEat / inEatRange', () => {
  it('eat range scales with eater size', () => {
    expect(eatRange(1)).toBeCloseTo(AI_CONFIG.eatRangeBase)
    expect(eatRange(3)).toBeCloseTo(AI_CONFIG.eatRangeBase * 3)
  })

  it('canEat only when the target is prey-sized', () => {
    expect(canEat({ size: 2 }, { size: 1 })).toBe(true)
    expect(canEat({ size: 2 }, { size: 2 })).toBe(false)
    expect(canEat({ size: 2 }, { size: 3 })).toBe(false)
  })

  it('inEatRange respects distance vs eater size', () => {
    const eater = { position: { x: 0, y: 0, z: 0 }, size: 2 }
    const close = { position: { x: 2, y: 0, z: 0 } }
    const far = { position: { x: 50, y: 0, z: 0 } }
    expect(inEatRange(eater, close)).toBe(true)
    expect(inEatRange(eater, far)).toBe(false)
  })
})

describe('scanBiteTargets', () => {
  // Player at origin facing +Z (heading matches chaseDirection toward +Z prey).
  const eater = { position: { x: 0, y: 0, z: 0 }, size: 2, heading: { x: 0, y: 0, z: 1 } }

  it('picks the nearest eat-eligible prey inside the forward cone', () => {
    const near = { position: { x: 0, y: 0, z: 1 }, size: 1 }
    const far = { position: { x: 0, y: 0, z: 3 }, size: 1 }
    const { prey, tooBig } = scanBiteTargets(eater, [far, near], AI_CONFIG)
    expect(prey).toBe(near)
    expect(tooBig).toBeNull()
  })

  it('ignores prey behind the eater (outside the cone)', () => {
    const behind = { position: { x: 0, y: 0, z: -1 }, size: 1 }
    expect(scanBiteTargets(eater, [behind], AI_CONFIG).prey).toBeNull()
  })

  it('ignores prey beyond eat range', () => {
    const range = eatRange(eater.size, AI_CONFIG)
    const tooFar = { position: { x: 0, y: 0, z: range + 1 }, size: 1 }
    expect(scanBiteTargets(eater, [tooFar], AI_CONFIG).prey).toBeNull()
  })

  it('reports an in-cone but too-big fish as tooBig, not prey', () => {
    const big = { position: { x: 0, y: 0, z: 1 }, size: 10 }
    const { prey, tooBig } = scanBiteTargets(eater, [big], AI_CONFIG)
    expect(prey).toBeNull()
    expect(tooBig).toBe(big)
  })

  it('skips dead targets', () => {
    const dead = { position: { x: 0, y: 0, z: 1 }, size: 1, alive: false }
    expect(scanBiteTargets(eater, [dead], AI_CONFIG).prey).toBeNull()
  })

  it('respects the facing-dot threshold at the cone edge', () => {
    // A target exactly on the cone boundary has heading·toTarget == threshold.
    const angle = Math.acos(BITE_FACING_DOT)
    const inside = {
      position: { x: Math.sin(angle - 0.05), y: 0, z: Math.cos(angle - 0.05) },
      size: 1,
    }
    const outside = {
      position: { x: Math.sin(angle + 0.05), y: 0, z: Math.cos(angle + 0.05) },
      size: 1,
    }
    expect(scanBiteTargets(eater, [inside], AI_CONFIG).prey).toBe(inside)
    expect(scanBiteTargets(eater, [outside], AI_CONFIG).prey).toBeNull()
  })
})

describe('resolveEat', () => {
  it('grows the eater by a fraction of the prey size', () => {
    const { growth, newSize } = resolveEat({ size: 2 }, { size: 1 }, AI_CONFIG)
    expect(growth).toBeCloseTo(AI_CONFIG.growthFraction * 1)
    expect(newSize).toBeCloseTo(2 + AI_CONFIG.growthFraction * 1)
  })

  it('respects the max size cap', () => {
    const eater = { size: AI_CONFIG.maxSize - 0.1 }
    const { growth, newSize } = resolveEat(eater, { size: 4 }, AI_CONFIG)
    expect(newSize).toBe(AI_CONFIG.maxSize)
    expect(growth).toBeCloseTo(0.1)
  })

  it('never exceeds the cap even for a huge prey', () => {
    const { newSize } = resolveEat({ size: AI_CONFIG.maxSize }, { size: 100 }, AI_CONFIG)
    expect(newSize).toBe(AI_CONFIG.maxSize)
  })
})

describe('rollFishTraits', () => {
  it('is deterministic for a fixed seed', () => {
    const a = makeRng(99)
    const b = makeRng(99)
    for (let i = 0; i < 100; i++) {
      expect(rollFishTraits(a, TRAIT_CONFIG)).toEqual(rollFishTraits(b, TRAIT_CONFIG))
    }
  })

  it('rolls roughly the configured fraction of sluggish fish', () => {
    const rng = makeRng(2024)
    let sluggish = 0
    const N = 10000
    for (let i = 0; i < N; i++) if (rollFishTraits(rng, TRAIT_CONFIG).sluggish) sluggish++
    expect(sluggish / N).toBeCloseTo(TRAIT_CONFIG.sluggishChance, 1)
  })

  it('biases guaranteed-eatable prey more sluggish than ordinary fish', () => {
    const rng = makeRng(7)
    let ordinary = 0
    let eatable = 0
    const N = 10000
    for (let i = 0; i < N; i++) if (rollFishTraits(rng, TRAIT_CONFIG).sluggish) ordinary++
    for (let i = 0; i < N; i++)
      if (rollFishTraits(rng, TRAIT_CONFIG, { eatable: true }).sluggish) eatable++
    expect(eatable).toBeGreaterThan(ordinary)
    expect(eatable / N).toBeCloseTo(TRAIT_CONFIG.eatableSluggishChance, 1)
  })

  it('ordinary fish carry no modifiers; sluggish fish are slower and less agile', () => {
    const rng = makeRng(1)
    for (let i = 0; i < 500; i++) {
      const t = rollFishTraits(rng, TRAIT_CONFIG)
      if (t.sluggish) {
        expect(t.speedMult).toBeGreaterThanOrEqual(TRAIT_CONFIG.sluggishSpeed[0])
        expect(t.speedMult).toBeLessThanOrEqual(TRAIT_CONFIG.sluggishSpeed[1])
        expect(t.speedMult).toBeLessThan(1)
        expect(t.turnMult).toBeLessThan(1)
        expect(t.senseMult).toBeLessThan(1)
        expect(t.wanderMult).toBeLessThan(1)
      } else {
        expect(t).toEqual(DEFAULT_TRAITS)
      }
    }
  })

  it('always makes fish sluggish when the chance is 1', () => {
    const rng = makeRng(3)
    const cfg = { ...TRAIT_CONFIG, sluggishChance: 1 }
    for (let i = 0; i < 100; i++) expect(rollFishTraits(rng, cfg).sluggish).toBe(true)
  })
})

describe('applyTraits', () => {
  it('leaves the base config untouched for default traits', () => {
    const cfg = applyTraits(AI_CONFIG, DEFAULT_TRAITS)
    expect(cfg).toEqual(AI_CONFIG)
    expect(cfg).not.toBe(AI_CONFIG) // returns a fresh object
  })

  it('scales flee (burst) speed and other movement fields by the traits', () => {
    const traits = {
      sluggish: true,
      speedMult: 0.5,
      turnMult: 0.6,
      senseMult: 0.6,
      wanderMult: 0.55,
    }
    const cfg = applyTraits(AI_CONFIG, traits)
    // Flee-speed math: a sluggish fish bursts at half the normal panic speed.
    expect(cfg.burstSpeed).toBeCloseTo(AI_CONFIG.burstSpeed * 0.5)
    expect(cfg.chaseSpeed).toBeCloseTo(AI_CONFIG.chaseSpeed * 0.5)
    expect(cfg.cruiseSpeed).toBeCloseTo(AI_CONFIG.cruiseSpeed * 0.5)
    // Both the caps and the size ramps scale, so a sluggish fish is slower at
    // every size.
    expect(cfg.burstSpeedPerSize).toBeCloseTo(AI_CONFIG.burstSpeedPerSize * 0.5)
    expect(cfg.chaseSpeedPerSize).toBeCloseTo(AI_CONFIG.chaseSpeedPerSize * 0.5)
    expect(cfg.cruiseSpeedPerSize).toBeCloseTo(AI_CONFIG.cruiseSpeedPerSize * 0.5)
    expect(cfg.turnRate).toBeCloseTo(AI_CONFIG.turnRate * 0.6)
    expect(cfg.senseRadius).toBeCloseTo(AI_CONFIG.senseRadius * 0.6)
    expect(cfg.wanderRate).toBeCloseTo(AI_CONFIG.wanderRate * 0.55)
  })

  it('does not change eating / classification fields', () => {
    const traits = {
      sluggish: true,
      speedMult: 0.5,
      turnMult: 0.6,
      senseMult: 0.6,
      wanderMult: 0.55,
    }
    const cfg = applyTraits(AI_CONFIG, traits)
    expect(cfg.eatRangeBase).toBe(AI_CONFIG.eatRangeBase)
    expect(cfg.preyRatio).toBe(AI_CONFIG.preyRatio)
    expect(cfg.threatRatio).toBe(AI_CONFIG.threatRatio)
    expect(cfg.aggroRadius).toBe(AI_CONFIG.aggroRadius)
  })
})

describe('size-scaled swim speeds', () => {
  it('small fish are slow; speed grows with size up to a cap', () => {
    // Cruise < chase < flee at any given size, and each ramps up with size.
    expect(fishFleeSpeed(0.5)).toBeLessThan(fishFleeSpeed(1.5))
    expect(fishFleeSpeed(1.5)).toBeLessThan(fishFleeSpeed(3))
    // Caps hold: a huge fish never exceeds the configured ceilings.
    expect(fishCruiseSpeed(100)).toBeCloseTo(AI_CONFIG.cruiseSpeed)
    expect(fishChaseSpeed(100)).toBeCloseTo(AI_CONFIG.chaseSpeed)
    expect(fishFleeSpeed(100)).toBeCloseTo(AI_CONFIG.burstSpeed)
  })

  it('keeps cruise < chase < flee for every size so prey never flee slower than they wander', () => {
    for (let size = 0.2; size <= AI_CONFIG.maxSize; size += 0.2) {
      const cruise = fishCruiseSpeed(size)
      const chase = fishChaseSpeed(size)
      const flee = fishFleeSpeed(size)
      expect(cruise).toBeLessThanOrEqual(chase + 1e-9)
      expect(chase).toBeLessThanOrEqual(flee + 1e-9)
    }
  })

  it('reads a fish\'s traits straight off the folded config', () => {
    const traits = { sluggish: true, speedMult: 0.5, turnMult: 0.6, senseMult: 0.6, wanderMult: 0.55 }
    const cfg = applyTraits(AI_CONFIG, traits)
    // A sluggish fish flees at half the speed of an ordinary one of the same size.
    expect(fishFleeSpeed(2, cfg)).toBeCloseTo(fishFleeSpeed(2) * 0.5)
  })
})

describe('flee fatigue', () => {
  it('drains while fleeing and recovers otherwise, clamped to [0,1]', () => {
    expect(stepFleeStamina(1, true, 1)).toBeCloseTo(1 - FLEE_FATIGUE.drainPerSec)
    expect(stepFleeStamina(0, true, 1)).toBe(0) // can't go negative
    expect(stepFleeStamina(0, false, 1)).toBeCloseTo(FLEE_FATIGUE.recoverPerSec)
    expect(stepFleeStamina(1, false, 1)).toBe(1) // can't exceed full
  })

  it('a fully winded fish flees at tiredSpeedMult of its fresh speed', () => {
    const fresh = fishFleeSpeed(3)
    expect(fatiguedFleeSpeed(fresh, 1)).toBeCloseTo(fresh) // fresh => full speed
    expect(fatiguedFleeSpeed(fresh, 0)).toBeCloseTo(fresh * FLEE_FATIGUE.tiredSpeedMult)
    // Monotonic: less stamina => slower.
    expect(fatiguedFleeSpeed(fresh, 0.5)).toBeLessThan(fatiguedFleeSpeed(fresh, 1))
    expect(fatiguedFleeSpeed(fresh, 0.5)).toBeGreaterThan(fatiguedFleeSpeed(fresh, 0))
  })
})

describe('jitterDirection', () => {
  it('returns a unit vector that stays roughly aligned with the input heading', () => {
    const rng = makeRng(5)
    const dir = { x: 0, y: 0, z: 1 }
    for (let i = 0; i < 200; i++) {
      const j = jitterDirection(dir, rng)
      expect(vlen(j)).toBeCloseTo(1)
      // Small nudge only: still points broadly the same way (positive dot).
      expect(vdot(j, dir)).toBeGreaterThan(0.5)
    }
  })
})

describe('chase math invariant: eatable prey are catchable', () => {
  const PLAYER_SPRINT = PLAYER_MOTION.maxSpeed * PLAYER_MOTION.sprintMultiplier // 14.4

  it('every eatable-size fish, worst-case (fastest) traits, flees below the player sprint by a healthy margin', () => {
    // Worst case for the player = the fastest possible eatable fish: ordinary
    // (non-sluggish) traits and fresh (unfatigued) burst. For any player size up
    // to the cap, the biggest fish it can eat is player.size * preyRatio.
    const fastest = applyTraits(AI_CONFIG, DEFAULT_TRAITS)
    for (let playerSize = 0.6; playerSize <= AI_CONFIG.maxSize; playerSize += 0.2) {
      const biggestEatable = playerSize * AI_CONFIG.preyRatio
      const fresh = fishFleeSpeed(biggestEatable, fastest)
      // Healthy margin: prey flee at most 80% of the player's sprint speed.
      expect(fresh).toBeLessThan(PLAYER_SPRINT * 0.8)
    }
  })

  it('the very biggest eatable prey in the game still flees well under the sprint', () => {
    const biggest = AI_CONFIG.maxSize * AI_CONFIG.preyRatio // 4.8
    expect(fishFleeSpeed(biggest)).toBeLessThan(PLAYER_SPRINT)
    // ...and once it tires it drops below even the player's base cruise speed,
    // so a sustained chase always closes the gap.
    expect(fatiguedFleeSpeed(fishFleeSpeed(biggest), 0)).toBeLessThan(PLAYER_MOTION.maxSpeed)
  })
})

describe('decideBehavior', () => {
  const self = { position: { x: 0, y: 0, z: 0 }, size: 2 }

  it('flee overrides chase', () => {
    const threat = { position: { x: 5, y: 0, z: 0 }, size: 5 }
    const prey = { position: { x: 0, y: 0, z: 5 }, size: 1 }
    expect(decideBehavior(self, [threat, prey], AI_CONFIG).mode).toBe('flee')
  })

  it('chases prey when no threat present', () => {
    const prey = { position: { x: 0, y: 0, z: 5 }, size: 1 }
    const decision = decideBehavior(self, [prey], AI_CONFIG)
    expect(decision.mode).toBe('chase')
    expect(decision.target).toBe(prey)
  })

  it('wanders when alone', () => {
    expect(decideBehavior(self, [], AI_CONFIG).mode).toBe('wander')
  })
})
