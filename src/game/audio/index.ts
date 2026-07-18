// AudioManager: the single glue object the game talks to. It owns the audio
// engine, the procedural SFX kit, the heartbeat loop and the generative music,
// and maps gameplay events onto them. Importing this module never constructs an
// AudioContext (the engine defers that to the first user gesture), so it's safe
// under the node test environment.

import { AudioEngine } from './engine.js'
import { createSfx, createHeartbeat } from './sfx.js'
import type { Heartbeat, SfxKit } from './sfx.js'
import { Music } from './music.js'
import { heartbeatActive, heartbeatBpm, shouldSuppressHurt } from './theory.js'
import type { EventEmitter, Unsubscribe } from '../events.js'
import type { HudSnapshot } from '../Game.js'

export interface AudioManagerOptions {
  muted?: boolean
  engine?: AudioEngine
}

/** State surfaced to the HUD when audio unlock/mute changes. */
export interface AudioState {
  unlocked: boolean
  muted: boolean
}

/** Anything the AudioManager can attach to (i.e. exposes an event bus). */
export interface AudioAttachable {
  events: EventEmitter
}

export class AudioManager {
  engine: AudioEngine
  sfx: SfxKit
  music: Music
  heartbeat: Heartbeat
  onStateChange: ((state: AudioState) => void) | null
  private _hpFraction: number
  private _heartbeatActive: boolean
  private _unsubs: Unsubscribe[]
  private _muted: boolean
  private _lastDeathAt: number | null
  /** Wall-clock source (ms); injectable/overridable for tests. */
  private _now: () => number

  constructor(options: AudioManagerOptions = {}) {
    this.engine = options.engine ?? new AudioEngine()
    this.sfx = createSfx(this.engine)
    this.music = new Music(this.engine)

    this._hpFraction = 1
    this._heartbeatActive = false
    this.heartbeat = createHeartbeat(this.engine, () => heartbeatBpm(this._hpFraction))

    this._unsubs = []
    this._muted = !!options.muted
    this._lastDeathAt = null
    this._now = () => Date.now()

    // Callback fired whenever the enabled/unlocked state changes so a HUD can
    // reflect it. Set by the host (App).
    this.onStateChange = null

    // Arm the gesture unlock immediately; harmless in node (no window).
    this.engine.armGestureUnlock()
    this.engine.setMuted(this._muted)
    this.engine.onUnlock(() => {
      // Music only makes sense once we actually have a live context.
      if (!this._muted) this.music.start()
      this._emitState()
    })
  }

  get unlocked(): boolean {
    return this.engine.unlocked
  }

  get muted(): boolean {
    return this._muted
  }

  _emitState(): void {
    if (typeof this.onStateChange === 'function') {
      this.onStateChange({ unlocked: this.engine.unlocked, muted: this._muted })
    }
  }

  /**
   * Subscribe to a game's event emitter and wire events -> audio. Returns this
   * for chaining. Safe to call once per game instance.
   */
  attach(game: AudioAttachable): this {
    if (!game || !game.events) return this
    const ev = game.events

    let prevSprinting = false

    this._unsubs.push(
      ev.on('player-ate', () => this.sfx.eat()),
      ev.on('player-bitten', () => {
        // A fatal bite emits 'player-died' (and thus the death cue) just before
        // this handler runs; skip the loud hurt sting so they don't stack.
        if (shouldSuppressHurt(this._now(), this._lastDeathAt)) return
        this.sfx.hurt()
      }),
      ev.on('fish-eaten', () => this.sfx.bite()),
      ev.on('bite-missed', () => this.sfx.miss()),
      ev.on('player-died', () => {
        this._lastDeathAt = this._now()
        this.sfx.death()
        this._setHeartbeat(false) // no thumping on the death screen
        this.music.duck() // give the gentle death cue some quiet space
      }),
      ev.on('player-respawned', () => {
        this._hpFraction = 1
        this._lastDeathAt = null
        this._setHeartbeat(false)
        this.music.unduck()
      }),
      ev.on('hud', (snap) => {
        if (!snap) return
        // Chomp when the player bites (edge-triggered via a dedicated event is
        // cleaner, but 'player-ate' already covers hits; nothing to do here).
        const frac = snap.hpMax > 0 ? snap.hp / snap.hpMax : 1
        this._hpFraction = frac

        // Heartbeat hysteresis: only while alive.
        const shouldBeat = snap.alive && heartbeatActive(this._heartbeatActive, frac)
        this._setHeartbeat(shouldBeat)

        // Sprint-start swish (rising edge of the sprinting flag).
        if (snap.sprinting && !prevSprinting) this.sfx.swish()
        prevSprinting = !!snap.sprinting
      }),
    )
    return this
  }

  _setHeartbeat(active: boolean): void {
    if (active === this._heartbeatActive) return
    this._heartbeatActive = active
    if (active) this.heartbeat.start()
    else this.heartbeat.stop()
  }

  setMuted(value: boolean): boolean {
    this._muted = !!value
    this.engine.setMuted(this._muted)
    if (this._muted) {
      this.music.stop()
      this.heartbeat.stop()
      this._heartbeatActive = false
    } else if (this.engine.unlocked) {
      this.music.start()
    }
    this._emitState()
    return this._muted
  }

  toggleMute(): boolean {
    return this.setMuted(!this._muted)
  }

  /** Detach event handlers and tear down the audio graph. */
  dispose(): void {
    for (const off of this._unsubs) off()
    this._unsubs.length = 0
    this.heartbeat.stop()
    this.music.stop()
    this.engine.dispose()
  }
}

export default AudioManager
