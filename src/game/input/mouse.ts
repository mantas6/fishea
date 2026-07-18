// Mouse input source: pointer-lock "mouse look" on the game canvas plus a
// left-button bite/eat flag. Movement is accumulated between frames and drained
// by consumeLook() so no motion is lost or double-counted.
//
// Sign convention (matches movement.js headingToDirection where yaw 0 faces -Z):
//   moving the mouse right  -> turn right (yaw decreases) -> look.x = -dx * s
//   moving the mouse up      -> look up (pitch increases)  -> look.y = -dy * s

import type { Vec2 } from './normalize.js'

const DEFAULT_SENSITIVITY = 0.0022 // radians per pixel of mouse movement

export interface MouseOptions {
  sensitivity?: number
}

export class MouseInput {
  sensitivity: number
  locked: boolean
  private _canvas: HTMLElement | null
  private _dx: number
  private _dy: number
  private _bite: boolean

  constructor(canvas: HTMLElement | null, options: MouseOptions = {}) {
    this._canvas = canvas || null
    this.sensitivity = options.sensitivity ?? DEFAULT_SENSITIVITY

    this._dx = 0
    this._dy = 0
    this._bite = false
    this.locked = false

    this._onClick = this._onClick.bind(this)
    this._onMouseMove = this._onMouseMove.bind(this)
    this._onMouseDown = this._onMouseDown.bind(this)
    this._onMouseUp = this._onMouseUp.bind(this)
    this._onLockChange = this._onLockChange.bind(this)

    if (this._canvas) {
      this._canvas.addEventListener('click', this._onClick)
      this._canvas.addEventListener('mousedown', this._onMouseDown as EventListener)
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('mousemove', this._onMouseMove as EventListener)
      document.addEventListener('mouseup', this._onMouseUp as EventListener)
      document.addEventListener('pointerlockchange', this._onLockChange)
    }
  }

  _onClick(): void {
    if (!this.locked && this._canvas && this._canvas.requestPointerLock) {
      this._canvas.requestPointerLock()
    }
  }

  _onLockChange(): void {
    if (typeof document === 'undefined') return
    this.locked = document.pointerLockElement === this._canvas
    if (!this.locked) {
      // Drop any queued motion / held button when we lose the lock.
      this._dx = 0
      this._dy = 0
      this._bite = false
    }
  }

  _onMouseMove(e: MouseEvent): void {
    if (!this.locked) return
    this._dx += e.movementX || 0
    this._dy += e.movementY || 0
  }

  _onMouseDown(e: MouseEvent): void {
    if (e.button === 0) this._bite = true
  }

  _onMouseUp(e: MouseEvent): void {
    if (e.button === 0) this._bite = false
  }

  /**
   * Drain accumulated mouse motion into a look delta (radians) and reset it.
   * Returns zero when not pointer-locked.
   */
  consumeLook(): Vec2 {
    if (!this.locked) {
      this._dx = 0
      this._dy = 0
      return { x: 0, y: 0 }
    }
    const look = { x: -this._dx * this.sensitivity, y: -this._dy * this.sensitivity }
    this._dx = 0
    this._dy = 0
    return look
  }

  /** Whether the left mouse button (bite/eat) is currently held. */
  isBiting(): boolean {
    return this._bite && this.locked
  }

  dispose(): void {
    if (this._canvas) {
      this._canvas.removeEventListener('click', this._onClick)
      this._canvas.removeEventListener('mousedown', this._onMouseDown as EventListener)
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('mousemove', this._onMouseMove as EventListener)
      document.removeEventListener('mouseup', this._onMouseUp as EventListener)
      document.removeEventListener('pointerlockchange', this._onLockChange)
      if (this.locked && document.exitPointerLock) document.exitPointerLock()
    }
    this._dx = 0
    this._dy = 0
    this._bite = false
    this.locked = false
  }
}

export default MouseInput
