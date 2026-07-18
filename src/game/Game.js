import * as THREE from 'three'
import { createWorld, DEEP_COLOR } from './world.js'
import { Player } from './Player.js'
import { computeCameraTarget, dampVector, CAMERA_DEFAULTS } from './camera.js'

// Owns the Three.js renderer, scene, camera, clock, and the RAF loop.
// All WebGL/DOM work lives here so the pure modules stay test-friendly.

export class Game {
  /**
   * @param {HTMLElement} container element to mount the canvas into
   */
  constructor(container) {
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
    this.player = new Player({ size: 1.6 })
    this.scene.add(this.player.object3d)

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
  start() {
    if (this._running) return
    this._running = true
    this.clock.start()
    this._rafId = requestAnimationFrame(this._loop)
  }

  /** Stop the render loop (without tearing down resources). */
  stop() {
    this._running = false
    if (this._rafId != null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
  }

  _loop() {
    if (!this._running) return
    const dt = Math.min(this.clock.getDelta(), 0.1) // clamp big frame gaps

    this.player.update(dt)
    this.world.update(dt)
    this._updateCamera(dt)

    this.renderer.render(this.scene, this.camera)
    this._rafId = requestAnimationFrame(this._loop)
  }

  _updateCamera(dt) {
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

  _onResize() {
    const width = this.container.clientWidth || window.innerWidth
    const height = this.container.clientHeight || window.innerHeight
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  /** Tear everything down and remove the canvas. */
  dispose() {
    this.stop()
    window.removeEventListener('resize', this._onResize)

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
