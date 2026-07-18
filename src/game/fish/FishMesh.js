import * as THREE from 'three'

// Procedural fish built entirely from primitives so it needs no external assets.
// Returned as a class wrapping a THREE.Group; call update(dt, speed) each frame.
// Reusable/parameterizable so AI fish can share the exact same builder later.

const DEFAULTS = {
  size: 1, // overall scale multiplier
  color: 0xff8c42, // body color
  bellyColor: 0xffe0b3, // lighter underside
  finColor: 0xff6f2c, // fins / tail
  eyeColor: 0x101018,
}

export class FishMesh {
  /**
   * @param {Partial<typeof DEFAULTS>} [options]
   */
  constructor(options = {}) {
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
    this._t = 0
  }

  /**
   * Animate swim motion.
   * @param {number} dt seconds
   * @param {number} [speed] current speed (units/s); scales the wag intensity.
   */
  update(dt, speed = 1) {
    this._t += dt
    const intensity = Math.min(1.2, 0.35 + speed * 0.12)
    const wagFreq = 6 + speed * 1.5

    // Tail wag about Y.
    this.tailPivot.rotation.y = Math.sin(this._t * wagFreq) * 0.6 * intensity

    // Gentle body roll about X (the swim direction), out of phase.
    this.group.rotation.x = Math.sin(this._t * wagFreq * 0.5) * 0.06 * intensity

    // Pectoral fins flutter.
    const flutter = Math.sin(this._t * wagFreq * 1.3) * 0.25
    this.finLeft.rotation.x = 0.4 + flutter
    this.finRight.rotation.x = -0.4 - flutter
  }

  /** Free GPU resources. */
  dispose() {
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        mats.forEach((m) => m.dispose())
      }
    })
  }
}

export default FishMesh
