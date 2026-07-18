// Lightweight synchronous event emitter used to decouple gameplay systems.
// Later tasks (stats HUD, audio) subscribe with on(); gameplay code emit()s.
// Pure JS with no DOM/Three.js dependency so it stays test friendly.

export class EventEmitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map()
  }

  /**
   * Subscribe to an event.
   * @param {string} name
   * @param {(payload:any) => void} fn
   * @returns {() => void} unsubscribe function
   */
  on(name, fn) {
    let set = this._handlers.get(name)
    if (!set) {
      set = new Set()
      this._handlers.set(name, set)
    }
    set.add(fn)
    return () => this.off(name, fn)
  }

  /**
   * Unsubscribe a previously registered handler.
   * @param {string} name
   * @param {(payload:any) => void} fn
   */
  off(name, fn) {
    const set = this._handlers.get(name)
    if (set) set.delete(fn)
  }

  /**
   * Emit an event to all subscribers. Handler errors are swallowed so one bad
   * subscriber can't break the game loop.
   * @param {string} name
   * @param {any} [payload]
   */
  emit(name, payload) {
    const set = this._handlers.get(name)
    if (!set) return
    for (const fn of set) {
      try {
        fn(payload)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`event handler for "${name}" threw`, err)
      }
    }
  }

  /** Remove every handler. */
  clear() {
    this._handlers.clear()
  }
}

export default EventEmitter
