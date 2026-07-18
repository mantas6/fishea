import * as THREE from 'three'
import { approach, stepPhase } from '../movement.js'

// Swim-animation tuning. Kept as named constants so the motion can be tweaked
// in one place.
const SWIM = {
  // Tail beat frequency (rad/s) scales with speed: base + speed * perSpeed.
  wagFreqBase: 6,
  wagFreqPerSpeed: 1.5,
  // Body-roll and pectoral-fin flutter run at multiples of the tail frequency.
  rollFreqRatio: 0.5,
  flutterFreqRatio: 1.3,
  // Amplitudes.
  tailAmplitude: 0.6,
  rollAmplitude: 0.06,
  flutterAmplitude: 0.25,
  // Beat intensity grows with speed but is capped.
  intensityBase: 0.35,
  intensityPerSpeed: 0.12,
  intensityMax: 1.2,
  // How quickly the speed fed to the animation follows the real speed. Damping
  // this stops per-frame speed jitter (and abrupt AI mode changes) from making
  // the tail beat stutter in frequency/amplitude.
  speedLambda: 6,
}

// Procedural fish built entirely from primitives so it needs no external assets.
// Returned as a class wrapping a THREE.Group; call update(dt, speed) each frame.
// Reusable/parameterizable so AI fish can share the exact same builder later.

export interface FishMeshOptions {
  size: number
  color: number
  bellyColor: number
  finColor: number
  eyeColor: number
}

const DEFAULTS: FishMeshOptions = {
  size: 1, // overall scale multiplier
  color: 0xff8c42, // body color
  bellyColor: 0xffe0b3, // lighter underside
  finColor: 0xff6f2c, // fins / tail
  eyeColor: 0x101018,
}

export class FishMesh {
  options: FishMeshOptions
  group: THREE.Group
  tailPivot: THREE.Group
  finLeft: THREE.Mesh
  finRight: THREE.Mesh
  // Per-signal phase accumulators (see stepPhase). Separate accumulators keep
  // each sine continuous even when wrapped, so no signal snaps on wrap.
  private _phaseTail: number
  private _phaseRoll: number
  private _phaseFin: number
  // Smoothed speed driving frequency/amplitude.
  private _speed: number

