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

/** Survival tuning constants. */
export interface StatsConfig {
  hpMax: number
  hungerMax: number
  staminaMax: number
  hungerDrainRate: number
  starvationHpRate: number
  hpRegenRate: number
  wellFedThreshold: number
  staminaDrainRate: number
  staminaRegenRate: number
  exhaustionRecover: number
  hungerPerSize: number
}

/** A survival-stats snapshot. Pure model; produced by the functions below. */
export interface Stats {
  hp: number
  hpMax: number
  hunger: number
  hungerMax: number
  stamina: number
  staminaMax: number
  exhausted: boolean
  alive: boolean
}

/** Options accepted by tickStats. */
export interface TickOptions {
  sprinting?: boolean
}

export const STATS_CONFIG: StatsConfig = {
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

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Create a fresh, full stats snapshot.
 */
export function createStats(config: StatsConfig = STATS_CONFIG): Stats {
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
 */
export function sprintAllowed(stats: Stats, _config: StatsConfig = STATS_CONFIG): boolean {
  return stats.alive && !stats.exhausted && stats.stamina > 0
}

/** Convenience predicate. */
export function isDead(stats: Stats): boolean {
  return !stats.alive || stats.hp <= 0
}

/**
 * Advance stats by one frame. Pure: returns a new snapshot.
 *  - hunger drains slowly over time
 *  - when hunger is empty, hp drains (starvation)
 *  - when hunger is high, hp slowly regenerates
 *  - stamina drains while sprinting, regenerates otherwise, with an
 *    exhaustion lockout once it bottoms out
 */
export function tickStats(
  stats: Stats,
  dt: number,
  { sprinting = false }: TickOptions = {},
  config: StatsConfig = STATS_CONFIG,
): Stats {
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
 */
export function eat(stats: Stats, targetSize: number, config: StatsConfig = STATS_CONFIG): Stats {
  if (!stats.alive) return stats
  const restore = Math.max(0, targetSize) * config.hungerPerSize
  const hunger = clamp(stats.hunger + restore, 0, stats.hungerMax)
  return { ...stats, hunger }
}

/**
 * Apply damage. Pure: returns the new snapshot plus a `dead` flag.
 */
export function damage(stats: Stats, amount: number): { stats: Stats; dead: boolean } {
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
