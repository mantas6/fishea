// Keyboard input source. Tracks the raw pressed state of the movement keys on
// `window` and exposes a snapshot getter. Turning keys into a move vector is
// left to the pure helpers in normalize.js.

import type { KeyState } from './normalize.js'

export class KeyboardInput {
  private _target: EventTarget | null
  private _down: Set<string>

  constructor(target: EventTarget | null = typeof window !== 'undefined' ? window : null) {
    this._target = target
    this._down = new Set()

    this._onKeyDown = this._onKeyDown.bind(this)
    this._onKeyUp = this._onKeyUp.bind(this)
    this._onBlur = this._onBlur.bind(this)

    if (this._target) {
      this._target.addEventListener('keydown', this._onKeyDown as EventListener)
      this._target.addEventListener('keyup', this._onKeyUp as EventListener)
      this._target.addEventListener('blur', this._onBlur)
    }
  }

  _onKeyDown(e: KeyboardEvent): void {
    // Don't hijack browser shortcuts (Ctrl is a modifier we read via getModifierState).
    this._down.add(e.code)
    // Space and arrows would otherwise scroll the page.
    if (SCROLL_KEYS.has(e.code)) e.preventDefault()
  }

  _onKeyUp(e: KeyboardEvent): void {
    this._down.delete(e.code)
  }

  _onBlur(): void {
    // Losing focus should release everything so keys don't get stuck.
    this._down.clear()
  }

  _has(...codes: string[]): boolean {
    for (const c of codes) if (this._down.has(c)) return true
    return false
  }

  /**
   * Snapshot of the semantic key state for this frame.
   */
  getState(): KeyState {
    return {
      forward: this._has('KeyW', 'ArrowUp'),
      back: this._has('KeyS', 'ArrowDown'),
      left: this._has('KeyA', 'ArrowLeft'),
      right: this._has('KeyD', 'ArrowRight'),
      up: this._has('Space'),
      down: this._has('ControlLeft', 'ControlRight', 'KeyC'),
      sprint: this._has('ShiftLeft', 'ShiftRight'),
    }
  }

  dispose(): void {
    if (this._target) {
      this._target.removeEventListener('keydown', this._onKeyDown as EventListener)
      this._target.removeEventListener('keyup', this._onKeyUp as EventListener)
      this._target.removeEventListener('blur', this._onBlur)
    }
    this._down.clear()
  }
}

const SCROLL_KEYS = new Set<string>([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])

export default KeyboardInput
