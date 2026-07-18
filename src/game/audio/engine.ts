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
//
// iOS/Safari notes (why this is more involved than "new AudioContext()"):
//   * Older iOS only exposes `webkitAudioContext`.
//   * The context must be created AND resumed synchronously inside a *trusted*
//     gesture. `touchstart` frequently does NOT count as trusted for audio;
//     `touchend`/`pointerup`/`click`/`keydown` do — so we listen on those.
//   * Playing a 1-sample silent buffer inside the gesture primes the hardware.
//   * `resume()` may resolve while still not 'running', or reject/hang, so we
//     keep the gesture listeners armed and retry on every gesture until the
//     state is actually 'running'.
//   * Backgrounding / auto-lock parks the context ('suspended'/'interrupted');
//     we resume on visibilitychange/focus, re-arming gestures if that fails.

import { decideUnlock, shouldResume, shouldResumeOnResurface } from './unlock.js'

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

// Gesture events that count as trusted for unlocking audio on iOS Safari.
// Deliberately excludes 'touchstart' (often not honoured) in favour of
// 'touchend'; includes pointer/mouse/keyboard for desktop + stylus.
const GESTURE_EVENTS = ['touchend', 'pointerup', 'click', 'keydown'] as const

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
  private _gestureTarget: EventTarget | null
  private _lifecycleBound: boolean

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
    this._onResurface = this._onResurface.bind(this)
    this._gestureBound = false
    this._gestureTarget = typeof window !== 'undefined' ? window : null
    this._lifecycleBound = false
  }

  /**
   * Arm gesture listeners so the context is created/resumed on the next
   * trusted gesture. Unlike a classic one-shot, these stay armed until the
   * context is actually 'running' (iOS may need several attempts). Safe to
   * call when there's no DOM (no-op) and idempotent while already bound.
   * No-op once we've already unlocked (the public entry point).
   */
  armGestureUnlock(target: EventTarget | null = this._gestureTarget): void {
    if (this._unlocked) return
    if (target) this._gestureTarget = target
    this._armGestureListeners()
  }

  /**
   * Bind the gesture listeners regardless of the unlocked flag. Used both for
   * the initial arm and to recover after a rejected out-of-gesture resume,
   * where we may already be flagged unlocked but still need a tap.
   */
  private _armGestureListeners(): void {
    const target = this._gestureTarget
    if (!target || this._gestureBound) return
    for (const ev of GESTURE_EVENTS) target.addEventListener(ev, this._onGesture)
    this._gestureBound = true
  }

  _removeGestureListeners(): void {
    if (!this._gestureBound || !this._gestureTarget) return
    for (const ev of GESTURE_EVENTS) this._gestureTarget.removeEventListener(ev, this._onGesture)
    this._gestureBound = false
  }

  _onGesture(): void {
    this.unlock()
  }

  /**
   * Bind visibilitychange/focus once so a context parked by backgrounding or
   * auto-lock ('suspended'/'interrupted') gets resumed when the page returns.
   */
  private _bindLifecycle(): void {
    if (this._lifecycleBound) return
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onResurface)
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this._onResurface)
    }
    this._lifecycleBound = true
  }

  private _unbindLifecycle(): void {
    if (!this._lifecycleBound) return
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onResurface)
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this._onResurface)
    }
    this._lifecycleBound = false
  }

  /**
   * Play a 1-sample silent buffer through the destination. The classic iOS
   * unlock trick: doing this inside a trusted gesture primes the audio
   * hardware so subsequent scheduled sounds are audible.
   */
  private _primeSilentBuffer(): void {
    const ctx = this.ctx
    if (!ctx || typeof ctx.createBuffer !== 'function') return
    try {
      const buffer = ctx.createBuffer(1, 1, Math.max(1, ctx.sampleRate || 22050))
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(ctx.destination)
      if (typeof src.start === 'function') src.start(0)
    } catch {
      /* ignore priming failures — not fatal */
    }
  }

  /**
   * Create (once) and resume the AudioContext + gain buses. Returns true when
   * the context is available (regardless of whether it's yet 'running').
   * Called from the gesture handler but also safe to call directly. The heavy
   * lifting — creating the context and priming — happens synchronously so it
   * stays inside the trusted gesture; unlock callbacks fire only once the
   * context reaches 'running'.
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

      this._bindLifecycle()
    }

    // Prime the hardware inside the gesture (harmless if already running).
    this._primeSilentBuffer()

    // Resume (contexts start suspended on iOS) then settle. resume() may
    // reject or hang, so we treat both outcomes as "re-check the state".
    const ctx = this.ctx
    if (shouldResume(ctx.state) && typeof ctx.resume === 'function') {
      const settle = () => this._settleUnlock()
      try {
        const p = ctx.resume()
        if (p && typeof p.then === 'function') p.then(settle, settle)
        else settle()
      } catch {
        settle()
      }
    } else {
      this._settleUnlock()
    }
    return true
  }

  /**
   * Re-check the context state after a resume attempt and act on it: fire the
   * one-shot unlock callbacks only when actually 'running', otherwise keep the
   * gesture listeners armed so the next tap retries.
   */
  private _settleUnlock(): void {
    const state = this.ctx ? this.ctx.state : null
    const { fireUnlock, keepArmed } = decideUnlock(state, this._unlocked)

    if (fireUnlock) {
      this._unlocked = true
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

    if (keepArmed) {
      // Still not running — keep/re-arm listeners for another gesture attempt.
      this._armGestureListeners()
    } else {
      // Running: no more attempts needed.
      this._removeGestureListeners()
    }
  }

  /**
   * Handle the page becoming visible/focused again. If we were previously
   * unlocked but the context got parked, resume it; if that resume is
   * rejected, re-arm gesture listeners so a tap can recover it.
   */
  private _onResurface(): void {
    const ctx = this.ctx
    if (!ctx) return
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    if (!shouldResumeOnResurface(ctx.state, this._unlocked, hidden)) return
    if (typeof ctx.resume !== 'function') return
    try {
      const p = ctx.resume()
      if (p && typeof p.then === 'function') {
        // On success, re-check state; on rejection, require a fresh gesture.
        p.then(() => this._settleUnlock(), () => this._armGestureListeners())
      }
    } catch {
      this._armGestureListeners()
    }
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
    this._unbindLifecycle()
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
