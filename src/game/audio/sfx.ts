// Procedural sound effects synthesized on the fly with oscillators, noise
// buffers, filters and gain envelopes — no external audio assets. Each factory
// takes an AudioEngine and returns a small object with trigger methods. All
// nodes are one-shot: they're created per hit and stop themselves so there's
// nothing to garbage collect manually.

import type { AudioEngine } from './engine.js'

/** The procedural SFX kit returned by createSfx. */
export interface SfxKit {
  bite(): void
  eat(): void
  miss(): void
  hurt(): void
  death(): void
  swish(): void
}

/** A running low-HP heartbeat loop. */
export interface Heartbeat {
  readonly running: boolean
  start(): void
  stop(): void
}

type NoiseCache = Record<string, AudioBuffer>

interface EnvGainOptions {
  peak?: number
  attack?: number
  decay?: number
  start: number
}

interface NoiseBurstOptions {
  start: number
  duration?: number
  peak?: number
  type?: BiquadFilterType
  freq?: number
  q?: number
}

interface ToneOptions {
  start: number
  type?: OscillatorType
  freqStart?: number
  freqEnd?: number
  duration?: number
  peak?: number
  attack?: number
}

interface SoftToneOptions {
  start: number
  freq: number
  type?: OscillatorType
  peak?: number
  attack?: number
  release?: number
  cutoff?: number
}

// --- Low-level building blocks --------------------------------------------

/** Build (and cache) a mono white-noise buffer of `seconds` length. */
function getNoiseBuffer(ctx: AudioContext, cache: NoiseCache, seconds = 1): AudioBuffer {
  const key = `noise:${seconds}`
  if (cache[key]) return cache[key]
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  cache[key] = buffer
  return buffer
}

/** A quick percussive gain envelope (attack -> exponential decay). */
function envGain(
  ctx: AudioContext,
  dest: AudioNode,
  { peak = 1, attack = 0.005, decay = 0.2, start }: EnvGainOptions,
): GainNode {
  const g = ctx.createGain()
  const t = start
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  g.connect(dest)
  return g
}

/**
 * Create the procedural SFX kit bound to an AudioEngine. Every trigger is a
 * no-op until the engine is unlocked (has a live context + sfx bus).
 */
