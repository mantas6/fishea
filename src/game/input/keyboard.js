// Keyboard input source. Tracks the raw pressed state of the movement keys on
// `window` and exposes a snapshot getter. Turning keys into a move vector is
// left to the pure helpers in normalize.js.

export class KeyboardInput {
  /**
   * @param {Window|EventTarget} [target] listen target (defaults to window)
   */
  constructor(target = typeof window !== 'undefined' ? window : null) {
    this._target = target
    this._down = new Set()

    this._onKeyDown = this._onKeyDown.bind(this)
    this._onKeyUp = this._onKeyUp.bind(this)
    this._onBlur = this._onBlur.bind(this)

    if (this._target) {
      this._target.addEventListener('keydown', this._onKeyDown)
      this._target.addEventListener('keyup', this._onKeyUp)
      this._target.addEventListener('blur', this._onBlur)
    }
  }

  _onKeyDown(e) {
    // Don't hijack browser shortcuts (Ctrl is a modifier we read via getModifierState).
    this._down.add(e.code)
    // Space and arrows would otherwise scroll the page.
    if (SCROLL_KEYS.has(e.code)) e.preventDefault()
  }

  _onKeyUp(e) {
    this._down.delete(e.code)
  }

  _onBlur() {
    // Losing focus should release everything so keys don't get stuck.
    this._down.clear()
  }

  _has(...codes) {
    for (const c of codes) if (this._down.has(c)) return true
    return false
  }

  /**
   * Snapshot of the semantic key state for this frame.
   * @returns {{forward:boolean,back:boolean,left:boolean,right:boolean,up:boolean,down:boolean,sprint:boolean}}
   */
  getState() {
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

  dispose() {
    if (this._target) {
      this._target.removeEventListener('keydown', this._onKeyDown)
      this._target.removeEventListener('keyup', this._onKeyUp)
      this._target.removeEventListener('blur', this._onBlur)
    }
    this._down.clear()
  }
}

const SCROLL_KEYS = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])

export default KeyboardInput
