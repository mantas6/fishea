// Thin wrapper around the Web Audio API's AudioContext. Nothing here touches
// AudioContext at module load — the context is created lazily on the first
// user gesture (browser autoplay policies require this), so importing this
// module is safe in a node/test environment.
//
// Signal graph:
//   sources -> sfxGain  -\
//                          >-> masterGain -> destination
//   sources -> musicGain -/
//
// Muting just ramps masterGain to 0 without tearing down the graph.

/** Resolve the AudioContext constructor, or null when unavailable (node). */
function getAudioContextCtor() {
  if (typeof window === 'undefined') return null
  return window.AudioContext || window.webkitAudioContext || null
}

export class AudioEngine {
  /**
   * @param {{masterVolume?:number, musicVolume?:number, sfxVolume?:number}} [options]
   */
  constructor(options = {}) {
    this.masterVolume = options.masterVolume ?? 0.7
    this.musicVolume = options.musicVolume ?? 0.35
    this.sfxVolume = options.sfxVolume ?? 0.9

    /** @type {AudioContext|null} */
    this.ctx = null
    this.master = null
    this.musicGain = null
    this.sfxGain = null

    this._muted = false
    this._unlocked = false
    /** @type {Array<() => void>} listeners fired once the context unlocks */
    this._unlockListeners = []

    // Bound so we can add/remove the same reference.
    this._onGesture = this._onGesture.bind(this)
    this._gestureBound = false
  }

  /**
   * Arm one-shot gesture listeners so the context is created on the first
   * pointerdown/keydown. Safe to call when there's no DOM (no-op).
   * @param {EventTarget} [target]
   */
  armGestureUnlock(target = typeof window !== 'undefined' ? window : null) {
    if (!target || this._gestureBound || this._unlocked) return
    this._gestureTarget = target
    target.addEventListener('pointerdown', this._onGesture)
    target.addEventListener('keydown', this._onGesture)
    target.addEventListener('touchstart', this._onGesture)
    this._gestureBound = true
  }

  _removeGestureListeners() {
    if (!this._gestureBound || !this._gestureTarget) return
    this._gestureTarget.removeEventListener('pointerdown', this._onGesture)
    this._gestureTarget.removeEventListener('keydown', this._onGesture)
    this._gestureTarget.removeEventListener('touchstart', this._onGesture)
    this._gestureBound = false
  }

  _onGesture() {
    this.unlock()
  }

  /**
   * Create (once) and resume the AudioContext + gain buses. Returns true when
   * the context is available and running. Called from the gesture handler but
   * also safe to call directly.
   * @returns {boolean}
   */
  unlock() {
    const Ctor = getAudioContextCtor()
    if (!Ctor) return false

    if (!this.ctx) {
      try {
        this.ctx = new Ctor()
      } catch {
        return false
      }
      this.master = this.ctx.createGain()
      this.master.gain.value = this._muted ? 0 : this.masterVolume
      this.master.connect(this.ctx.destination)

      this.musicGain = this.ctx.createGain()
      this.musicGain.gain.value = this.musicVolume
      this.musicGain.connect(this.master)

      this.sfxGain = this.ctx.createGain()
      this.sfxGain.gain.value = this.sfxVolume
      this.sfxGain.connect(this.master)
    }

    // Contexts may start suspended until a gesture resumes them.
    if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
      this.ctx.resume().catch(() => {})
    }

    if (!this._unlocked) {
      this._unlocked = true
      this._removeGestureListeners()
      const listeners = this._unlockListeners.slice()
      this._unlockListeners.length = 0
      for (const fn of listeners) {
        try {
          fn()
        } catch {
          /* swallow */
        }
      }
    }
    return true
  }

  /** Register a callback fired once when the context unlocks (or now if it already has). */
  onUnlock(fn) {
    if (this._unlocked) {
      fn()
      return
    }
    this._unlockListeners.push(fn)
  }

  get unlocked() {
    return this._unlocked
  }

  /** Current AudioContext time, or 0 when no context exists. */
  now() {
    return this.ctx ? this.ctx.currentTime : 0
  }

  get muted() {
    return this._muted
  }

  /**
   * Mute/unmute by ramping the master bus. Persists across (re)unlock.
   * @param {boolean} value
   */
  setMuted(value) {
    this._muted = !!value
    if (this.master && this.ctx) {
      const t = this.ctx.currentTime
      const g = this.master.gain
      g.cancelScheduledValues(t)
      g.setValueAtTime(g.value, t)
      g.linearRampToValueAtTime(this._muted ? 0 : this.masterVolume, t + 0.08)
    }
    return this._muted
  }

  toggleMute() {
    return this.setMuted(!this._muted)
  }

  /** Tear down listeners and close the context. */
  dispose() {
    this._removeGestureListeners()
    this._unlockListeners.length = 0
    if (this.ctx) {
      try {
        if (typeof this.ctx.close === 'function') this.ctx.close()
      } catch {
        /* ignore */
      }
    }
    this.ctx = null
    this.master = null
    this.musicGain = null
    this.sfxGain = null
    this._unlocked = false
  }
}

export default AudioEngine
