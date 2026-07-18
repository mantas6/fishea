import * as THREE from 'three'
import { createWorld, DEEP_COLOR } from './world.js'
import type { World } from './world.js'
import { createWaterFX } from './fx.js'
import type { WaterFX, BubbleEmitter } from './fx.js'
import { headingToDirection } from './movement.js'
import { Player } from './Player.js'
import {
  computeCameraTarget,
  damp,
  dampVector,
  CAMERA_DEFAULTS,
  framingScale,
  scaleCameraOptions,
  createOrbitState,
  updateOrbitState,
} from './camera.js'
import type { OrbitState } from './camera.js'
import { InputManager } from './input/index.js'
import type { ActiveSource, SourceState } from './input/normalize.js'
import { EventEmitter } from './events.js'
import type { DeathCause } from './events.js'
import { Spawner } from './ai/spawner.js'
import type { AIFish } from './ai/AIFish.js'
import { scanBiteTargets, canEat, eatRange, vdot, vnorm, vsub, BITE_FACING_DOT } from './ai/behavior.js'
import { isOnScreen, ndcToScreenPct, edgeMarker, markerFade, biteCloseness } from './markers.js'
import { createPromptHold, updatePromptHold } from './actionPrompt.js'
import type { PromptHoldState } from './actionPrompt.js'
import { createRestartGate, updateRestartGate } from './deathRestart.js'
import type { RestartGate } from './deathRestart.js'
import { createStats, tickStats, eat, damage, sprintAllowed } from './stats.js'
import type { Stats } from './stats.js'
import { AudioManager } from './audio/index.js'
import type { Vec3 } from './movement.js'

// Owns the Three.js renderer, scene, camera, clock, and the RAF loop.
// All WebGL/DOM work lives here so the pure modules stay test-friendly.

/** An on-screen marker over a nearby eatable fish. */
export interface EatMarker {
  /** Stable id (the fish id) so React can key markers across snapshots. */
  id: string
  /** Horizontal position as a percentage of the viewport (0→100). */
  xPct: number
  /** Vertical position as a percentage of the viewport (0→100). */
  yPct: number
  /** Distance-scaled opacity (closer = more visible). */
  opacity: number
  /**
   * Progress toward the bite, 0 (just entering the cue's engage distance) → 1
   * (within eat range). Drives the marker's ring fill / shrink / brightness.
   */
  closeness: number
  /**
   * True when this fish is actually biteable right now — within eat range AND
   * inside the forward bite cone (same logic as the real bite). Switches the
   * marker to its distinct "bite now!" appearance.
   */
  inRange: boolean
}

/** Edge-of-screen arrow pointing toward the nearest off-screen eatable fish. */
export interface EdgeEatMarker {
  /** Horizontal position as a percentage of the viewport (0→100). */
  xPct: number
  /** Vertical position as a percentage of the viewport (0→100). */
  yPct: number
  /** Arrow rotation in radians (0 = pointing right, +clockwise). */
  angle: number
}

