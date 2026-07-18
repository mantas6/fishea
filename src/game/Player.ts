import * as THREE from 'three'
import { FishMesh } from './fish/FishMesh.js'
import {
  WORLD,
  PLAYER_MOTION,
  headingToDirection,
  integrate,
  clampToBounds,
  clampPitch,
  wrapAngle,
  desiredVelocity,
  stepVelocity,
} from './movement.js'
import type { Vec3 } from './movement.js'
import type { SourceState } from './input/normalize.js'

// The player fish entity: owns gameplay state (position/velocity/heading/size)
// and a Three.js container object for rendering. Motion is driven by the
// normalized input state produced by the InputManager (see applyInput).

export interface PlayerOptions {
  size?: number
  color?: number
  speed?: number
  sprintMultiplier?: number
}

export class Player {
  size: number
  speed: number
  sprintMultiplier: number
  color: number
  position: Vec3
  velocity: Vec3
  yaw: number
  pitch: number
  bite: boolean
  sprinting: boolean
  object3d: THREE.Group
  fish: FishMesh
  private _t: number
  private _align: THREE.Group

  constructor(options: PlayerOptions = {}) {
    this.size = options.size ?? 1
    this.speed = options.speed ?? PLAYER_MOTION.maxSpeed // base cruise speed (units/s)
    this.sprintMultiplier = options.sprintMultiplier ?? PLAYER_MOTION.sprintMultiplier
    this.color = options.color ?? 0x4fd1ff

    // Gameplay state (plain numbers so movement.js stays pure).
    this.position = { x: 0, y: 20, z: 0 }
    this.velocity = { x: 0, y: 0, z: 0 }
    this.yaw = 0 // faces -Z at 0
    this.pitch = 0

    // Latest input flags (bite is consumed by a later task).
    this.bite = false
    this.sprinting = false

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
  get currentSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z)
  }

  /**
   * Drive the fish from a normalized input state for one frame.
   */
  applyInput(input: SourceState, dt: number, sprintAllowed = true): void {
    this._t += dt

    // Steer: look deltas are already scaled to radians for this frame.
    this.yaw = wrapAngle(this.yaw + input.look.x)
    this.pitch = clampPitch(this.pitch + input.look.y)

    this.sprinting = !!input.sprint && sprintAllowed
    this.bite = !!input.bite

    const maxSpeed = this.speed * (this.sprinting ? this.sprintMultiplier : 1)
    const desired = desiredVelocity(input.move, this.yaw, this.pitch, maxSpeed)

    // Ramp toward the desired velocity (thrust) / bleed off when idle (drag).
    this.velocity = stepVelocity(this.velocity, desired, PLAYER_MOTION, dt)
    this.position = clampToBounds(integrate(this.position, this.velocity, dt), WORLD)

    this._syncTransform()
    this.fish.update(dt, this.currentSpeed)
  }

  /** Push gameplay state into the Three.js container. */
  _syncTransform(): void {
    this.object3d.position.set(this.position.x, this.position.y, this.position.z)
    const dir = headingToDirection(this.yaw, this.pitch)
    this.object3d.lookAt(
      this.position.x + dir.x,
      this.position.y + dir.y,
      this.position.z + dir.z,
    )
  }

  dispose(): void {
    this.fish.dispose()
  }
}

export default Player
