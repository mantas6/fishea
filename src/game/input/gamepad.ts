// Gamepad input source (PS4 / DualShock, standard mapping). Polls
// navigator.getGamepads() each frame and builds a normalized source state via
// the pure helpers in normalize.js. Tracks connect/disconnect events.

import {
  DEADZONE,
  GAMEPAD_LOOK_SPEED,
  GAMEPAD_BUTTONS as B,
  applyStickDeadzone,
  stickToMove,
  stickToLook,
  neutralState,
} from './normalize.js'
import type { SourceState } from './normalize.js'

export interface GamepadOptions {
  deadzone?: number
  lookSpeed?: number
  target?: EventTarget | null
}

type GamepadButtonLike = GamepadButton | number | undefined

export class GamepadInput {
  deadzone: number
  lookSpeed: number
  private _target: EventTarget | null
  private _index: number | null

  constructor(options: GamepadOptions = {}) {
    this.deadzone = options.deadzone ?? DEADZONE
    this.lookSpeed = options.lookSpeed ?? GAMEPAD_LOOK_SPEED
    this._target = options.target ?? (typeof window !== 'undefined' ? window : null)
    this._index = null // index of the active pad, or null

    this._onConnect = this._onConnect.bind(this)
    this._onDisconnect = this._onDisconnect.bind(this)

    if (this._target) {
      this._target.addEventListener('gamepadconnected', this._onConnect as EventListener)
      this._target.addEventListener('gamepaddisconnected', this._onDisconnect as EventListener)
    }
  }

  _onConnect(e: GamepadEvent): void {
    if (this._index == null && e.gamepad) this._index = e.gamepad.index
  }

  _onDisconnect(e: GamepadEvent): void {
    if (e.gamepad && e.gamepad.index === this._index) this._index = null
  }

  /** Whether a gamepad is currently connected/available. */
  get connected(): boolean {
    return this._poll() != null
  }

  /** Read the live Gamepad object we're tracking (or the first present one). */
  _poll(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null
    const pads = navigator.getGamepads()
    if (!pads) return null

    // Prefer the tracked index; otherwise adopt the first connected pad.
    if (this._index != null && pads[this._index]) return pads[this._index]
    for (const pad of pads) {
      if (pad) {
        this._index = pad.index
        return pad
      }
    }
    return null
  }

  _pressed(buttons: ReadonlyArray<GamepadButtonLike>, i: number): boolean {
    const b = buttons[i]
    return !!b && (typeof b === 'object' ? b.pressed || b.value > 0.5 : b > 0.5)
  }

  /**
   * Build this frame's normalized source state from the live pad.
   */
  getState(dt: number): SourceState {
    const pad = this._poll()
    if (!pad) return neutralState()

    const axes = pad.axes || []
    const buttons = pad.buttons || []

    const left = applyStickDeadzone(axes[0] || 0, axes[1] || 0, this.deadzone)
    const right = applyStickDeadzone(axes[2] || 0, axes[3] || 0, this.deadzone)

    const up = this._pressed(buttons, B.UP) || this._pressed(buttons, B.DPAD_UP)
    const down = this._pressed(buttons, B.DOWN) || this._pressed(buttons, B.DPAD_DOWN)

    return {
      move: stickToMove(left, { up, down }),
      look: stickToLook(right, dt, this.lookSpeed),
      sprint:
        this._pressed(buttons, B.SPRINT) ||
        this._pressed(buttons, B.SPRINT_ALT) ||
        this._pressed(buttons, B.SPRINT_ALT2),
      bite: this._pressed(buttons, B.BITE) || this._pressed(buttons, B.BITE_ALT),
    }
  }

  dispose(): void {
    if (this._target) {
      this._target.removeEventListener('gamepadconnected', this._onConnect as EventListener)
      this._target.removeEventListener('gamepaddisconnected', this._onDisconnect as EventListener)
    }
    this._index = null
  }
}

export default GamepadInput
