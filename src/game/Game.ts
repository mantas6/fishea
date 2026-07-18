import * as THREE from 'three'
import { createWorld, DEEP_COLOR } from './world.js'
import type { World } from './world.js'
import { Player } from './Player.js'
import { computeCameraTarget, dampVector, CAMERA_DEFAULTS } from './camera.js'
import { InputManager } from './input/index.js'
import type { ActiveSource, SourceState } from './input/normalize.js'
import { hasInputActivity } from './input/normalize.js'
import { EventEmitter } from './events.js'
import type { DeathCause } from './events.js'
import { Spawner } from './ai/spawner.js'
import { createStats, tickStats, eat, damage, sprintAllowed } from './stats.js'
import type { Stats } from './stats.js'
import { AudioManager } from './audio/index.js'
import type { Vec3 } from './movement.js'

// Owns the Three.js renderer, scene, camera, clock, and the RAF loop.
// All WebGL/DOM work lives here so the pure modules stay test-friendly.

/** The throttled snapshot the HUD renders (also emitted as the 'hud' event). */
export interface HudSnapshot {
  hp: number
  hpMax: number
  hunger: number
  hungerMax: number
  stamina: number
  staminaMax: number
  exhausted: boolean
  size: number
  activeSource: ActiveSource
  alive: boolean
  sprinting: boolean
}

// Neutral input used to freeze the player after death (drifts to a stop).
const FROZEN_INPUT: SourceState = {
  move: { x: 0, y: 0, z: 0 },
  look: { x: 0, y: 0 },
  sprint: false,
  bite: false,
}

export class Game {
  container: HTMLElement
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  world: World
  player: Player
  events: EventEmitter
  stats: Stats
  alive: boolean
  spawner: Spawner
  input: InputManager
  audio: AudioManager
  clock: THREE.Clock
  /**
   * When true (e.g. while the intro overlay is up) survival stats stop draining
   * and AI fish won't bite the player. The scene still renders and animates so
   * the ocean is alive behind the overlay. Toggled by the UI layer.
   */
  paused: boolean
  onHudUpdate?: (snapshot: HudSnapshot) => void
  /** Fired each frame that any input device shows activity (used to dismiss the intro). */
  onInputActivity?: (source: ActiveSource) => void
  private _initialPlayerSize: number
  private _hudTimer: number
  private _hudInterval: number
  private _activeSource: ActiveSource
  private _unsubs: Array<() => void>
  private _camPos: Vec3
  private _camLook: Vec3
  private _running: boolean
  private _rafId: number | null

  constructor(container: HTMLElement) {
    if (!container) throw new Error('Game requires a container element')
    this.container = container

    const width = container.clientWidth || window.innerWidth
    const height = container.clientHeight || window.innerHeight

    // Renderer.
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(width, height)
    this.renderer.setClearColor(new THREE.Color(DEEP_COLOR))
    container.appendChild(this.renderer.domElement)

    // Scene + camera.
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)
    this.camera.position.set(0, 24, 12)
    this.camera.lookAt(0, 20, 0)

    // World + player.
    this.world = createWorld(this.scene)
    this._initialPlayerSize = 1.6
    this.player = new Player({ size: this._initialPlayerSize })
    this.scene.add(this.player.object3d)

    // Gameplay event bus. Systems (stats HUD, audio) subscribe here.
    // Emitted events: 'fish-spawned', 'fish-despawned', 'fish-eaten',
    // 'player-ate', 'player-bitten', 'bite-missed', 'player-died', 'hud'.
    this.events = new EventEmitter()

    // Survival stats (pure model in stats.js). `alive` mirrors stats.alive so
    // the loop can freeze player control on death without re-deriving it.
    this.stats = createStats()
    this.alive = true
    this.paused = false

    // HUD is refreshed on a throttle (~10Hz) rather than every frame.
    this._hudTimer = 0
    this._hudInterval = 0.1
    this._activeSource = 'keyboard-mouse'

    // Wire stats reactions to gameplay events; keep unsubscribers for dispose.
    this._unsubs = [
      this.events.on('player-ate', ({ targetSize }) => {
        if (!this.alive) return
        this.stats = eat(this.stats, targetSize)
      }),
      this.events.on('player-bitten', ({ damage: amount }) => {
        if (!this.alive) return
        const { stats, dead } = damage(this.stats, amount)
        this.stats = stats
        if (dead) this._handleDeath('eaten')
      }),
    ]

    // AI fish population + eating mechanics.
    this.spawner = new Spawner({
      scene: this.scene,
      player: this.player,
      events: this.events,
    })
    this.spawner.seed()

    // Input: keyboard/mouse + gamepad, merged into one state each frame.
    this.input = new InputManager(this.renderer.domElement)

    // Procedural audio (SFX + generative ambient music). The AudioContext is
    // created lazily on the first user gesture, so this is safe to construct
    // here; it just subscribes to the event bus.
    this.audio = new AudioManager()
    this.audio.attach(this)

    // Smoothed camera state.
    this._camPos = { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z }
    this._camLook = { x: 0, y: 20, z: 0 }

    this.clock = new THREE.Clock()
    this._running = false
    this._rafId = null

