// InputManager: owns the three input sources and merges them into ONE
// normalized input state per frame, applying the gamepad-priority rule.
//
// Normalized state shape:
//   {
//     move:   { x, y, z },   // x=strafe(+right), y=vertical(+up), z=forward(+ahead)
//     look:   { x, y },      // per-frame yaw/pitch deltas in radians
//     sprint: boolean,
//     bite:   boolean,
//     activeSource: 'gamepad' | 'keyboard-mouse',
//   }

import { KeyboardInput } from './keyboard.js'
import { MouseInput } from './mouse.js'
import { GamepadInput } from './gamepad.js'
import { keysToMove, mergeInputSources, neutralState } from './normalize.js'

export class InputManager {
  /**
   * @param {HTMLElement} canvas canvas element for pointer-lock mouse look
   * @param {{deadzone?:number,mouseSensitivity?:number,gamepadLookSpeed?:number}} [options]
   */
  constructor(canvas, options = {}) {
    this.keyboard = new KeyboardInput()
    this.mouse = new MouseInput(canvas, { sensitivity: options.mouseSensitivity })
    this.gamepad = new GamepadInput({
      deadzone: options.deadzone,
      lookSpeed: options.gamepadLookSpeed,
    })

    // Latch so the HUD can keep displaying the last-used device when idle.
    this.lastActive = 'keyboard-mouse'
    this.state = { ...neutralState(), activeSource: this.lastActive }
  }

  /**
   * Poll all sources, merge, and update the current state.
   * @param {number} dt seconds
   * @returns {typeof this.state}
   */
  update(dt) {
    const gamepad = this.gamepad.getState(dt)
    const keyboardMouse = this._readKeyboardMouse()

    const merged = mergeInputSources(gamepad, keyboardMouse, this.lastActive)
    this.lastActive = merged.activeSource
    this.state = merged
    return merged
  }

  _readKeyboardMouse() {
    const keys = this.keyboard.getState()
    return {
      move: keysToMove(keys),
      look: this.mouse.consumeLook(),
      sprint: keys.sprint,
      bite: this.mouse.isBiting(),
    }
  }

  /** The most recent merged input state. */
  getState() {
    return this.state
  }

  /** Whether a gamepad is currently connected. */
  get gamepadConnected() {
    return this.gamepad.connected
  }

  dispose() {
    this.keyboard.dispose()
    this.mouse.dispose()
    this.gamepad.dispose()
  }
}

export default InputManager