/** How the eatable-fish markers are tuned. */
const MARKER_MAX_DIST = 110 // only mark prey within this 3D distance
const MARKER_NEAR_DIST = 14 // fully opaque at/under this distance
const MARKER_MIN_OPACITY = 0.28 // faintest a marked (in-range) fish gets
const MARKER_MAX_ON_SCREEN = 5 // cap on-screen markers to avoid clutter

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
  /** True when a prey-sized fish is within range of the player's bite. */
  eatPrompt: boolean
  /** On-screen markers over the nearest eatable fish (capped, distance-faded). */
  eatMarkers: EatMarker[]
  /** Edge arrow toward the nearest off-screen eatable fish, or null. */
  edgeMarker: EdgeEatMarker | null
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
  fx: WaterFX
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
  /**
   * Fired once on the rising edge of the gamepad ✕/Cross (bite) button. Used to
   * dismiss the intro overlay from a controller WITHOUT reacting to stick/d-pad
   * movement (which merely auto-switches the controls tab). Keyboard/mouse
   * dismissal is handled by the UI layer's own DOM listeners.
   */
  onDismissPressed?: () => void
  /**
   * Fired on the gamepad ✕/Cross rising edge while the death screen is up (after
   * a short grace period), so a controller can restart the run without touching
   * the keyboard/mouse. The UI layer wires this to the same restart path as the
   * on-screen button. Keyboard (Enter) restart is handled by the UI layer.
   */
  onRestartPressed?: () => void
  private _prevBite: boolean
  // Grace + edge-detection gate for the death-screen controller restart. Null
  // while alive; created on death and cleared on restart.
  private _restartGate: RestartGate | null
  private _initialPlayerSize: number
  private _hudTimer: number
  private _hudInterval: number
  private _activeSource: ActiveSource
  private _unsubs: Array<() => void>
  private _camPos: Vec3
  private _camLook: Vec3
  // Smoothed size-aware framing factor (1 at start size). Eased over time so
  // the camera glides outward when the fish grows in steps rather than snapping.
  private _camScale: number
  private _orbit: OrbitState
  private _running: boolean
  private _rafId: number | null
  // Reused each frame so the sprint bubble-trail emitter never allocates.
  private _trailEmitter: BubbleEmitter
  // Debounced visibility of the contextual "Eat" prompt (see actionPrompt.ts).
  private _eatPrompt: PromptHoldState
  // Scratch vector reused when projecting fish to screen space for HUD markers.
  private _markerVec: THREE.Vector3

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

    // Water FX (ambient bubbles, sprint trails, marine snow, light shafts).
    this.fx = createWaterFX(this.scene)
    this._trailEmitter = { position: { x: 0, y: 0, z: 0 }, emitting: false }

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
    this._prevBite = false
    this._restartGate = null
    this._eatPrompt = createPromptHold()
    this._markerVec = new THREE.Vector3()

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
    this._camScale = framingScale(this.player.size)

    // Idle-orbit camera state: when the player isn't swimming, look input
    // orbits the camera around the fish instead of steering it.
    this._orbit = createOrbitState()

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

    // Dismiss the intro only on the gamepad ✕/Cross (bite) rising edge, so
    // browsing the controls with the sticks / d-pad doesn't skip it.
    const bitePressed = input.bite && !this._prevBite
    this._prevBite = input.bite
    if (this.onDismissPressed && bitePressed && input.activeSource === 'gamepad') {
      this.onDismissPressed()
    }

    // While dead, the gamepad ✕/Cross restarts the run. Gated so a button held
    // through death can't instantly restart (edge detection + a short grace).
    if (!this.alive && this._restartGate) {
      const restartPressed = input.activeSource === 'gamepad' && input.bite
      const gate = updateRestartGate(this._restartGate, restartPressed, dt)
      this._restartGate = gate.state
      if (gate.triggered && this.onRestartPressed) this.onRestartPressed()
    }

    // The input actually driving the fish (frozen once dead so it drifts to a stop).
    const controlInput = this.alive ? input : FROZEN_INPUT

    // Decide follow vs orbit from the movement magnitude, then accumulate look
    // into the orbit offsets (orbit) or let it steer the fish (follow).
    const move = controlInput.move
    const moveMag = Math.hypot(move.x, move.y, move.z)
    this._orbit = updateOrbitState(this._orbit, moveMag, controlInput.look, dt)

    // While orbiting, the fish keeps its idle drift/bite but look no longer
    // steers it — zero the look before handing input to the player.
    const steerInput = this._orbit.orbiting
      ? { ...controlInput, look: { x: 0, y: 0 } }
      : controlInput

    const sprintOk = sprintAllowed(this.stats)
    this.player.applyInput(steerInput, dt, this.alive && sprintOk)

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

    // Contextual eat prompt: is a prey-sized fish biteable right now? Held
    // briefly via hysteresis so quick in/out flips don't flicker the HUD.
    const eatEligible = this.alive && !this.paused && this._eatTargetInRange()
    this._eatPrompt = updatePromptHold(this._eatPrompt, eatEligible, dt)

    // Water FX: recenter the volumetric fields on the player and puff out a
    // bubble trail from just behind/below the fish while sprinting fast.
    const p = this.player.position
    const heading = headingToDirection(this.player.yaw, this.player.pitch)
    const back = this.player.size * 1.6
    this._trailEmitter.position.x = p.x - heading.x * back
    this._trailEmitter.position.y = p.y - heading.y * back - this.player.size * 0.2
    this._trailEmitter.position.z = p.z - heading.z * back
    this._trailEmitter.emitting = sprinting
    this.fx.update(dt, { center: p, emitters: [this._trailEmitter] })

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

  /**
   * Whether the player is currently lined up to eat a prey-sized fish. Uses the
   * exact same range/cone/eligibility scan the actual bite uses (behavior.js),
   * so the hint can never disagree with what a bite would hit.
   */
  _eatTargetInRange(): boolean {
    const { prey } = scanBiteTargets(
      {
        position: this.player.position,
        size: this.player.size,
        heading: headingToDirection(this.player.yaw, this.player.pitch),
      },
      this.spawner.fish,
      this.spawner.aiConfig,
    )
    return prey !== null
  }

  /**
   * Build the HUD prey markers for this frame: on-screen dots over the nearest
   * eatable fish (capped + distance-faded) plus a single edge arrow toward the
   * nearest off-screen eatable fish. Projection (WebGL-bound) lives here; the
   * clamping/fade math is pure in markers.js. Markers are hidden while dead or
   * paused (intro up). Reuses a scratch Vector3 so per-frame cost stays low.
   */
  _computeMarkers(): { eatMarkers: EatMarker[]; edgeMarker: EdgeEatMarker | null } {
    const eatMarkers: EatMarker[] = []
    if (!this.alive || this.paused) return { eatMarkers, edgeMarker: null }

    // Camera transform was set this frame in _updateCamera but matrixWorld is
    // only refreshed at render; update it now so projection is current.
    this.camera.updateMatrixWorld()

    const player = this.player
    const pos = player.position
    // Exact eat range + heading so proximity cues match the real bite.
    const range = eatRange(player.size, this.spawner.aiConfig)
    const heading = headingToDirection(player.yaw, player.pitch)

    // Collect eatable fish within range, nearest first. Small N, so a plain
    // sort is cheaper than a heap and keeps the code obvious.
    const candidates: Array<{ fish: AIFish; dist: number }> = []
    for (const fish of this.spawner.fish) {
      if (!fish.alive) continue
      if (!canEat(player, fish, this.spawner.aiConfig)) continue
      const dx = fish.position.x - pos.x
      const dy = fish.position.y - pos.y
      const dz = fish.position.z - pos.z
      const dist = Math.hypot(dx, dy, dz)
      if (dist > MARKER_MAX_DIST) continue
      candidates.push({ fish, dist })
    }
    candidates.sort((a, b) => a.dist - b.dist)

    const vec = this._markerVec
    let edge: EdgeEatMarker | null = null
    for (const { fish, dist } of candidates) {
      vec.set(fish.position.x, fish.position.y, fish.position.z).project(this.camera)
      const ndc = { x: vec.x, y: vec.y, z: vec.z }
      if (isOnScreen(ndc)) {
        if (eatMarkers.length >= MARKER_MAX_ON_SCREEN) continue
        const { xPct, yPct } = ndcToScreenPct(ndc.x, ndc.y)
        // "Bite now" state uses the exact eat-range + facing-cone test the real
        // bite uses (behavior.scanBiteTargets), so the cue can't disagree.
        const toFish = vnorm(vsub(fish.position, pos))
        const inRange = dist <= range && vdot(toFish, heading) >= BITE_FACING_DOT
        eatMarkers.push({
          id: fish.id,
          xPct,
          yPct,
          opacity: markerFade(dist, MARKER_NEAR_DIST, MARKER_MAX_DIST, MARKER_MIN_OPACITY),
          closeness: biteCloseness(dist, range),
          inRange,
        })
      } else if (!edge) {
        // Nearest off-screen eatable fish becomes the single edge arrow.
        edge = edgeMarker(ndc.x, ndc.y, ndc.z > 1)
      }
    }

    return { eatMarkers, edgeMarker: edge }
  }

  /** Build and emit a HUD snapshot (also invokes onHudUpdate if set). */
  _emitHud(): void {
    const s = this.stats
    const { eatMarkers, edgeMarker: edge } = this._computeMarkers()
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
      eatPrompt: this._eatPrompt.visible,
      eatMarkers,
      edgeMarker: edge,
    }
    if (typeof this.onHudUpdate === 'function') this.onHudUpdate(snapshot)
    this.events.emit('hud', snapshot)
  }

  /** Transition to the dead state exactly once and announce the cause. */
  _handleDeath(cause: DeathCause): void {
    if (!this.alive) return
    this.alive = false
    // Arm the controller restart gate, latching the current bite state so a
    // button held at the moment of death must be released before it can fire.
    this._restartGate = createRestartGate(this._prevBite)
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
    this._restartGate = null

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
    this._camScale = framingScale(this.player.size)
    this._orbit = createOrbitState()

    // Rebuild the fish population from scratch.
    this.spawner.dispose()
    this.spawner.seed()

    this._hudTimer = 0
    this._eatPrompt = createPromptHold()
    this.events.emit('player-respawned')
    this._emitHud()
  }

  _updateCamera(dt: number): void {
    // Ease the framing factor toward the target for the fish's current size so
    // the camera glides outward as it grows (size changes in steps when eating).
    this._camScale = damp(this._camScale, framingScale(this.player.size), CAMERA_DEFAULTS.lambda, dt)
    // Same scaled options drive both follow and idle-orbit framing.
    const opts = scaleCameraOptions(CAMERA_DEFAULTS, this._camScale)
    const { position, lookAt } = computeCameraTarget(
      this.player.position,
      this.player.yaw,
      this.player.pitch,
      opts,
      { yaw: this._orbit.yaw, pitch: this._orbit.pitch },
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
    this.fx.dispose()
    this.world.dispose()

    this.renderer.dispose()
    const canvas = this.renderer.domElement
    if (canvas && canvas.parentNode === this.container) {
      this.container.removeChild(canvas)
    }
  }
}

export default Game
