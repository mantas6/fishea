import * as THREE from 'three'
import { WORLD, clampToBounds, headingToDirection } from '../movement.js'
import type { Vec3, WorldBounds } from '../movement.js'
import { AIFish } from './AIFish.js'
import {
  AI_CONFIG,
  makeRng,
  canEat,
  inEatRange,
  resolveEat,
  scanBiteTargets,
} from './behavior.js'
import type { AiConfig, FishDescriptor, Rng } from './behavior.js'
import type { FishMesh } from '../fish/FishMesh.js'
import type { EventEmitter } from '../events.js'

/** Spawn tuning; ranges are [min, max] multipliers of the player size. */
export interface SpawnConfig {
  targetPopulation: number
  maxPopulation: number
  minPopulation: number
  spawnInterval: number
  minSpawnDist: number
  maxSpawnDist: number
  preyMaxSpawnDist: number
  despawnDist: number
  minEatable: number
  smallerPct: number
  similarPct: number
  smallerRange: [number, number]
  similarRange: [number, number]
  biggerRange: [number, number]
}

/** The subset of the player the spawner reads + mutates. */
export interface SpawnerPlayer {
  position: Vec3
  size: number
  yaw: number
  pitch: number
  bite: boolean
  fish?: FishMesh
}

/** Minimal emitter contract (real EventEmitter or a stub). */
interface EmitterLike {
  emit: EventEmitter['emit']
}

export interface SpawnerOptions {
  scene?: THREE.Scene | null
  player: SpawnerPlayer
  events?: EmitterLike
  rng?: Rng
  config?: SpawnConfig
  aiConfig?: AiConfig
  bounds?: WorldBounds
}

/** Roughly categorised size relative to the player. */
export type SizeCategory = 'smaller' | 'similar' | 'bigger'

// Population manager for AI fish. Keeps ~25-35 fish alive around the player,
// spawns them at a safe distance with a size distribution relative to the
// player, and resolves all eating interactions (AI vs AI, player vs AI,
// AI vs player) each frame, emitting events for later systems to consume.
//
// The pure decision helpers (size rolls, spawn position picking, despawn test)
// live at the bottom and are unit tested with an injectable RNG.

export const SPAWN_CONFIG: SpawnConfig = {
  targetPopulation: 30, // spawn up toward this count
  maxPopulation: 35, // never exceed this
  minPopulation: 25, // informational floor
  spawnInterval: 1.2, // seconds between spawn attempts
  minSpawnDist: 40, // never spawn closer than this to the player (XZ)
  maxSpawnDist: 150, // outer spawn ring
  preyMaxSpawnDist: 85, // topped-up prey spawn on a tighter ring so they're findable
  despawnDist: 260, // recycle fish beyond this from the player (XZ)
  minEatable: 8, // keep at least this many player-eatable fish alive at all times
  // Size distribution relative to the player.
  smallerPct: 0.6, // 60% smaller
  similarPct: 0.25, // 25% similar (=> 15% bigger)
  smallerRange: [0.4, 0.8], // multipliers of player size
  similarRange: [0.9, 1.15],
  biggerRange: [1.25, 2.0],
}

// A pleasant spread of tropical fish colours.
const FISH_COLORS = [
  0xff8c42, 0xffd23f, 0xf25f5c, 0x4fd1ff, 0x8ce99a, 0xb197fc, 0xffa8d6,
  0xffe066, 0x63e6be, 0xff6b6b, 0x74c0fc, 0xffd8a8,
]

export class Spawner {
  scene: THREE.Scene | null
  player: SpawnerPlayer
  events: EmitterLike
  rng: Rng
  config: SpawnConfig
  aiConfig: AiConfig
  bounds: WorldBounds
  fish: AIFish[]
  private _timer: number
  private _prevBite: boolean
  private _descriptors: FishDescriptor[]

