// Lightweight synchronous event emitter used to decouple gameplay systems.
// Later tasks (stats HUD, audio) subscribe with on(); gameplay code emit()s.
// Pure JS with no DOM/Three.js dependency so it stays test friendly.

import type { HudSnapshot } from './Game.js'

/** Cause of the player's death, surfaced on the 'player-died' event. */
export type DeathCause = 'eaten' | 'starved'

/**
 * The map of gameplay event names to their payload types. Systems (stats HUD,
 * audio) subscribe to these; gameplay code emits them.
 */
export interface GameEventMap {
  'fish-spawned': { id: string; size: number }
  'fish-despawned': { id: string }
  'fish-eaten': { eaterId: string; targetId: string; targetSize: number }
  'player-ate': { targetId: string; targetSize: number }
  'player-bitten': { attackerId: string; damage: number }
  'bite-missed': { targetId: string | null }
  'player-died': { cause: DeathCause }
  'player-respawned': void
  hud: HudSnapshot
}

/** A handler for an event whose payload type is `P`. */
export type EventHandler<P> = (payload: P) => void

/** An unsubscribe function returned by `on`. */
export type Unsubscribe = () => void

/**
 * A minimal synchronous, strongly-typed event emitter. Generic over an event
 * map (name -> payload type); defaults to `GameEventMap`.
 */
export class EventEmitter<Events = GameEventMap> {
  private _handlers: Map<keyof Events, Set<EventHandler<unknown>>>

  constructor() {
    this._handlers = new Map()
  }

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   */
  on<K extends keyof Events>(name: K, fn: EventHandler<Events[K]>): Unsubscribe {
    let set = this._handlers.get(name)
    if (!set) {
      set = new Set()
      this._handlers.set(name, set)
    }
    set.add(fn as EventHandler<unknown>)
    return () => this.off(name, fn)
  }

  /**
   * Unsubscribe a previously registered handler.
   */
  off<K extends keyof Events>(name: K, fn: EventHandler<Events[K]>): void {
    const set = this._handlers.get(name)
    if (set) set.delete(fn as EventHandler<unknown>)
  }

  /**
   * Emit an event to all subscribers. Handler errors are swallowed so one bad
   * subscriber can't break the game loop.
   */
  emit<K extends keyof Events>(name: K, payload?: Events[K]): void {
    const set = this._handlers.get(name)
    if (!set) return
    for (const fn of set) {
      try {
        fn(payload)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`event handler for "${String(name)}" threw`, err)
      }
    }
  }

  /** Remove every handler. */
  clear(): void {
    this._handlers.clear()
  }
}

export default EventEmitter
