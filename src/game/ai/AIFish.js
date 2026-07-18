import * as THREE from 'three'
import { FishMesh } from '../fish/FishMesh.js'
import { WORLD, integrate, clampToBounds } from '../movement.js'
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

// An AI fish entity: gameplay state (plain numbers so behavior.js stays pure)
// plus a Three.js container wrapping a shared procedural FishMesh.
//
// update(dt, neighbors) applies behaviour steering, integrates motion, clamps
// to the world bounds, orients the mesh along the velocity and drives the
// swim animation. Neighbours are fish descriptors ({ position, size }) and may
// include the player.

let _idCounter = 0

export class AIFish {
  /**
   * @param {{
   *   position:{x:number,y:number,z:number},
   *   size:number,
   *   color?:number,
   *   finColor?:number,
   *   bellyColor?:number,
   *   rng?:() => number,
   *   config?:typeof AI_CONFIG,
   * }} options
   */
  constructor(options = {}) {
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
  get currentSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z)
  }

  /**
   * Grow the fish to a new size (from eating). Updates the mesh scale.
   * @param {number} newSize
   */
  setSize(newSize) {
    this.size = newSize
    this.fish.setSize(newSize)
  }

  /**
   * Advance one frame.
   * @param {number} dt seconds
   * @param {Array<{position:{x:number,y:number,z:number},size:number}>} neighbors
   */
  update(dt, neighbors) {
    const self = { position: this.position, size: this.size }
    let dir
    let speed

    const threat = nearestThreat(self, neighbors, this.config)
    if (threat) {
      dir = fleeDirection(this.position, threat.position)
      speed = this.config.burstSpeed
      this.mode = 'flee'
      this.heading = dir
    } else {
      const prey = nearestPrey(self, neighbors, this.config)
      if (prey) {
        dir = chaseDirection(this.position, prey.position)
        speed = this.config.chaseSpeed
        this.mode = 'chase'
        this.heading = dir
      } else {
        this.heading = wanderStep(this.heading, this._rng, dt, this.config)
        dir = this.heading
        speed = this.config.cruiseSpeed
        this.mode = 'wander'
      }
    }

    this.velocity = { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }
    this.position = clampToBounds(integrate(this.position, this.velocity, dt), WORLD)

    this._syncTransform(dir)
    this.fish.update(dt, speed)
  }

  /** Push gameplay state into the Three.js container, orienting along dir. */
  _syncTransform(dir) {
    this.object3d.position.set(this.position.x, this.position.y, this.position.z)
    const d = vnorm(dir, this.heading)
    this.object3d.lookAt(
      this.position.x + d.x,
      this.position.y + d.y,
      this.position.z + d.z,
    )
  }

  dispose() {
    this.fish.dispose()
  }
}

export default AIFish
