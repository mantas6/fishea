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

export interface AudioEngineOptions {
  masterVolume?: number
  musicVolume?: number
  sfxVolume?: number
}

type AudioContextCtor = new () => AudioContext

/** Resolve the AudioContext constructor, or null when unavailable (node). */
function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as typeof window & { webkitAudioContext?: AudioContextCtor }
  return w.AudioContext || w.webkitAudioContext || null
}

export class AudioEngine {
  masterVolume: number
  musicVolume: number
  sfxVolume: number
  ctx: AudioContext | null
  master: GainNode | null
  musicGain: GainNode | null
  sfxGain: GainNode | null
  private _muted: boolean
  private _unlocked: boolean
  private _unlockListeners: Array<() => void>
  private _gestureBound: boolean
  private _gestureTarget?: EventTarget | null

  constructor(options: AudioEngineOptions = {}) {
    this.masterVolume = options.masterVolume ?? 0.7
    this.musicVolume = options.musicVolume ?? 0.35
    this.sfxVolume = options.sfxVolume ?? 0.9

    this.ctx = null
    this.master = null
    this.musicGain = null
    this.sfxGain = null

    this._muted = false
    this._unlocked = false
    this._unlockListeners = []

    // Bound so we can add/remove the same reference.
    this._onGesture = this._onGesture.bind(this)
    this._gestureBound = false
  }

  /**
   * Arm one-shot gesture listeners so the context is created on the first
   * pointerdown/keydown. Safe to call when there's no DOM (no-op).
   */
  armGestureUnlock(target: EventTarget | null = typeof window !== 'undefined' ? window : null): void {
    if (!target || this._gestureBound || this._unlocked) return
    this._gestureTarget = target
    target.addEventListener('pointerdown', this._onGesture)
    target.addEventListener('keydown', this._onGesture)
    target.addEventListener('touchstart', this._onGesture)
    this._gestureBound = true
  }

  _removeGestureListeners(): void {
    if (!this._gestureBound || !this._gestureTarget) return
    this._gestureTarget.removeEventListener('pointerdown', this._onGesture)
    this._gestureTarget.removeEventListener('keydown', this._onGesture)
    this._gestureTarget.removeEventListener('touchstart', this._onGesture)
    this._gestureBound = false
  }

  _onGesture(): void {
    this.unlock()
  }

  /**
   * Create (once) and resume the AudioContext + gain buses. Returns true when
   * the context is available and running. Called from the gesture handler but
   * also safe to call directly.
   */
  unlock(): boolean {
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
  onUnlock(fn: () => void): void {
    if (this._unlocked) {
      fn()
      return
    }
    this._unlockListeners.push(fn)
  }

  get unlocked(): boolean {
    return this._unlocked
  }

  /** Current AudioContext time, or 0 when no context exists. */
  now(): number {
    return this.ctx ? this.ctx.currentTime : 0
  }

  get muted(): boolean {
    return this._muted
  }

  /**
   * Mute/unmute by ramping the master bus. Persists across (re)unlock.
   */
  setMuted(value: boolean): boolean {
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

  toggleMute(): boolean {
    return this.setMuted(!this._muted)
  }

  /** Tear down listeners and close the context. */
  dispose(): void {
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