  constructor(options: SpawnerOptions) {
    this.scene = options.scene ?? null
    this.player = options.player
    this.events = options.events ?? { emit() {} }
    this.rng = options.rng ?? makeRng((Math.random() * 0xffffffff) >>> 0)
    this.config = options.config ?? SPAWN_CONFIG
    this.aiConfig = options.aiConfig ?? AI_CONFIG
    this.bounds = options.bounds ?? WORLD

    this.fish = []
    this._timer = 0
    this._prevBite = false

    // Reusable scratch descriptor list to keep per-frame allocation reasonable.
    this._descriptors = []
  }

  /** Current live population. */
  get population(): number {
    return this.fish.length
  }

  /** Pre-fill the world so the player isn't alone on the first frame. */
  seed(count = this.config.targetPopulation): void {
    for (let i = 0; i < count; i++) this.spawnOne()
    // Guarantee the floor of eatable prey right away so the first run isn't a
    // hunt through a world of only same-size / bigger fish.
    this._ensureEatable()
  }

  /**
   * Spawn a single fish (respecting the max population cap).
   *
   * When `eatable` is set the size is forced into the player-eatable range and
   * the fish is placed on the tighter prey ring so hungry players can find prey
   * without combing the whole world.
   */
  spawnOne(opts: { eatable?: boolean } = {}): AIFish | null {
    if (this.fish.length >= this.config.maxPopulation) return null
    const size = opts.eatable
      ? rollEatableSize(this.player.size, this.rng, this.config, this.aiConfig)
      : rollSize(this.player.size, this.rng, this.config)
    const maxDist = opts.eatable ? this.config.preyMaxSpawnDist : this.config.maxSpawnDist
    const position = pickSpawnPosition(
      this.player.position,
      this.rng,
      this.config,
      this.bounds,
      maxDist,
    )
    const color = FISH_COLORS[Math.floor(this.rng() * FISH_COLORS.length)]
    const fish = new AIFish({
      position,
      size,
      color,
      rng: makeRng((this.rng() * 0xffffffff) >>> 0),
      config: this.aiConfig,
    })
    this.fish.push(fish)
    if (this.scene) this.scene.add(fish.object3d)
    this.events.emit('fish-spawned', { id: fish.id, size })
    return fish
  }

  /**
   * Top the population up with eatable prey whenever it dips below the floor.
   * Sized against the player's live size and placed on the tighter prey ring so
   * prey stay findable as the player grows. Bounded by the max population cap.
   */
  _ensureEatable(): void {
    let deficit =
      this.config.minEatable - countEatable(this.fish, this.player.size, this.aiConfig)
    while (deficit > 0 && this.fish.length < this.config.maxPopulation) {
      if (!this.spawnOne({ eatable: true })) break
      deficit--
    }
  }

  /** Remove a fish by index, freeing its resources and detaching it. */
  _removeAt(index: number): void {
    const fish = this.fish[index]
    if (!fish) return
    if (this.scene) this.scene.remove(fish.object3d)
    fish.dispose()
    fish.alive = false
    this.fish.splice(index, 1)
  }

  /**
   * Advance the whole population one frame: spawn timing, per-fish AI update,
   * despawn of far-away fish, and all eating resolution.
   */
  update(dt: number, opts: { attackPlayer?: boolean } = {}): void {
    const attackPlayer = opts.attackPlayer !== false
    // --- Spawn over time when population drops.
    this._timer += dt
    if (this._timer >= this.config.spawnInterval) {
      this._timer = 0
      if (this.fish.length < this.config.targetPopulation) this.spawnOne()
    }

    // --- Keep a floor of player-eatable prey alive, relative to the player's
    // CURRENT size, so growth never strands the player without anything to eat.
    this._ensureEatable()

    // --- Build a descriptor list once, including the player.
    const descriptors = this._descriptors
    descriptors.length = 0
    for (const f of this.fish) descriptors.push(f)
    descriptors.push(this.player)

    // --- Update each fish against everyone else.
    for (const f of this.fish) {
      f.update(dt, descriptors)
    }

    // --- Despawn / recycle fish that drift too far from the player.
    for (let i = this.fish.length - 1; i >= 0; i--) {
      if (shouldDespawn(this.fish[i].position, this.player.position, this.config)) {
        this.events.emit('fish-despawned', { id: this.fish[i].id })
        this._removeAt(i)
      }
    }

    this._resolveEating(attackPlayer)
  }

