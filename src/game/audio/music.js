// Generative ambient underwater music. Two layers:
//   1. A slow evolving pad: a few detuned oscillators fed through a shared
//      lowpass filter whose cutoff is wobbled by a slow LFO, giving a gentle
//      "breathing" underwater timbre.
//   2. Sparse pentatonic pluck notes fired on a self-scheduling timer at
//      randomized intervals, each a soft filtered sine with a slow release.
//
// Everything is kept at very low volume and routed through the engine's music
// bus. Uses AudioContext time for sample-accurate scheduling of individual
// note envelopes; note *timing* uses setTimeout (fine for slow, sparse events).

import { buildScale, pickNextNote } from './theory.js'

// Root of the pad/melody (A2). Low and calm.
const ROOT_FREQ = 110

export class Music {
  /**
   * @param {import('./engine.js').AudioEngine} engine
   * @param {{rng?:() => number, rootFreq?:number}} [options]
   */
  constructor(engine, options = {}) {
    this.engine = engine
    this.rng = options.rng ?? Math.random
    this.rootFreq = options.rootFreq ?? ROOT_FREQ
    this.scale = buildScale(this.rootFreq, undefined, 3)

    this._running = false
    this._noteTimer = null
    this._prevNote = null

    // Persistent pad graph (created on start, torn down on stop).
    this._padOscs = []
    this._padGain = null
    this._padFilter = null
    this._lfo = null
    this._lfoGain = null
  }

  get running() {
    return this._running
  }

  /** Build the sustained pad drone. */
  _startPad() {
    const ctx = this.engine.ctx
    const t = ctx.currentTime

    this._padGain = ctx.createGain()
    this._padGain.gain.setValueAtTime(0.0001, t)
    this._padGain.gain.linearRampToValueAtTime(0.12, t + 4) // slow fade-in
    this._padGain.connect(this.engine.musicGain)

    this._padFilter = ctx.createBiquadFilter()
    this._padFilter.type = 'lowpass'
    this._padFilter.frequency.value = 480
    this._padFilter.Q.value = 2
    this._padFilter.connect(this._padGain)

    // Slow LFO wobbling the filter cutoff.
    this._lfo = ctx.createOscillator()
    this._lfo.type = 'sine'
    this._lfo.frequency.value = 0.06
    this._lfoGain = ctx.createGain()
    this._lfoGain.gain.value = 220
    this._lfo.connect(this._lfoGain)
    this._lfoGain.connect(this._padFilter.frequency)
    this._lfo.start(t)

    // Detuned oscillator stack around the root + a fifth.
    const voices = [
      { freq: this.rootFreq, detune: -6, type: 'sine' },
      { freq: this.rootFreq, detune: +7, type: 'sine' },
      { freq: this.rootFreq * 1.5, detune: -4, type: 'triangle' },
    ]
    for (const v of voices) {
      const osc = ctx.createOscillator()
      osc.type = v.type
      osc.frequency.value = v.freq
      osc.detune.value = v.detune
      osc.connect(this._padFilter)
      osc.start(t)
      this._padOscs.push(osc)
    }
  }

  /** Schedule and play a single soft pluck, then queue the next. */
  _scheduleNote() {
    if (!this._running) return
    const ctx = this.engine.ctx
    if (ctx && this.engine.musicGain) {
      this._prevNote = pickNextNote(this.scale.length, this.rng, this._prevNote)
      const freq = this.scale[this._prevNote]
      const t = ctx.currentTime

      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq

      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = freq * 4
      filter.Q.value = 0.5

      const g = ctx.createGain()
      const peak = 0.06 + this.rng() * 0.04
      const dur = 1.6 + this.rng() * 1.8
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peak, t + 0.08)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)

      osc.connect(filter)
      filter.connect(g)
      g.connect(this.engine.musicGain)
      osc.start(t)
      osc.stop(t + dur + 0.1)
    }

    // Next note in 2.5–6s.
    const delay = 2500 + this.rng() * 3500
    this._noteTimer = setTimeout(() => this._scheduleNote(), delay)
  }

  /** Start the pad + note scheduler. No-op if already running or not unlocked. */
  start() {
    if (this._running) return
    if (!this.engine.ctx || !this.engine.musicGain) return
    this._running = true
    this._startPad()
    // First pluck after a short lead-in.
    this._noteTimer = setTimeout(() => this._scheduleNote(), 3000)
  }

  /** Stop everything and tear down the pad graph. */
  stop() {
    if (!this._running) return
    this._running = false
    if (this._noteTimer != null) {
      clearTimeout(this._noteTimer)
      this._noteTimer = null
    }
    const ctx = this.engine.ctx
    const t = ctx ? ctx.currentTime : 0
    if (this._padGain && ctx) {
      this._padGain.gain.cancelScheduledValues(t)
      this._padGain.gain.setValueAtTime(this._padGain.gain.value, t)
      this._padGain.gain.linearRampToValueAtTime(0.0001, t + 1.5)
    }
    const stopAt = t + 1.6
    for (const osc of this._padOscs) {
      try {
        osc.stop(stopAt)
      } catch {
        /* already stopped */
      }
    }
    if (this._lfo) {
      try {
        this._lfo.stop(stopAt)
      } catch {
        /* ignore */
      }
    }
    this._padOscs = []
    this._padGain = null
    this._padFilter = null
    this._lfo = null
    this._lfoGain = null
    this._prevNote = null
  }
}

export default Music
