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
import type { ActiveSource, NormalizedInputState, SourceState } from './normalize.js'

export interface InputManagerOptions {
  deadzone?: number
  mouseSensitivity?: number
  gamepadLookSpeed?: number
}

export class InputManager {
  keyboard: KeyboardInput
  mouse: MouseInput
  gamepad: GamepadInput
  lastActive: ActiveSource
  state: NormalizedInputState

  constructor(canvas: HTMLElement | null, options: InputManagerOptions = {}) {
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
   */
  update(dt: number): NormalizedInputState {
    const gamepad = this.gamepad.getState(dt)
    const keyboardMouse = this._readKeyboardMouse()

    const merged = mergeInputSources(gamepad, keyboardMouse, this.lastActive)
    this.lastActive = merged.activeSource
    this.state = merged
    return merged
  }

  _readKeyboardMouse(): SourceState {
    const keys = this.keyboard.getState()
    return {
      move: keysToMove(keys),
      look: this.mouse.consumeLook(),
      sprint: keys.sprint,
      bite: this.mouse.isBiting(),
    }
  }

  /** The most recent merged input state. */
  getState(): NormalizedInputState {
    return this.state
  }

  /** Whether a gamepad is currently connected. */
  get gamepadConnected(): boolean {
    return this.gamepad.connected
  }

  dispose(): void {
    this.keyboard.dispose()
    this.mouse.dispose()
    this.gamepad.dispose()
  }
}

export default InputManager
