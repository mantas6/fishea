import * as THREE from 'three'
import { WORLD } from './movement.js'

// Deep-blue underwater palette shared by fog + background.
export const WATER_COLOR = 0x0a3a5c
export const DEEP_COLOR = 0x04122b

/**
 * Small deterministic value-noise so the seafloor looks the same each load
 * and does not depend on Math.random ordering.
 */
function hashNoise(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Builds the entire static underwater environment and returns an object with
 * the root group plus an update(dt) for animated bits (swaying seaweed).
 * @param {THREE.Scene} scene
 * @returns {{ root: THREE.Group, update: (dt:number)=>void, dispose: ()=>void }}
 */
export function createWorld(scene) {
  const root = new THREE.Group()
  root.name = 'world'

  // --- Atmosphere: fog + background give the "inside a water volume" feel.
  scene.background = new THREE.Color(DEEP_COLOR)
  scene.fog = new THREE.FogExp2(WATER_COLOR, 0.012)

  // --- Lighting: ambient fill + a blue-green "sun through water" directional.
  const ambient = new THREE.AmbientLight(0x88bfe0, 0.75)
  root.add(ambient)

  const sun = new THREE.DirectionalLight(0xbfefff, 1.1)
  sun.position.set(30, 80, 20)
  sun.castShadow = false
  root.add(sun)

  // A subtle upward hemisphere gives a soft blue-green tint from below.
  const hemi = new THREE.HemisphereLight(0x2f7fb0, 0x0a2033, 0.6)
  root.add(hemi)

  // --- Seafloor: large plane with vertex-noise displacement.
  const floorSize = 400
  const floorSegs = 128
  const floorGeo = new THREE.PlaneGeometry(floorSize, floorSize, floorSegs, floorSegs)
  floorGeo.rotateX(-Math.PI / 2) // lay flat
  const pos = floorGeo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    // Layered noise for gentle dunes + fine grain.
    const dune = Math.sin(x * 0.03) * Math.cos(z * 0.025) * 2.2
    const grain = (hashNoise(x, z) - 0.5) * 0.8
    pos.setY(i, WORLD.seafloorY + dune + grain)
  }
  floorGeo.computeVertexNormals()
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xd8c79a,
    roughness: 1,
    metalness: 0,
    flatShading: false,
  })
  const floor = new THREE.Mesh(floorGeo, floorMat)
  floor.receiveShadow = true
  root.add(floor)

  // --- Water surface plane above, semi-transparent, seen from below.
  const surfaceGeo = new THREE.PlaneGeometry(floorSize, floorSize, 32, 32)
  surfaceGeo.rotateX(Math.PI / 2) // face downward
  const surfaceMat = new THREE.MeshStandardMaterial({
    color: 0x3fa9d8,
    transparent: true,
    opacity: 0.25,
    roughness: 0.2,
    metalness: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const surface = new THREE.Mesh(surfaceGeo, surfaceMat)
  surface.position.y = WORLD.surfaceY
  root.add(surface)
  // store the base positions to ripple the surface slightly
  const surfacePos = surfaceGeo.attributes.position
  const surfaceBaseY = new Float32Array(surfacePos.count)
  for (let i = 0; i < surfacePos.count; i++) surfaceBaseY[i] = surfacePos.getY(i)

  // --- Decorations: rocks, seaweed, coral. Deterministic scatter.
  const seaweed = [] // { pivot, phase, freq }
  const rng = mulberry32(1337)

  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x6b6f78,
    roughness: 0.95,
    metalness: 0.02,
    flatShading: true,
  })

  const placeCount = { rocks: 40, weedClumps: 30, coral: 18 }

  // Rocks: deformed icos/dodecahedrons.
  for (let i = 0; i < placeCount.rocks; i++) {
    const r = 1 + rng() * 3
    const geo =
      rng() > 0.5
        ? new THREE.IcosahedronGeometry(r, 0)
        : new THREE.DodecahedronGeometry(r, 0)
    deform(geo, 0.35, rng)
    geo.computeVertexNormals()
    const rock = new THREE.Mesh(geo, rockMat)
    const [px, pz] = scatter(rng, WORLD.radius * 0.95)
    rock.position.set(px, WORLD.seafloorY + r * 0.4, pz)
    rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI)
    root.add(rock)
  }

  // Seaweed clumps: thin tapered cylinders that sway.
  for (let i = 0; i < placeCount.weedClumps; i++) {
    const [px, pz] = scatter(rng, WORLD.radius * 0.9)
    const clump = new THREE.Group()
    clump.position.set(px, WORLD.seafloorY, pz)
    const blades = 3 + Math.floor(rng() * 4)
    for (let b = 0; b < blades; b++) {
      const h = 4 + rng() * 8
      const geo = new THREE.CylinderGeometry(0.06, 0.22, h, 5, 1)
      geo.translate(0, h / 2, 0) // root at origin so it sways from the base
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.33 + rng() * 0.08, 0.6, 0.28 + rng() * 0.1),
        roughness: 0.8,
        side: THREE.DoubleSide,
      })
      const pivot = new THREE.Group()
      const blade = new THREE.Mesh(geo, mat)
      pivot.add(blade)
      pivot.position.set((rng() - 0.5) * 1.5, 0, (rng() - 0.5) * 1.5)
      pivot.rotation.z = (rng() - 0.5) * 0.2
      clump.add(pivot)
      seaweed.push({ pivot, phase: rng() * Math.PI * 2, freq: 0.6 + rng() * 0.5, base: pivot.rotation.z })
    }
    root.add(clump)
  }

  // Coral-ish shapes: clustered colorful cones/torus knots.
  for (let i = 0; i < placeCount.coral; i++) {
    const [px, pz] = scatter(rng, WORLD.radius * 0.9)
    const coral = new THREE.Group()
    coral.position.set(px, WORLD.seafloorY, pz)
    const hue = rng()
    const coralMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(
        hue < 0.5 ? 0.02 + hue * 0.1 : 0.75 + hue * 0.15,
        0.7,
        0.55,
      ),
      roughness: 0.7,
    })
    const branches = 3 + Math.floor(rng() * 4)
    for (let b = 0; b < branches; b++) {
      const h = 1.5 + rng() * 3
      const geo = new THREE.ConeGeometry(0.3 + rng() * 0.3, h, 6)
      geo.translate(0, h / 2, 0)
      const branch = new THREE.Mesh(geo, coralMat)
      branch.position.set((rng() - 0.5) * 1.2, 0, (rng() - 0.5) * 1.2)
      branch.rotation.set((rng() - 0.5) * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.5)
      coral.add(branch)
    }
    root.add(coral)
  }

  scene.add(root)

  let t = 0
  function update(dt) {
    t += dt
    // Sway seaweed with a simple sine on rotation.
    for (const w of seaweed) {
      w.pivot.rotation.z = w.base + Math.sin(t * w.freq + w.phase) * 0.35
      w.pivot.rotation.x = Math.cos(t * w.freq * 0.8 + w.phase) * 0.2
    }
    // Gentle ripple on the water surface.
    for (let i = 0; i < surfacePos.count; i++) {
      const x = surfacePos.getX(i)
      const z = surfacePos.getZ(i)
      surfacePos.setY(i, surfaceBaseY[i] + Math.sin(t * 0.8 + x * 0.05 + z * 0.05) * 0.6)
    }
    surfacePos.needsUpdate = true
  }

  function dispose() {
    root.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        mats.forEach((m) => m.dispose())
      }
    })
    scene.remove(root)
    scene.fog = null
  }

  return { root, update, dispose }
}

// --- helpers -------------------------------------------------------------

/** Seeded PRNG so scatter is deterministic across reloads. */
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Random point on the seafloor within a radius (avoids the very center). */
function scatter(rng, radius) {
  const ang = rng() * Math.PI * 2
  const r = 15 + rng() * (radius - 15)
  return [Math.cos(ang) * r, Math.sin(ang) * r]
}

/** Randomly push vertices outward/inward to give an organic silhouette. */
function deform(geo, amount, rng) {
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const f = 1 + (rng() - 0.5) * amount
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f)
  }
}
