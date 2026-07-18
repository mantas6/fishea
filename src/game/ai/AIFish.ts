import * as THREE from 'three'
import { FishMesh } from '../fish/FishMesh.js'
import { WORLD, integrate, clampToBounds, limitTurn } from '../movement.js'
import type { Vec3 } from '../movement.js'
import { seafloorHeight } from '../world.js'
import { dampOrientation } from '../orient.js'
import {
  AI_CONFIG,
  makeRng,
  nearestThreat,
  nearestPrey,
  fleeDirection,
  chaseDirection,
  wanderStep,
  vnorm,
} from './behavior.js'
import type { AiConfig, BehaviorMode, FishDescriptor, Rng } from './behavior.js'

export interface AIFishOptions {
  position?: Vec3
  size?: number
  color?: number
  finColor?: number
  bellyColor?: number
  rng?: Rng
  config?: AiConfig
}

// An AI fish entity: gameplay state (plain numbers so behavior.js stays pure)
// plus a Three.js container wrapping a shared procedural FishMesh.
//
// update(dt, neighbors) applies behaviour steering, integrates motion, clamps
// to the world bounds, orients the mesh along the velocity and drives the
// swim animation. Neighbours are fish descriptors ({ position, size }) and may
// include the player.

// How quickly the AI mesh turns to visually face its (already turn-limited)
// heading. Kept generous so the mesh tracks the heading closely.
const AI_ORIENT_LAMBDA = 10

let _idCounter = 0

export class AIFish implements FishDescriptor {
  id: string
  config: AiConfig
  size: number
  color: number
  isPlayer: boolean
  alive: boolean
  mode: BehaviorMode
  position: Vec3
  velocity: Vec3
  heading: Vec3
  object3d: THREE.Group
  fish: FishMesh
  private _rng: Rng
  private _align: THREE.Group

  constructor(options: AIFishOptions = {}) {
    this.id = `ai-${_idCounter++}`
    this.config = options.config ?? AI_CONFIG
    this._rng = options.rng ?? makeRng((Math.random() * 0xffffffff) >>> 0)

    this.size = options.size ?? 1
    this.color = options.color ?? 0xff8c42
    this.isPlayer = false
    this.alive = true
    this.mode = 'wander'

    this.position = options.position ? { ...options.position } : { x: 0, y: 20, z: 0 }
    this.velocity = { x: 0, y: 0, z: 0 }

    // Start with a random horizontal heading.
    const ang = this._rng() * Math.PI * 2
    this.heading = { x: Math.cos(ang), y: 0, z: Math.sin(ang) }

    // --- Visual: container -> alignment group -> fish mesh.
    // FishMesh noses along +X; lookAt orients +Z toward the target, so rotate
    // the alignment group so the nose maps onto +Z (matches Player).
    this.object3d = new THREE.Group()
    this.object3d.name = this.id

    this._align = new THREE.Group()
    this._align.rotation.y = -Math.PI / 2
    this.object3d.add(this._align)

    this.fish = new FishMesh({
      size: this.size,
      color: this.color,
      finColor: options.finColor ?? this.color,
      bellyColor: options.bellyColor ?? 0xffe0b3,
    })
    this._align.add(this.fish.group)

    this._syncTransform(this.heading)
  }

  /** Current speed magnitude (units/s). */
  get currentSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z)
  }

  /**
   * Grow the fish to a new size (from eating). Updates the mesh scale.
   */
  setSize(newSize: number): void {
    this.size = newSize
    this.fish.setSize(newSize)
  }

  /**
   * Advance one frame.
   */
  update(dt: number, neighbors: FishDescriptor[]): void {
    const self: FishDescriptor = { position: this.position, size: this.size }
    // The direction this fish *wants* to go this frame (may jump when the mode
    // changes). We steer the heading toward it under a turn-rate cap below.
    let targetDir: Vec3
    let speed: number

    const threat = nearestThreat(self, neighbors, this.config)
    if (threat) {
      targetDir = fleeDirection(this.position, threat.position)
      speed = this.config.burstSpeed
      this.mode = 'flee'
    } else {
      const prey = nearestPrey(self, neighbors, this.config)
      if (prey) {
        targetDir = chaseDirection(this.position, prey.position)
        speed = this.config.chaseSpeed
        this.mode = 'chase'
      } else {
        targetDir = wanderStep(this.heading, this._rng, dt, this.config)
        speed = this.config.cruiseSpeed
        this.mode = 'wander'
      }
    }

    // Cap how fast the heading can swing so abrupt target changes (e.g. a new
    // threat / mode flip) don't snap the fish around. Both movement and the
    // mesh orientation follow this smoothed heading, so they stay consistent.
    this.heading = limitTurn(this.heading, targetDir, this.config.turnRate * dt)

    const dir = this.heading
    this.velocity = { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }
    // Terrain-following floor so the fish never clips through the hills.
    this.position = clampToBounds(integrate(this.position, this.velocity, dt), WORLD, seafloorHeight)

    this._syncTransform(dir, false, dt)
    this.fish.update(dt, speed)
  }

  /**
   * Push gameplay state into the Three.js container, orienting along `dir`.
   * Orientation is damped; pass instant=true (or dt<=0) to snap (spawn).
   */
  _syncTransform(dir: Vec3, instant = true, dt = 0): void {
    this.object3d.position.set(this.position.x, this.position.y, this.position.z)
    const d = vnorm(dir, this.heading)
    dampOrientation(this.object3d, d, AI_ORIENT_LAMBDA, dt, instant)
  }

  dispose(): void {
    this.fish.dispose()
  }
}

export default AIFish
