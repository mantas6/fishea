// Pure AI fish behavior logic. Everything here operates on plain {x, y, z}
// vectors and simple fish descriptors ({ position, size }) so it can be unit
// tested in a plain node environment without importing Three.js / WebGL.
//
// A "fish descriptor" is any object shaped like:
//   { position: { x, y, z }, size: number, ... }
// The player is treated as just another fish descriptor in this reckoning.

import type { Vec3 } from '../movement.js'

/** Any fish-like entity the AI can reason about (player included). */
export interface FishDescriptor {
  position: Vec3
  size: number
}

/** Tunable AI behaviour constants. */
export interface AiConfig {
  senseRadius: number
  aggroRadius: number
  threatRatio: number
  preyRatio: number
  wanderRate: number
  wanderVertical: number
  cruiseSpeed: number
  chaseSpeed: number
  burstSpeed: number
  eatRangeBase: number
  growthFraction: number
  maxSize: number
}

/** A pseudo-random number generator returning a float in [0, 1). */
export type Rng = () => number

/** Neighbour classification relative to a fish's own size. */
export type NeighborKind = 'threat' | 'prey' | 'neutral'

/** A perceived neighbour with its distance and classification. */
export interface PerceivedNeighbor {
  fish: FishDescriptor
  dist: number
  kind: NeighborKind
}

/** Behaviour mode chosen for a fish this frame. */
export type BehaviorMode = 'flee' | 'chase' | 'wander'

// --- Tunable AI constants -------------------------------------------------

export const AI_CONFIG: AiConfig = {
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

export function vlen(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

export function vsub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function vdist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function vdot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

/**
 * Normalize a vector to unit length. When the vector is (near) zero, returns
 * the provided fallback (also normalized) or a default forward heading.
 */
export function vnorm(v: Vec3, fallback: Vec3 = { x: 0, y: 0, z: -1 }): Vec3 {
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
 */
export function makeRng(seed = 1): Rng {
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
 */
export function classifyNeighbor(
  mySize: number,
  otherSize: number,
  config: AiConfig = AI_CONFIG,
): NeighborKind {
  if (otherSize >= mySize * config.threatRatio) return 'threat'
  if (otherSize <= mySize * config.preyRatio) return 'prey'
  return 'neutral'
}

/**
 * Partition the neighbours within sense radius into threat/prey/neutral lists.
 * Each entry is { fish, dist, kind }.
 */
export function perceive(
  self: FishDescriptor,
  neighbors: FishDescriptor[],
  config: AiConfig = AI_CONFIG,
): { threats: PerceivedNeighbor[]; prey: PerceivedNeighbor[]; neutral: PerceivedNeighbor[] } {
  const threats: PerceivedNeighbor[] = []
  const prey: PerceivedNeighbor[] = []
  const neutral: PerceivedNeighbor[] = []
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
 */
export function nearestThreat(
  self: FishDescriptor,
  neighbors: FishDescriptor[],
  config: AiConfig = AI_CONFIG,
): FishDescriptor | null {
  let best: FishDescriptor | null = null
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
 */
export function nearestPrey(
  self: FishDescriptor,
  neighbors: FishDescriptor[],
  config: AiConfig = AI_CONFIG,
): FishDescriptor | null {
  let best: FishDescriptor | null = null
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
 */
export function wanderStep(heading: Vec3, rng: Rng, dt: number, config: AiConfig = AI_CONFIG): Vec3 {
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
 */
export function fleeDirection(selfPos: Vec3, threatPos: Vec3): Vec3 {
  return vnorm(vsub(selfPos, threatPos))
}

/**
 * Unit vector steering TOWARD a prey position.
 */
export function chaseDirection(selfPos: Vec3, preyPos: Vec3): Vec3 {
  return vnorm(vsub(preyPos, selfPos))
}

// --- Eating ---------------------------------------------------------------

/**
 * How close (centre to centre) an eater must be to swallow prey.
 */
export function eatRange(eaterSize: number, config: AiConfig = AI_CONFIG): number {
  return config.eatRangeBase * eaterSize
}

/**
 * Whether an eater is allowed to eat a target (target is prey-sized).
 */
export function canEat(
  eater: { size: number },
  target: { size: number },
  config: AiConfig = AI_CONFIG,
): boolean {
  return target.size <= eater.size * config.preyRatio
}

/**
 * Whether an eater is close enough to a target to eat it.
 */
export function inEatRange(
  eater: FishDescriptor,
  target: { position: Vec3 },
  config: AiConfig = AI_CONFIG,
): boolean {
  return vdist(eater.position, target.position) <= eatRange(eater.size, config)
}

/**
 * Resolve an eat event. Pure — computes how much the eater grows (respecting
 * the max-size cap) and its resulting size. The caller applies the growth and
 * removes the target.
 */
export function resolveEat(
  eater: { size: number },
  target: { size: number },
  config: AiConfig = AI_CONFIG,
): { growth: number; newSize: number } {
  const newSize = Math.min(config.maxSize, eater.size + config.growthFraction * target.size)
  return { growth: newSize - eater.size, newSize }
}

// --- High level decision --------------------------------------------------

/**
 * Decide the behaviour mode for a fish given its neighbours. Flee overrides
 * chase overrides wander.
 */
export function decideBehavior(
  self: FishDescriptor,
  neighbors: FishDescriptor[],
  config: AiConfig = AI_CONFIG,
): { mode: BehaviorMode; target: FishDescriptor | null } {
  const threat = nearestThreat(self, neighbors, config)
  if (threat) return { mode: 'flee', target: threat }
  const prey = nearestPrey(self, neighbors, config)
  if (prey) return { mode: 'chase', target: prey }
  return { mode: 'wander', target: null }
}