  /** Resolve every eat interaction for the frame. */
  _resolveEating(attackPlayer = true): void {
    const player = this.player
    const ai = this.fish

    // --- AI vs AI: bigger eats smaller on contact. An eater swallows at most
    // one target per frame, which keeps splice bookkeeping simple and fair.
    for (const eater of ai) {
      if (!eater.alive) continue
      for (const target of ai) {
        if (target === eater || !target.alive) continue
        if (canEat(eater, target, this.aiConfig) && inEatRange(eater, target, this.aiConfig)) {
          const { newSize } = resolveEat(eater, target, this.aiConfig)
          eater.setSize(newSize)
          this.events.emit('fish-eaten', {
            eaterId: eater.id,
            targetId: target.id,
            targetSize: target.size,
          })
          const targetIndex = this.fish.indexOf(target)
          if (targetIndex !== -1) this._removeAt(targetIndex)
          break
        }
      }
    }

    // --- AI vs player: a threat that reaches the player bites it.
    if (attackPlayer) {
      for (const eater of ai) {
        if (!eater.alive) continue
        if (canEat(eater, player, this.aiConfig) && inEatRange(eater, player, this.aiConfig)) {
          const damage = Math.round(eater.size * 5)
          this.events.emit('player-bitten', { attackerId: eater.id, damage })
        }
      }
    }

    // --- Player vs AI: on bite press, eat a prey-sized fish in front.
    const biteEdge = player.bite && !this._prevBite
    this._prevBite = !!player.bite
    if (biteEdge) this._playerBite()
  }

  /** Handle a single player bite (rising edge). */
  _playerBite(): void {
    const player = this.player
    const { prey: bestPrey, tooBig: bestTooBig } = scanBiteTargets(
      {
        position: player.position,
        size: player.size,
        heading: headingToDirection(player.yaw, player.pitch),
      },
      this.fish,
      this.aiConfig,
    )

    if (bestPrey) {
      const { newSize } = resolveEat(player, bestPrey, this.aiConfig)
      player.size = newSize
      if (player.fish && player.fish.setSize) player.fish.setSize(newSize)
      this.events.emit('player-ate', { targetId: bestPrey.id, targetSize: bestPrey.size })
      const idx = this.fish.indexOf(bestPrey)
      if (idx !== -1) this._removeAt(idx)
    } else if (bestTooBig) {
      this.events.emit('bite-missed', { targetId: bestTooBig.id })
    } else {
      this.events.emit('bite-missed', { targetId: null })
    }
  }

  /** Tear down all fish. */
  dispose(): void {
    for (const f of this.fish) {
      if (this.scene) this.scene.remove(f.object3d)
      f.dispose()
    }
    this.fish.length = 0
  }
}

// --- Pure decision helpers (unit tested) ----------------------------------

/**
 * Roll a size category using the configured distribution.
 */
export function rollSizeCategory(rng: Rng, config: SpawnConfig = SPAWN_CONFIG): SizeCategory {
  const r = rng()
  if (r < config.smallerPct) return 'smaller'
  if (r < config.smallerPct + config.similarPct) return 'similar'
  return 'bigger'
}

/**
 * Roll a concrete fish size relative to the player, respecting the max cap.
 */
export function rollSize(
  playerSize: number,
  rng: Rng,
  config: SpawnConfig = SPAWN_CONFIG,
  maxSize = AI_CONFIG.maxSize,
): number {
  const category = rollSizeCategory(rng, config)
  const range =
    category === 'smaller'
      ? config.smallerRange
      : category === 'similar'
        ? config.similarRange
        : config.biggerRange
  const mult = range[0] + rng() * (range[1] - range[0])
  const size = playerSize * mult
  return Math.max(0.2, Math.min(maxSize, size))
}