  constructor(options: Partial<FishMeshOptions> = {}) {
    const opts = { ...DEFAULTS, ...options }
    this.options = opts

    const group = new THREE.Group()
    group.name = 'fish'

    const bodyMat = new THREE.MeshStandardMaterial({
      color: opts.color,
      roughness: 0.55,
      metalness: 0.05,
      flatShading: false,
    })
    const finMat = new THREE.MeshStandardMaterial({
      color: opts.finColor,
      roughness: 0.6,
      metalness: 0.0,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
    })
    const eyeMat = new THREE.MeshStandardMaterial({
      color: opts.eyeColor,
      roughness: 0.2,
      metalness: 0.1,
    })
    const eyeWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
    })

    // --- Body: a sphere scaled into an ellipsoid, tapering handled by scale.
    const bodyGeo = new THREE.SphereGeometry(1, 20, 16)
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.scale.set(2.0, 0.95, 0.85) // long along local +X (nose direction)
    body.castShadow = true
    group.add(body)

    // Belly accent — a slightly smaller lighter ellipsoid tucked under.
    const bellyMat = new THREE.MeshStandardMaterial({
      color: opts.bellyColor,
      roughness: 0.6,
    })
    const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), bellyMat)
    belly.scale.set(1.8, 0.55, 0.7)
    belly.position.set(0, -0.35, 0)
    group.add(belly)

    // --- Tail: a flattened cone at the back that we wag.
    const tailPivot = new THREE.Group()
    tailPivot.position.set(-2.0, 0, 0)
    const tailGeo = new THREE.ConeGeometry(0.9, 1.6, 4)
    const tail = new THREE.Mesh(tailGeo, finMat)
    tail.rotation.z = Math.PI / 2 // point cone tip backward (-X)
    tail.position.set(-0.7, 0, 0)
    tail.scale.set(1, 1.4, 0.18) // flatten into a fin
    tailPivot.add(tail)
    group.add(tailPivot)
    this.tailPivot = tailPivot

    // --- Dorsal fin on top.
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 3), finMat)
    dorsal.position.set(0.1, 0.85, 0)
    dorsal.scale.set(1.6, 1, 0.15)
    dorsal.rotation.z = -0.3
    group.add(dorsal)

    // --- Side (pectoral) fins.
    const sideFinGeo = new THREE.ConeGeometry(0.4, 0.9, 3)
    const finLeft = new THREE.Mesh(sideFinGeo, finMat)
    finLeft.position.set(0.5, -0.2, 0.6)
    finLeft.scale.set(1, 1, 0.12)
    finLeft.rotation.set(0.4, 0, -0.9)
    group.add(finLeft)
    this.finLeft = finLeft

    const finRight = new THREE.Mesh(sideFinGeo, finMat)
    finRight.position.set(0.5, -0.2, -0.6)
    finRight.scale.set(1, 1, 0.12)
    finRight.rotation.set(-0.4, 0, -0.9)
    group.add(finRight)
    this.finRight = finRight

    // --- Eyes near the nose.
    const eyeGeo = new THREE.SphereGeometry(0.22, 12, 12)
    const pupilGeo = new THREE.SphereGeometry(0.12, 10, 10)
    for (const side of [1, -1]) {
      const white = new THREE.Mesh(eyeGeo, eyeWhiteMat)
      white.position.set(1.45, 0.25, side * 0.55)
      group.add(white)
      const pupil = new THREE.Mesh(pupilGeo, eyeMat)
      pupil.position.set(1.58, 0.27, side * 0.6)
      group.add(pupil)
    }

    group.scale.setScalar(opts.size)
    this.group = group
    this._phaseTail = 0
    this._phaseRoll = 0
    this._phaseFin = 0
    this._speed = 0
  }

  /**
   * Animate swim motion.
   */
  update(dt: number, speed = 1): void {
    // Smooth the speed so amplitude/frequency don't stutter frame-to-frame
    // (AI mode changes jump the raw speed between cruise/chase/burst).
    this._speed = approach(this._speed, speed, SWIM.speedLambda, dt)
    const s = this._speed

    const intensity = Math.min(SWIM.intensityMax, SWIM.intensityBase + s * SWIM.intensityPerSpeed)
    const wagFreq = SWIM.wagFreqBase + s * SWIM.wagFreqPerSpeed

    // Integrate each phase so a changing frequency never makes the phase jump.
    this._phaseTail = stepPhase(this._phaseTail, wagFreq, dt)
    this._phaseRoll = stepPhase(this._phaseRoll, wagFreq * SWIM.rollFreqRatio, dt)
    this._phaseFin = stepPhase(this._phaseFin, wagFreq * SWIM.flutterFreqRatio, dt)

    // Tail wag about Y.
    this.tailPivot.rotation.y = Math.sin(this._phaseTail) * SWIM.tailAmplitude * intensity

    // Gentle body roll about X (the swim direction), out of phase.
    this.group.rotation.x = Math.sin(this._phaseRoll) * SWIM.rollAmplitude * intensity

    // Pectoral fins flutter.
    const flutter = Math.sin(this._phaseFin) * SWIM.flutterAmplitude
    this.finLeft.rotation.x = 0.4 + flutter
    this.finRight.rotation.x = -0.4 - flutter
  }

  /**
   * Rescale the whole fish. Used when a fish grows after eating.
   */
  setSize(size: number): void {
    this.options.size = size
    this.group.scale.setScalar(size)
  }

  /** Free GPU resources. */
  dispose(): void {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        mats.forEach((m) => m.dispose())
      }
    })
  }
}

export default FishMesh