export function createSfx(engine: AudioEngine): SfxKit {
  const noiseCache: NoiseCache = {}

  function ready(): boolean {
    return !!(engine && engine.ctx && engine.sfxGain)
  }

  /** Play a one-shot noise burst through an optional filter. */
  function noiseBurst({
    start,
    duration = 0.15,
    peak = 0.6,
    type = 'lowpass',
    freq = 800,
    q = 1,
  }: NoiseBurstOptions): void {
    const ctx = engine.ctx!
    const src = ctx.createBufferSource()
    src.buffer = getNoiseBuffer(ctx, noiseCache, Math.max(0.25, duration + 0.05))
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.setValueAtTime(freq, start)
    filter.Q.value = q
    const g = envGain(ctx, engine.sfxGain!, { peak, attack: 0.004, decay: duration, start })
    src.connect(filter)
    filter.connect(g)
    src.start(start)
    src.stop(start + duration + 0.1)
  }

  /** Play a one-shot oscillator tone with a pitch sweep + amp envelope. */
  function tone({
    start,
    type = 'sine',
    freqStart = 440,
    freqEnd = freqStart,
    duration = 0.2,
    peak = 0.5,
    attack = 0.005,
  }: ToneOptions): void {
    const ctx = engine.ctx!
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freqStart, start)
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), start + duration)
    }
    const g = envGain(ctx, engine.sfxGain!, { peak, attack, decay: duration, start })
    osc.connect(g)
    osc.start(start)
    osc.stop(start + duration + 0.05)
  }

  /**
   * Play a soft, mellow tone: a single sine/triangle through a gentle lowpass
   * with a slow attack and a long, smooth release. The gain envelope starts and
   * ends at exactly zero (via linear ramps at the edges) so there are no clicks.
   */
  function softTone({
    start,
    freq,
    type = 'sine',
    peak = 0.16,
    attack = 0.08,
    release = 1.2,
    cutoff = 1200,
  }: SoftToneOptions): void {
    const ctx = engine.ctx!
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, start)

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(cutoff, start)
    filter.Q.value = 0.5

    const g = ctx.createGain()
    const end = start + attack + release
    g.gain.setValueAtTime(0, start) // begin at true zero
    g.gain.linearRampToValueAtTime(Math.max(0.0001, peak), start + attack) // slow soft attack
    g.gain.exponentialRampToValueAtTime(0.0008, end - 0.06) // long, soft decay
    g.gain.linearRampToValueAtTime(0, end) // settle to exact zero (no click)

    osc.connect(filter)
    filter.connect(g)
    g.connect(engine.sfxGain!)
    osc.start(start)
    osc.stop(end + 0.03)
  }

  return {
    /** Bite/chomp: short filtered noise burst layered with a low thump. */
    bite() {
      if (!ready()) return
      const t = engine.now()
      noiseBurst({ start: t, duration: 0.12, peak: 0.5, type: 'bandpass', freq: 1400, q: 0.8 })
      tone({ start: t, type: 'sine', freqStart: 160, freqEnd: 55, duration: 0.14, peak: 0.6 })
    },

    /** Eat success: a bright rising blip. */
    eat() {
      if (!ready()) return
      const t = engine.now()
      tone({ start: t, type: 'triangle', freqStart: 420, freqEnd: 880, duration: 0.16, peak: 0.5 })
      tone({ start: t + 0.02, type: 'sine', freqStart: 660, freqEnd: 1200, duration: 0.14, peak: 0.28 })
    },

    /** Bite miss: a dull, muffled thud/whiff. */
    miss() {
      if (!ready()) return
      const t = engine.now()
      noiseBurst({ start: t, duration: 0.18, peak: 0.28, type: 'lowpass', freq: 320, q: 0.7 })
      tone({ start: t, type: 'sine', freqStart: 120, freqEnd: 70, duration: 0.16, peak: 0.22 })
    },

    /** Player hurt: harsh downward sweep. */
    hurt() {
      if (!ready()) return
      const t = engine.now()
      tone({ start: t, type: 'sawtooth', freqStart: 520, freqEnd: 90, duration: 0.32, peak: 0.5 })
      noiseBurst({ start: t, duration: 0.12, peak: 0.2, type: 'highpass', freq: 900, q: 0.6 })
    },

    /**
     * Death: a soft, muffled underwater "thud/sigh" — deliberately NOT a melody.
     * A single mellow low sine through a low lowpass, doubled an octave below for
     * weight (same pitch class, so there's no melodic interval to hook the ear),
     * with a gentle attack and a short, smooth release. Peaks sit far below every
     * other SFX (~0.09 vs 0.5–0.6) so the moment reads as a quiet fade rather
     * than a sting. No harsh oscillators, no high frequencies, no repetition.
     */
    death() {
      if (!ready()) return
      const t = engine.now()
      // Muffled low tone (F3) — the soft "sigh".
      softTone({ start: t, freq: 174.61, type: 'sine', peak: 0.09, attack: 0.1, release: 0.9, cutoff: 500 })
      // Faint sub an octave down (F2) for a soft settling weight.
      softTone({ start: t, freq: 87.31, type: 'sine', peak: 0.05, attack: 0.12, release: 1.1, cutoff: 320 })
    },

    /** Sprint start: subtle rising bubbly swish. */
    swish() {
      if (!ready()) return
      const t = engine.now()
      const ctx = engine.ctx!
      const src = ctx.createBufferSource()
      src.buffer = getNoiseBuffer(ctx, noiseCache, 0.6)
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.Q.value = 1.2
      filter.frequency.setValueAtTime(500, t)
      filter.frequency.exponentialRampToValueAtTime(2600, t + 0.3)
      const g = envGain(ctx, engine.sfxGain!, { peak: 0.18, attack: 0.05, decay: 0.3, start: t })
      src.connect(filter)
      filter.connect(g)
      src.start(t)
      src.stop(t + 0.45)
    },
  }
}

// --- Low-HP heartbeat loop -------------------------------------------------

/**
 * A self-scheduling heartbeat "lub-dub" loop. Runs on a setTimeout timer (the
 * game loop isn't guaranteed while paused) and synthesizes two soft low thumps
 * per beat. Tempo is refreshed from a getter so it can speed up as HP drops.
 */
export function createHeartbeat(engine: AudioEngine, getBpm: () => number): Heartbeat {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false

  function thump(start: number, freq: number, peak: number): void {
    const ctx = engine.ctx!
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, start)
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, start + 0.12)
    const g = envGain(ctx, engine.sfxGain!, { peak, attack: 0.008, decay: 0.16, start })
    osc.connect(g)
    osc.start(start)
    osc.stop(start + 0.22)
  }

  function beat(): void {
    if (!running) return
    if (engine.ctx && engine.sfxGain) {
      const t = engine.now()
      thump(t, 60, 0.5) // "lub"
      thump(t + 0.16, 48, 0.32) // "dub"
    }
    const bpm = Math.max(30, getBpm() || 60)
    timer = setTimeout(beat, (60 / bpm) * 1000)
  }

  return {
    get running() {
      return running
    },
    start() {
      if (running) return
      running = true
      beat()
    },
    stop() {
      running = false
      if (timer != null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}

export default { createSfx, createHeartbeat }
