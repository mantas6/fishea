// Pure AI fish behavior logic. Everything here operates on plain {x, y, z}
// vectors and simple fish descriptors ({ position, size }) so it can be unit
// tested in a plain node environment without importing Three.js / WebGL.
//
// A "fish descriptor" is any object shaped like:
//   { position: { x, y, z }, size: number, ... }
// The player is treated as just another fish descriptor in this reckoning.

// --- Tunable AI constants -------------------------------------------------

export const AI_CONFIG = {
  senseRadius: 42, // how far a fish can perceive neighbours
  aggroRadius: 26, // how close prey must be before a fish will give chase
  threatRatio: 1.25, // neighbour is a threat when size >= mine * this
  preyRatio: 0.8, // neighbour is prey when size <= mine * this
  wanderRate: 2.2, // how quickly the wander heading jitters
  wanderVertical: 0.35, // damp vertical jitter so fish mostly swim level
  cruiseSpeed: 6, // wander cruise speed (units/s)
  chaseSpeed: 9.5, // speed while chasing prey
  burstSpeed: 13, // panic speed while fleeing a threat
  eatRangeBase: 2.0, // eat range = eatRangeBase * eater.size
  growthFraction: 0.25, // eater grows by this fraction of the prey's size
  maxSize: 6, // hard cap on how big a fish can grow
}

// --- Tiny vector helpers (plain objects, no allocation-heavy chains) ------

export function vlen(v) {
  return Math.hypot(v.x, v.y, v.z)
}

export function vsub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function vdist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function vdot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

/**
 * Normalize a vector to unit length. When the vector is (near) zero, returns
 * the provided fallback (also normalized) or a default forward heading.
 * @param {{x:number,y:number,z:number}} v
 * @param {{x:number,y:number,z:number}} [fallback]
 * @returns {{x:number,y:number,z:number}}
 */