/**
 * Roll a size that is guaranteed eatable by the player at its current size.
 * Uses the "smaller" range but caps the multiplier at the eat threshold
 * (preyRatio) so the result always satisfies canEat(player, fish).
 */
export function rollEatableSize(
  playerSize: number,
  rng: Rng,
  config: SpawnConfig = SPAWN_CONFIG,
  aiConfig: AiConfig = AI_CONFIG,
  maxSize = AI_CONFIG.maxSize,
): number {
  const [lo, hi] = config.smallerRange
  // Never roll above the eat boundary (playerSize * preyRatio), so even if the
  // smaller range is later widened the fish stays swallowable.
  const ceil = Math.min(hi, aiConfig.preyRatio)
  const span = Math.max(0, ceil - lo)
  const mult = lo + rng() * span
  const size = Math.min(playerSize * mult, playerSize * aiConfig.preyRatio)
  return Math.max(0.2, Math.min(maxSize, size))
}

/**
 * Count how many of the given fish the player (at `playerSize`) could eat. Uses
 * the same canEat threshold the actual bite resolution uses so the two agree.
 */
export function countEatable(
  fish: Array<{ size: number }>,
  playerSize: number,
  aiConfig: AiConfig = AI_CONFIG,
): number {
  let n = 0
  for (const f of fish) {
    if (canEat({ size: playerSize }, f, aiConfig)) n++
  }
  return n
}

/**
 * Pick a spawn position at least minSpawnDist (XZ) from the player and inside
 * the world bounds. Retries a few times, then falls back to a guaranteed-far
 * ring position. `maxDist` overrides the outer ring (defaults to the config's
 * maxSpawnDist) so callers can spawn prey on a tighter, more findable ring.
 */
export function pickSpawnPosition(
  playerPos: Vec3,
  rng: Rng,
  config: SpawnConfig = SPAWN_CONFIG,
  bounds: WorldBounds = WORLD,
  maxDist: number = config.maxSpawnDist,
): Vec3 {
  const minY = bounds.seafloorY + bounds.fishFloorMargin
  const maxY = bounds.surfaceY - bounds.fishSurfaceMargin
  // Guard against a max ring that's tighter than the min ring.
  const outer = Math.max(maxDist, config.minSpawnDist)

  for (let attempt = 0; attempt < 24; attempt++) {
    const ang = rng() * Math.PI * 2
    const r = config.minSpawnDist + rng() * (outer - config.minSpawnDist)
    const x = playerPos.x + Math.cos(ang) * r
    const z = playerPos.z + Math.sin(ang) * r
    const y = minY + rng() * (maxY - minY)
    const p = clampToBounds({ x, y, z }, bounds)
    const dist = Math.hypot(p.x - playerPos.x, p.z - playerPos.z)
    if (dist >= config.minSpawnDist) return p
  }

  // Fallback: place exactly on the min-distance ring, aimed back toward the
  // origin so it stays inside the world radius even near the edge.
  const towardOrigin = Math.atan2(-playerPos.z, -playerPos.x)
  const x = playerPos.x + Math.cos(towardOrigin) * config.minSpawnDist
  const z = playerPos.z + Math.sin(towardOrigin) * config.minSpawnDist
  const y = (minY + maxY) / 2
  return clampToBounds({ x, y, z }, bounds)
}

/**
 * Whether a fish should be recycled because it wandered too far (XZ) from the
 * player.
 */
export function shouldDespawn(
  fishPos: Vec3,
  playerPos: Vec3,
  config: SpawnConfig = SPAWN_CONFIG,
): boolean {
  return Math.hypot(fishPos.x - playerPos.x, fishPos.z - playerPos.z) > config.despawnDist
}

export default Spawner
