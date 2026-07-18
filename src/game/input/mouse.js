// Mouse input source: pointer-lock "mouse look" on the game canvas plus a
// left-button bite/eat flag. Movement is accumulated between frames and drained
// by consumeLook() so no motion is lost or double-counted.
//
// Sign convention (matches movement.js headingToDirection where yaw 0 faces -Z):
//   moving the mouse right  -> turn right (yaw decreases) -> look.x = -dx * s
//   moving the mouse up      -> look up (pitch increases)  -> look.y = -dy * s

const DEFAULT_SENSITIVITY = 0.0022 // radians per pixel of mouse movement

export class MouseInput {
  /**
   * @param {HTMLElement} canvas element to pointer-lock (click to lock)
   * @param {{sensitivity?:number}} [options]
   */
  constructor(canvas, options = {}) {
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
      this._canvas.addEventListener('mousedown', this._onMouseDown)
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('mousemove', this._onMouseMove)
      document.addEventListener('mouseup', this._onMouseUp)
      document.addEventListener('pointerlockchange', this._onLockChange)
    }
  }

  _onClick() {
    if (!this.locked && this._canvas && this._canvas.requestPointerLock) {
      this._canvas.requestPointerLock()
    }
  }

  _onLockChange() {
    if (typeof document === 'undefined') return
    this.locked = document.pointerLockElement === this._canvas
    if (!this.locked) {
      // Drop any queued motion / held button when we lose the lock.
      this._dx = 0
      this._dy = 0
      this._bite = false
    }
  }

  _onMouseMove(e) {
    if (!this.locked) return
    this._dx += e.movementX || 0
    this._dy += e.movementY || 0
  }

  _onMouseDown(e) {
    if (e.button === 0) this._bite = true
  }

  _onMouseUp(e) {
    if (e.button === 0) this._bite = false
  }

  /**
   * Drain accumulated mouse motion into a look delta (radians) and reset it.
   * Returns zero when not pointer-locked.
   * @returns {{x:number,y:number}}
   */
  consumeLook() {
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
  isBiting() {
    return this._bite && this.locked
  }

  dispose() {
    if (this._canvas) {
      this._canvas.removeEventListener('click', this._onClick)
      this._canvas.removeEventListener('mousedown', this._onMouseDown)
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('mousemove', this._onMouseMove)
      document.removeEventListener('mouseup', this._onMouseUp)
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