    this._onResize = this._onResize.bind(this)
    this._loop = this._loop.bind(this)
    window.addEventListener('resize', this._onResize)
  }

  /** Start the render loop. */
  start(): void {
    if (this._running) return
    this._running = true
    this.clock.start()
    this._rafId = requestAnimationFrame(this._loop)
  }

  /** Stop the render loop (without tearing down resources). */
  stop(): void {
    this._running = false
    if (this._rafId != null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
  }

  _loop(): void {
    if (!this._running) return
    const dt = Math.min(this.clock.getDelta(), 0.1) // clamp big frame gaps

    const input = this.input.update(dt)
    this._activeSource = input.activeSource
    if (this.onInputActivity && hasInputActivity(input)) {
      this.onInputActivity(input.activeSource)
    }

    const sprintOk = sprintAllowed(this.stats)
    if (this.alive) {
      this.player.applyInput(input, dt, sprintOk)
    } else {
      // Frozen on death: bleed off velocity but ignore steering/thrust.
      this.player.applyInput(FROZEN_INPUT, dt, false)
    }

    // Sprinting only counts (and drains stamina) when actually moving fast.
    const sprinting = this.alive && this.player.sprinting && this.player.currentSpeed > 0.5
    // While paused (intro up) survival stats freeze so the player isn't punished.
    if (!this.paused) {
      const wasAlive = this.alive
      this.stats = tickStats(this.stats, dt, { sprinting })
      if (wasAlive && !this.stats.alive) this._handleDeath('starved')
    }

    // Fish keep swimming behind the intro, but they won't attack while paused.
    this.spawner.update(dt, { attackPlayer: !this.paused })
    this.world.update(dt)
    this._updateCamera(dt)

    // Throttled HUD refresh.
    this._hudTimer += dt
    if (this._hudTimer >= this._hudInterval) {
      this._hudTimer = 0
      this._emitHud()
    }

    this.renderer.render(this.scene, this.camera)
    this._rafId = requestAnimationFrame(this._loop)
  }

  /** Build and emit a HUD snapshot (also invokes onHudUpdate if set). */
  _emitHud(): void {
    const s = this.stats
    const snapshot: HudSnapshot = {
      hp: s.hp,
      hpMax: s.hpMax,
      hunger: s.hunger,
      hungerMax: s.hungerMax,
      stamina: s.stamina,
      staminaMax: s.staminaMax,
      exhausted: s.exhausted,
      size: this.player.size,
      activeSource: this._activeSource,
      alive: this.alive,
      sprinting: this.alive && this.player.sprinting && this.player.currentSpeed > 0.5,
    }
    if (typeof this.onHudUpdate === 'function') this.onHudUpdate(snapshot)
    this.events.emit('hud', snapshot)
  }

  /** Transition to the dead state exactly once and announce the cause. */
  _handleDeath(cause: DeathCause): void {
    if (!this.alive) return
    this.alive = false
    this.events.emit('player-died', { cause })
    this._emitHud()
  }

  /**
   * Reset stats, the player, and the fish population for a fresh run.
   * Safe to call at any time (whether alive or dead).
   */
  restart(): void {
    this.stats = createStats()
    this.alive = true

    // Reset player gameplay + visual state.
    this.player.position = { x: 0, y: 20, z: 0 }
    this.player.velocity = { x: 0, y: 0, z: 0 }
    this.player.yaw = 0
    this.player.pitch = 0
    this.player.size = this._initialPlayerSize
    if (this.player.fish && this.player.fish.setSize) {
      this.player.fish.setSize(this._initialPlayerSize)
    }
    this.player._syncTransform()

    // Rebuild the fish population from scratch.
    this.spawner.dispose()
    this.spawner.seed()

    this._hudTimer = 0
    this.events.emit('player-respawned')
    this._emitHud()
  }

  _updateCamera(dt: number): void {
    const { position, lookAt } = computeCameraTarget(
      this.player.position,
      this.player.yaw,
      this.player.pitch,
      CAMERA_DEFAULTS,
    )
    this._camPos = dampVector(this._camPos, position, CAMERA_DEFAULTS.lambda, dt)
    this._camLook = dampVector(this._camLook, lookAt, CAMERA_DEFAULTS.lambda, dt)
    this.camera.position.set(this._camPos.x, this._camPos.y, this._camPos.z)
    this.camera.lookAt(this._camLook.x, this._camLook.y, this._camLook.z)
  }

  _onResize(): void {
    const width = this.container.clientWidth || window.innerWidth
    const height = this.container.clientHeight || window.innerHeight
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  /** Tear everything down and remove the canvas. */
  dispose(): void {
    this.stop()
    window.removeEventListener('resize', this._onResize)

    for (const unsub of this._unsubs) unsub()
    this._unsubs.length = 0

    this.audio.dispose()
    this.input.dispose()
    this.spawner.dispose()
    this.player.dispose()
    this.world.dispose()

    this.renderer.dispose()
    const canvas = this.renderer.domElement
    if (canvas && canvas.parentNode === this.container) {
      this.container.removeChild(canvas)
    }
  }
}

export default Game