export function vnorm(v, fallback = { x: 0, y: 0, z: -1 }) {
  const len = vlen(v)
  if (len < 1e-6) {
    const fl = vlen(fallback)
    if (fl < 1e-6) return { x: 0, y: 0, z: -1 }
    return { x: fallback.x / fl, y: fallback.y / fl, z: fallback.z / fl }
  }
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

// --- Seedable RNG (mulberry32) --------------------------------------------

/**
 * Deterministic PRNG so behaviour + spawning can be reproduced in tests.
 * @param {number} seed
 * @returns {() => number} function returning a float in [0, 1)
 */
export function makeRng(seed = 1) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- Perception -----------------------------------------------------------

/**
 * Classify a neighbour relative to my size.
 * @param {number} mySize
 * @param {number} otherSize
 * @param {typeof AI_CONFIG} [config]
 * @returns {'threat'|'prey'|'neutral'}
 */
export function classifyNeighbor(mySize, otherSize, config = AI_CONFIG) {
  if (otherSize >= mySize * config.threatRatio) return 'threat'
  if (otherSize <= mySize * config.preyRatio) return 'prey'
  return 'neutral'
}

/**
 * Partition the neighbours within sense radius into threat/prey/neutral lists.
 * Each entry is { fish, dist, kind }.
 * @param {{position:{x:number,y:number,z:number},size:number}} self
 * @param {Array<{position:{x:number,y:number,z:number},size:number}>} neighbors
 * @param {typeof AI_CONFIG} [config]
 */
export function perceive(self, neighbors, config = AI_CONFIG) {
  const threats = []
  const prey = []
  const neutral = []
  for (const fish of neighbors) {
    if (fish === self) continue
    const dist = vdist(self.position, fish.position)
    if (dist > config.senseRadius) continue
    const kind = classifyNeighbor(self.size, fish.size, config)
    const entry = { fish, dist, kind }
    if (kind === 'threat') threats.push(entry)
    else if (kind === 'prey') prey.push(entry)
    else neutral.push(entry)
  }
  return { threats, prey, neutral }
}

/**
 * Nearest threat within sense radius, or null.
 * @returns {{position:{x:number,y:number,z:number},size:number}|null}
 */
export function nearestThreat(self, neighbors, config = AI_CONFIG) {
  let best = null
  let bestDist = Infinity
  for (const fish of neighbors) {
    if (fish === self) continue
    if (fish.size < self.size * config.threatRatio) continue
    const dist = vdist(self.position, fish.position)
    if (dist <= config.senseRadius && dist < bestDist) {
      bestDist = dist
      best = fish
    }
  }
  return best
}

/**
 * Nearest prey within aggro radius, or null. Aggro radius is shorter than the
 * sense radius so fish only commit to a chase when prey is reasonably close.
 * @returns {{position:{x:number,y:number,z:number},size:number}|null}
 */
export function nearestPrey(self, neighbors, config = AI_CONFIG) {
  let best = null
  let bestDist = Infinity
  for (const fish of neighbors) {
    if (fish === self) continue
    if (fish.size > self.size * config.preyRatio) continue
    const dist = vdist(self.position, fish.position)
    if (dist <= config.aggroRadius && dist < bestDist) {
      bestDist = dist
      best = fish
    }
  }
  return best
}

// --- Steering directions --------------------------------------------------

/**
 * Advance a (unit) wander heading with smooth random jitter. Pure — returns a
 * new normalized heading. Vertical jitter is damped so fish mostly swim level.
 * @param {{x:number,y:number,z:number}} heading current unit heading
 * @param {() => number} rng
 * @param {number} dt
 * @param {typeof AI_CONFIG} [config]
 * @returns {{x:number,y:number,z:number}}
 */
export function wanderStep(heading, rng, dt, config = AI_CONFIG) {
  const j = config.wanderRate * dt
  const next = {
    x: heading.x + (rng() - 0.5) * j,
    y: heading.y + (rng() - 0.5) * j * config.wanderVertical,
    z: heading.z + (rng() - 0.5) * j,
  }
  return vnorm(next, heading)
}

/**
 * Unit vector steering AWAY from a threat position.
 * @param {{x:number,y:number,z:number}} selfPos
 * @param {{x:number,y:number,z:number}} threatPos
 */
export function fleeDirection(selfPos, threatPos) {
  return vnorm(vsub(selfPos, threatPos))
}

/**
 * Unit vector steering TOWARD a prey position.
 * @param {{x:number,y:number,z:number}} selfPos
 * @param {{x:number,y:number,z:number}} preyPos
 */
export function chaseDirection(selfPos, preyPos) {
  return vnorm(vsub(preyPos, selfPos))
}

// --- Eating ---------------------------------------------------------------

/**
 * How close (centre to centre) an eater must be to swallow prey.
 * @param {number} eaterSize
 * @param {typeof AI_CONFIG} [config]
 */
export function eatRange(eaterSize, config = AI_CONFIG) {
  return config.eatRangeBase * eaterSize
}

/**
 * Whether an eater is allowed to eat a target (target is prey-sized).
 * @param {{size:number}} eater
 * @param {{size:number}} target
 * @param {typeof AI_CONFIG} [config]
 */
export function canEat(eater, target, config = AI_CONFIG) {
  return target.size <= eater.size * config.preyRatio
}

/**
 * Whether an eater is close enough to a target to eat it.
 * @param {{position:{x:number,y:number,z:number},size:number}} eater
 * @param {{position:{x:number,y:number,z:number}}} target
 * @param {typeof AI_CONFIG} [config]
 */
export function inEatRange(eater, target, config = AI_CONFIG) {
  return vdist(eater.position, target.position) <= eatRange(eater.size, config)
}

/**
 * Resolve an eat event. Pure — computes how much the eater grows (respecting
 * the max-size cap) and its resulting size. The caller applies the growth and
 * removes the target.
 * @param {{size:number}} eater
 * @param {{size:number}} target
 * @param {typeof AI_CONFIG} [config]
 * @returns {{growth:number, newSize:number}}
 */
export function resolveEat(eater, target, config = AI_CONFIG) {
  const newSize = Math.min(config.maxSize, eater.size + config.growthFraction * target.size)
  return { growth: newSize - eater.size, newSize }
}

// --- High level decision --------------------------------------------------

/**
 * Decide the behaviour mode for a fish given its neighbours. Flee overrides
 * chase overrides wander.
 * @returns {{mode:'flee'|'chase'|'wander', target:object|null}}
 */
export function decideBehavior(self, neighbors, config = AI_CONFIG) {
  const threat = nearestThreat(self, neighbors, config)
  if (threat) return { mode: 'flee', target: threat }
  const prey = nearestPrey(self, neighbors, config)
  if (prey) return { mode: 'chase', target: prey }
  return { mode: 'wander', target: null }
}
