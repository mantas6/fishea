import { describe, it, expect } from 'vitest'
import {
  AI_CONFIG,
  makeRng,
  classifyNeighbor,
  perceive,
  nearestThreat,
  nearestPrey,
  fleeDirection,
  chaseDirection,
  wanderStep,
  eatRange,
  canEat,
  inEatRange,
  resolveEat,
  decideBehavior,
  vlen,
  vdot,
  vsub,
} from '../behavior.js'

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

function vdist2(a, b) {
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
