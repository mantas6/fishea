import * as THREE from 'three'
import { FishMesh } from './fish/FishMesh.js'
import {
  WORLD,
  headingToDirection,
  integrate,
  clampToBounds,
  clampPitch,
  wrapAngle,
} from './movement.js'

// The player fish entity: owns gameplay state (position/velocity/heading/size)
// and a Three.js container object for rendering. Real input arrives in a later
// task; for now it gently auto-swims in a lazy arc with idle bobbing.

export class Player {
  /**
   * @param {Partial<{size:number,color:number,speed:number}>} [options]
   */
  constructor(options = {}) {
    this.size = options.size ?? 1
    this.speed = options.speed ?? 6 // forward units/s for the placeholder swim
    this.color = options.color ?? 0x4fd1ff

    // Gameplay state (plain numbers so movement.js stays pure).
    this.position = { x: 0, y: 20, z: 0 }
    this.velocity = { x: 0, y: 0, z: 0 }
    this.yaw = 0 // faces -Z at 0
    this.pitch = 0

    this._t = 0

    // --- Visual: container -> alignment group -> fish mesh.
    // FishMesh noses along +X; lookAt orients an object's +Z toward the target,
    // so rotate the alignment group so the nose maps onto +Z.
    this.object3d = new THREE.Group()
    this.object3d.name = 'player'

    this._align = new THREE.Group()
    this._align.rotation.y = -Math.PI / 2 // +X (nose) -> +Z (lookAt forward)
    this.object3d.add(this._align)

    this.fish = new FishMesh({ size: this.size, color: this.color, finColor: 0x2fb6e6, bellyColor: 0xdff6ff })
    this._align.add(this.fish.group)

    this._syncTransform()
  }

  /** Current speed magnitude (units/s). */
  get currentSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z)
  }

  /**
   * Advance the placeholder swim behaviour and sync the transform.
   * @param {number} dt seconds
   */
  update(dt) {
    this._t += dt

    // Placeholder: lazily curve the heading and bob the pitch so there's motion
    // to look at before input is wired up.
    this.yaw = wrapAngle(this.yaw + dt * 0.35)
    this.pitch = clampPitch(Math.sin(this._t * 0.5) * 0.25)

    const dir = headingToDirection(this.yaw, this.pitch)
    // Add a slow vertical bob independent of heading.
    const bob = Math.sin(this._t * 1.3) * 1.2
    this.velocity = {
      x: dir.x * this.speed,
      y: dir.y * this.speed + bob,
      z: dir.z * this.speed,
    }

    this.position = clampToBounds(integrate(this.position, this.velocity, dt), WORLD)

    this._syncTransform()
    this.fish.update(dt, this.currentSpeed)
  }

  /** Push gameplay state into the Three.js container. */
  _syncTransform() {
    this.object3d.position.set(this.position.x, this.position.y, this.position.z)
    const dir = headingToDirection(this.yaw, this.pitch)
    this.object3d.lookAt(
      this.position.x + dir.x,
      this.position.y + dir.y,
      this.position.z + dir.z,
    )
  }

  dispose() {
    this.fish.dispose()
  }
}

export default Player
