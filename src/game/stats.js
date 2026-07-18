// Pure, DOM-free survival stats model. All update functions are pure: they
// take a stats snapshot and return a NEW snapshot, so they're trivially unit
// tested in a plain node environment and safe to call from the render loop.
//
// A stats snapshot is a plain object:
//   {
//     hp, hpMax,             // health; 0 => dead
//     hunger, hungerMax,     // fullness (max = not hungry, 0 = starving)
//     stamina, staminaMax,   // sprint fuel
//     exhausted,             // true while locked out of sprinting
//     alive,                 // convenience flag mirrored from hp > 0
//   }

// --- Tunable survival constants -------------------------------------------

export const STATS_CONFIG = {
  hpMax: 100,
  hungerMax: 100,
  staminaMax: 100,

  hungerDrainRate: 1.2, // hunger lost per second just by living
  starvationHpRate: 2, // hp lost per second while hunger is empty
  hpRegenRate: 1, // hp regained per second while well fed
  wellFedThreshold: 70, // hunger above this => passive hp regen

  staminaDrainRate: 20, // stamina lost per second while sprinting
  staminaRegenRate: 12, // stamina regained per second while not sprinting
  exhaustionRecover: 25, // must climb back above this before sprinting again

  hungerPerSize: 20, // hunger restored per unit of prey size eaten
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Create a fresh, full stats snapshot.
 * @param {Partial<typeof STATS_CONFIG>} [config]
 * @returns {{hp:number,hpMax:number,hunger:number,hungerMax:number,stamina:number,staminaMax:number,exhausted:boolean,alive:boolean}}
 */
export function createStats(config = STATS_CONFIG) {
  return {
    hp: config.hpMax,
    hpMax: config.hpMax,
    hunger: config.hungerMax,
    hungerMax: config.hungerMax,
    stamina: config.staminaMax,
    staminaMax: config.staminaMax,
    exhausted: false,
    alive: true,
  }
}

/**
 * Whether the fish is currently allowed to sprint. Sprinting is gated while
 * dead, while there's no stamina, and during the exhaustion lockout (which
 * lasts until stamina recovers back above `exhaustionRecover`).
 * @param {ReturnType<typeof createStats>} stats
 * @param {typeof STATS_CONFIG} [config]
 * @returns {boolean}
 */
export function sprintAllowed(stats, config = STATS_CONFIG) {
  return stats.alive && !stats.exhausted && stats.stamina > 0
}

/** Convenience predicate. */
export function isDead(stats) {
  return !stats.alive || stats.hp <= 0
}

/**
 * Advance stats by one frame. Pure: returns a new snapshot.
 *  - hunger drains slowly over time
 *  - when hunger is empty, hp drains (starvation)
 *  - when hunger is high, hp slowly regenerates
 *  - stamina drains while sprinting, regenerates otherwise, with an
 *    exhaustion lockout once it bottoms out
 * @param {ReturnType<typeof createStats>} stats
 * @param {number} dt seconds
 * @param {{sprinting?:boolean}} [opts]
 * @param {typeof STATS_CONFIG} [config]
 */
export function tickStats(stats, dt, { sprinting = false } = {}, config = STATS_CONFIG) {
  if (!stats.alive) return stats
  if (!(dt > 0)) return stats

  let hunger = clamp(stats.hunger - config.hungerDrainRate * dt, 0, stats.hungerMax)
  let stamina = stats.stamina
  let exhausted = stats.exhausted

  // --- Stamina: burn while sprinting, recover otherwise.
  if (sprinting) {
    stamina = clamp(stamina - config.staminaDrainRate * dt, 0, stats.staminaMax)
    if (stamina <= 0) exhausted = true
  } else {
    stamina = clamp(stamina + config.staminaRegenRate * dt, 0, stats.staminaMax)
  }
  // Clear the lockout only once we've recovered a usable reserve.
  if (exhausted && stamina >= config.exhaustionRecover) exhausted = false

  // --- HP: starve when empty, heal when well fed.
  let hp = stats.hp
  if (hunger <= 0) {
    hp = clamp(hp - config.starvationHpRate * dt, 0, stats.hpMax)
  } else if (hunger > config.wellFedThreshold) {
    hp = clamp(hp + config.hpRegenRate * dt, 0, stats.hpMax)
  }

  const alive = hp > 0
  return { ...stats, hp, hunger, stamina, exhausted, alive }
}

/**
 * Eat prey: restores hunger proportional to prey size, capped at max. Pure.
 * @param {ReturnType<typeof createStats>} stats
 * @param {number} targetSize
 * @param {typeof STATS_CONFIG} [config]
 */
export function eat(stats, targetSize, config = STATS_CONFIG) {
  if (!stats.alive) return stats
  const restore = Math.max(0, targetSize) * config.hungerPerSize
  const hunger = clamp(stats.hunger + restore, 0, stats.hungerMax)
  return { ...stats, hunger }
}

/**
 * Apply damage. Pure: returns the new snapshot plus a `dead` flag.
 * @param {ReturnType<typeof createStats>} stats
 * @param {number} amount hp to subtract (negative amounts are ignored)
 * @returns {{stats:ReturnType<typeof createStats>, dead:boolean}}
 */
export function damage(stats, amount) {
  if (!stats.alive) return { stats, dead: true }
  const hp = clamp(stats.hp - Math.max(0, amount), 0, stats.hpMax)
  const alive = hp > 0
  return { stats: { ...stats, hp, alive }, dead: !alive }
}

export default {
  STATS_CONFIG,
  createStats,
  tickStats,
  eat,
  damage,
  sprintAllowed,
  isDead,
}
