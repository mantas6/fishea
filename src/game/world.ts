import * as THREE from 'three'
import { WORLD } from './movement.js'

// Deep-blue underwater palette shared by fog + background.
export const WATER_COLOR = 0x0a3a5c
export const DEEP_COLOR = 0x04122b

/** The built world: a root group plus a per-frame update and teardown. */
export interface World {
  root: THREE.Group
  update: (dt: number) => void
  dispose: () => void
}

/** A single swaying plant pivot (seaweed / kelp) with its animation params. */
interface Sway {
  pivot: THREE.Group
  phase: number
  freq: number
  base: number
  /** Peak z-rotation (radians) of the sway; x uses a fraction of this. */
  amp: number
}

/** A swaying anemone crown (tentacles that lean and gently pulse). */
interface Anemone {
  crown: THREE.Group
  phase: number
  freq: number
  baseScaleY: number
}

/** A background school of tiny instanced fish circling a fixed point. */
interface School {
  mesh: THREE.InstancedMesh
  center: THREE.Vector3
  radius: number
  angularSpeed: number
  ySpan: number
  count: number
}

/**
 * Small deterministic value-noise so the seafloor looks the same each load
 * and does not depend on Math.random ordering.
 */
function hashNoise(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Builds the entire static underwater environment and returns an object with
 * the root group plus an update(dt) for animated bits (swaying seaweed).
 */
export function createWorld(scene: THREE.Scene): World {
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
    // Smooth dune surface (shared with decoration placement) + fine grain.
    const grain = (hashNoise(x, z) - 0.5) * 0.8
    pos.setY(i, seafloorHeight(x, z) + grain)
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

  // --- Decorations: rocks, seaweed, coral + a "lived-in" second pass of
  // clustered pebbles, shells, starfish, kelp forests, anemones and distant
  // fish schools. Everything is placed from one seeded PRNG so the reef looks
  // identical on every load, and high-count props are instanced.
  const sways: Sway[] = []
  const anemones: Anemone[] = []
  const schools: School[] = []
  const rng = mulberry32(1337)

  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x6b6f78,
    roughness: 0.95,
    metalness: 0.02,
    flatShading: true,
  })

  const placeCount = { rocks: 40, weedClumps: 30, coral: 18 }

  // Rocks: deformed icos/dodecahedrons, gathered into a handful of outcrops so
  // the floor reads as boulder fields rather than an even sprinkle.
  const rockSpots = clusteredScatter(rng, placeCount.rocks, {
    radius: WORLD.radius * 0.95,
    inner: 15,
    clusters: 6,
    spread: 22,
    clusterFraction: 0.75,
  })
  for (let i = 0; i < placeCount.rocks; i++) {
    const r = 1 + rng() * 3
    const geo =
      rng() > 0.5
        ? new THREE.IcosahedronGeometry(r, 0)
        : new THREE.DodecahedronGeometry(r, 0)
    deform(geo, 0.35, rng)
    geo.computeVertexNormals()
    const rock = new THREE.Mesh(geo, rockMat)
    const { x: px, z: pz } = rockSpots[i]
    rock.position.set(px, seafloorHeight(px, pz) + r * 0.4, pz)
    rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI)
    root.add(rock)
  }

  // Seaweed clumps: thin tapered cylinders that sway.
  const weedSpots = clusteredScatter(rng, placeCount.weedClumps, {
    radius: WORLD.radius * 0.9,
    inner: 15,
    clusters: 7,
    spread: 20,
    clusterFraction: 0.7,
  })
  for (let i = 0; i < placeCount.weedClumps; i++) {
    const { x: px, z: pz } = weedSpots[i]
    const clump = new THREE.Group()
    clump.position.set(px, seafloorHeight(px, pz), pz)
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
      sways.push({
        pivot,
        phase: rng() * Math.PI * 2,
        freq: 0.6 + rng() * 0.5,
        base: pivot.rotation.z,
        amp: 0.35,
      })
    }
    root.add(clump)
  }

  // Coral-ish shapes: clustered colorful cones/torus knots.
  const coralSpots = clusteredScatter(rng, placeCount.coral, {
    radius: WORLD.radius * 0.9,
    inner: 15,
    clusters: 5,
    spread: 16,
    clusterFraction: 0.8,
  })
  for (let i = 0; i < placeCount.coral; i++) {
    const { x: px, z: pz } = coralSpots[i]
    const coral = new THREE.Group()
    coral.position.set(px, seafloorHeight(px, pz), pz)
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

  // --- Extra "lived-in" detail (all deterministic, shared-material/instanced).
  addPebbles(root, rng)
  addShells(root, rng)
  addStarfish(root, rng)
  addKelpForests(root, rng, sways)
  addAnemones(root, rng, anemones)
  addFishSchools(root, rng, schools)

  scene.add(root)

  const schoolDummy = new THREE.Object3D()
  const schoolAhead = new THREE.Vector3()

  let t = 0
  function update(dt: number): void {
    t += dt
    // Sway plants (seaweed + kelp) with a simple sine on rotation.
    for (const w of sways) {
      w.pivot.rotation.z = w.base + Math.sin(t * w.freq + w.phase) * w.amp
      w.pivot.rotation.x = Math.cos(t * w.freq * 0.8 + w.phase) * w.amp * 0.57
    }
    // Anemones lean their tentacle crown and gently pulse in height.
    for (const a of anemones) {
      const s = Math.sin(t * a.freq + a.phase)
      a.crown.rotation.z = s * 0.14
      a.crown.rotation.x = Math.cos(t * a.freq * 0.9 + a.phase) * 0.1
      a.crown.scale.y = a.baseScaleY * (1 + 0.08 * s)
    }
    // Distant fish schools: circle their center, nose pointed along travel.
    for (const sc of schools) {
      for (let i = 0; i < sc.count; i++) {
        const p = schoolMemberPosition(sc.center, sc.radius, sc.ySpan, t, sc.angularSpeed, i, sc.count)
        const ahead = schoolMemberPosition(
          sc.center, sc.radius, sc.ySpan, t + 0.1, sc.angularSpeed, i, sc.count,
        )
        schoolDummy.position.set(p.x, p.y, p.z)
        schoolAhead.set(ahead.x, ahead.y, ahead.z)
        schoolDummy.lookAt(schoolAhead)
        schoolDummy.updateMatrix()
        sc.mesh.setMatrixAt(i, schoolDummy.matrix)
      }
      sc.mesh.instanceMatrix.needsUpdate = true
    }
    // Gentle ripple on the water surface.
    for (let i = 0; i < surfacePos.count; i++) {
      const x = surfacePos.getX(i)
      const z = surfacePos.getZ(i)
      surfacePos.setY(i, surfaceBaseY[i] + Math.sin(t * 0.8 + x * 0.05 + z * 0.05) * 0.6)
    }
    surfacePos.needsUpdate = true
  }

  function dispose(): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
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
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Randomly push vertices outward/inward to give an organic silhouette. */
function deform(geo: THREE.BufferGeometry, amount: number, rng: () => number): void {
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const f = 1 + (rng() - 0.5) * amount
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f)
  }
}

// --- Pure placement helpers (unit tested) --------------------------------

/** A point on the seafloor plane. */
export interface Point2 {
  x: number
  z: number
}

/**
 * Height of the smooth dune surface at (x, z). Shared by the floor mesh and
 * every decoration so props sit ON the undulating sand rather than a flat
 * plane. Deliberately excludes the per-vertex "grain" so it stays continuous.
 * Pure.
 */
export function seafloorHeight(x: number, z: number): number {
  return WORLD.seafloorY + Math.sin(x * 0.03) * Math.cos(z * 0.025) * 2.2
}

/** A uniform random point in the annulus [inner, outer] around the origin. Pure given rng. */
export function randomAnnulusPoint(rng: () => number, inner: number, outer: number): Point2 {
  const ang = rng() * Math.PI * 2
  // sqrt keeps the areal density uniform across the annulus.
  const lo = inner * inner
  const hi = outer * outer
  const r = Math.sqrt(lo + rng() * (hi - lo))
  return { x: Math.cos(ang) * r, z: Math.sin(ang) * r }
}

/** Tuning for {@link clusteredScatter}. */
export interface ClusterOptions {
  /** Outer radius; every returned point is within this of the origin. */
  radius: number
  /** Keep points at least this far from the origin (open water in the middle). */
  inner: number
  /** Number of dense hotspots to seed. */
  clusters: number
  /** Rough radius of each hotspot. */
  spread: number
  /** Fraction (0..1) of points drawn into a hotspot vs scattered uniformly. */
  clusterFraction: number
}

/**
 * Deterministically scatter `count` points across the seafloor so a few areas
 * read as dense gardens and the rest as open sand, instead of an even sprinkle.
 * Every point is clamped within `radius`. Pure given the rng.
 */
export function clusteredScatter(rng: () => number, count: number, opts: ClusterOptions): Point2[] {
  const { radius, inner, clusters, spread, clusterFraction } = opts
  const centers: Point2[] = []
  for (let i = 0; i < Math.max(0, clusters); i++) {
    centers.push(randomAnnulusPoint(rng, inner, radius))
  }
  const pts: Point2[] = []
  for (let i = 0; i < count; i++) {
    if (centers.length > 0 && rng() < clusterFraction) {
      const c = centers[Math.floor(rng() * centers.length)]
      const ang = rng() * Math.PI * 2
      // Triangular falloff (two uniforms) so points bunch toward the center.
      const r = (rng() + rng()) * 0.5 * spread
      pts.push(clampRadius(c.x + Math.cos(ang) * r, c.z + Math.sin(ang) * r, radius))
    } else {
      pts.push(randomAnnulusPoint(rng, inner, radius))
    }
  }
  return pts
}

/** Clamp an (x, z) point so its distance from the origin is at most `max`. Pure. */
export function clampRadius(x: number, z: number, max: number): Point2 {
  const d = Math.hypot(x, z)
  if (d > max && d > 0) {
    const s = max / d
    return { x: x * s, z: z * s }
  }
  return { x, z }
}

/** A point in 3D space (returned by {@link schoolMemberPosition}). */
export interface Point3 {
  x: number
  y: number
  z: number
}

/**
 * Position of school member `index` (of `count`) at time `t`: members ride a
 * shared ring around `center`, evenly phase-offset, with a per-member radius
 * and vertical bob so the school looks loose rather than a rigid circle. Pure.
 */
export function schoolMemberPosition(
  center: Point3,
  radius: number,
  ySpan: number,
  t: number,
  angularSpeed: number,
  index: number,
  count: number,
): Point3 {
  const seat = count > 0 ? (index / count) * Math.PI * 2 : 0
  const ang = seat + t * angularSpeed
  const r = radius * (0.75 + 0.25 * Math.sin(seat * 3))
  return {
    x: center.x + Math.cos(ang) * r,
    y: center.y + Math.sin(t * 0.6 + seat * 5) * ySpan,
    z: center.z + Math.sin(ang) * r,
  }
}

// --- Decoration builders --------------------------------------------------
// Each adds a batch of props to `root`. High-count props share one geometry +
// material via InstancedMesh so the whole reef costs only a few draw calls.

/** Compose a transform matrix into an InstancedMesh via a scratch Object3D. */
function setInstance(
  mesh: THREE.InstancedMesh,
  i: number,
  dummy: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
  s: number,
): void {
  dummy.position.set(x, y, z)
  dummy.rotation.set(rx, ry, rz)
  dummy.scale.setScalar(s)
  dummy.updateMatrix()
  mesh.setMatrixAt(i, dummy.matrix)
}

/** Scattered small pebbles/cobbles gathered around the boulder outcrops. */
function addPebbles(root: THREE.Group, rng: () => number): void {
  const count = 260
  const geo = new THREE.IcosahedronGeometry(1, 0)
  deform(geo, 0.5, rng)
  geo.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({
    color: 0x7d7a72,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  mesh.name = 'pebbles'
  const dummy = new THREE.Object3D()
  const spots = clusteredScatter(rng, count, {
    radius: WORLD.radius * 0.97,
    inner: 12,
    clusters: 9,
    spread: 26,
    clusterFraction: 0.85,
  })
  for (let i = 0; i < count; i++) {
    const { x, z } = spots[i]
    const s = 0.2 + rng() * 0.6
    setInstance(
      mesh, i, dummy, x, seafloorHeight(x, z) + s * 0.3, z,
      rng() * Math.PI, rng() * Math.PI, rng() * Math.PI, s,
    )
  }
  mesh.instanceMatrix.needsUpdate = true
  root.add(mesh)
}

/** Small clam-like shells lying on the sand, clustered near reef areas. */
function addShells(root: THREE.Group, rng: () => number): void {
  const count = 90
  // A low, ribbed dome reads as a little shell when lying on its flat side.
  const geo = new THREE.SphereGeometry(0.5, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2)
  geo.scale(1, 0.5, 1.2)
  geo.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe9dcc4,
    roughness: 0.75,
    metalness: 0.05,
    flatShading: true,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  mesh.name = 'shells'
  const dummy = new THREE.Object3D()
  const spots = clusteredScatter(rng, count, {
    radius: WORLD.radius * 0.9,
    inner: 14,
    clusters: 8,
    spread: 22,
    clusterFraction: 0.8,
  })
  for (let i = 0; i < count; i++) {
    const { x, z } = spots[i]
    const s = 0.6 + rng() * 0.8
    // Tip it slightly off flat so shells don't look decal-stamped.
    setInstance(
      mesh, i, dummy, x, seafloorHeight(x, z) + 0.05, z,
      (rng() - 0.5) * 0.4, rng() * Math.PI * 2, (rng() - 0.5) * 0.4, s,
    )
  }
  mesh.instanceMatrix.needsUpdate = true
  root.add(mesh)
}

/** Flat five-armed starfish resting on the floor; sparse and colourful. */
function addStarfish(root: THREE.Group, rng: () => number): void {
  const count = 22
  const geo = makeStarGeometry(5, 0.5, 0.22)
  geo.rotateX(-Math.PI / 2) // lay flat on the seafloor
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe0714a,
    roughness: 0.85,
    metalness: 0,
    flatShading: true,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  mesh.name = 'starfish'
  const dummy = new THREE.Object3D()
  const spots = clusteredScatter(rng, count, {
    radius: WORLD.radius * 0.9,
    inner: 16,
    clusters: 6,
    spread: 24,
    clusterFraction: 0.5,
  })
  for (let i = 0; i < count; i++) {
    const { x, z } = spots[i]
    const s = 0.8 + rng() * 1.1
    setInstance(mesh, i, dummy, x, seafloorHeight(x, z) + 0.08, z, 0, rng() * Math.PI * 2, 0, s)
  }
  mesh.instanceMatrix.needsUpdate = true
  root.add(mesh)
}

/**
 * A few dense kelp "forests": tall thin strands that sway from the base. They
 * share a small palette of materials and register in the world's sway list.
 */
function addKelpForests(root: THREE.Group, rng: () => number, sways: Sway[]): void {
  const forests = 5
  const kelpMats = [0.34, 0.36, 0.3].map(
    (h) =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(h, 0.55, 0.22 + h * 0.2),
        roughness: 0.85,
        side: THREE.DoubleSide,
      }),
  )
  const centers = clusteredScatter(rng, forests, {
    radius: WORLD.radius * 0.85,
    inner: 25,
    clusters: forests,
    spread: 0,
    clusterFraction: 0,
  })
  for (let f = 0; f < forests; f++) {
    const c = centers[f]
    const strands = 10 + Math.floor(rng() * 10)
    for (let s = 0; s < strands; s++) {
      const ang = rng() * Math.PI * 2
      const rad = Math.sqrt(rng()) * (7 + rng() * 6)
      const px = c.x + Math.cos(ang) * rad
      const pz = c.z + Math.sin(ang) * rad
      const h = 12 + rng() * 12
      const geo = new THREE.CylinderGeometry(0.05, 0.28, h, 5, 3)
      geo.translate(0, h / 2, 0)
      const pivot = new THREE.Group()
      pivot.position.set(px, seafloorHeight(px, pz), pz)
      pivot.rotation.z = (rng() - 0.5) * 0.15
      const blade = new THREE.Mesh(geo, kelpMats[Math.floor(rng() * kelpMats.length)])
      pivot.add(blade)
      root.add(pivot)
      sways.push({
        pivot,
        phase: rng() * Math.PI * 2,
        freq: 0.35 + rng() * 0.35,
        base: pivot.rotation.z,
        amp: 0.5 + rng() * 0.25,
      })
    }
  }
}

/** Sea anemones: a squat base ringed by tentacle cones that lean and pulse. */
function addAnemones(root: THREE.Group, rng: () => number, anemones: Anemone[]): void {
  const count = 14
  const spots = clusteredScatter(rng, count, {
    radius: WORLD.radius * 0.85,
    inner: 18,
    clusters: 6,
    spread: 20,
    clusterFraction: 0.6,
  })
  for (let i = 0; i < count; i++) {
    const { x, z } = spots[i]
    const hue = rng()
    const baseMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue < 0.5 ? 0.02 : 0.85, 0.5, 0.4),
      roughness: 0.8,
    })
    const tentacleMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue < 0.5 ? 0.06 : 0.78, 0.7, 0.62),
      roughness: 0.6,
    })
    const group = new THREE.Group()
    group.position.set(x, seafloorHeight(x, z), z)

    const bodyR = 0.7 + rng() * 0.6
    const base = new THREE.Mesh(
      new THREE.SphereGeometry(bodyR, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      baseMat,
    )
    base.scale.y = 0.7
    group.add(base)

    const crown = new THREE.Group()
    crown.position.y = bodyR * 0.5
    const tentacles = 9 + Math.floor(rng() * 6)
    for (let tIdx = 0; tIdx < tentacles; tIdx++) {
      const th = 0.8 + rng() * 1.1
      const tGeo = new THREE.ConeGeometry(0.09, th, 5)
      tGeo.translate(0, th / 2, 0)
      const tent = new THREE.Mesh(tGeo, tentacleMat)
      const a = (tIdx / tentacles) * Math.PI * 2
      const rr = bodyR * (0.2 + rng() * 0.5)
      tent.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr)
      tent.rotation.set(Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5)
      crown.add(tent)
    }
    group.add(crown)
    root.add(group)
    anemones.push({
      crown,
      phase: rng() * Math.PI * 2,
      freq: 0.5 + rng() * 0.6,
      baseScaleY: 1,
    })
  }
}

/**
 * A couple of distant fish schools drifting through the background haze. Each
 * school is a single InstancedMesh of tiny elongated diamonds (they read as
 * silhouettes in the fog) animated in the world update.
 */
function addFishSchools(root: THREE.Group, rng: () => number, schools: School[]): void {
  const schoolCount = 3
  const geo = new THREE.OctahedronGeometry(1, 0)
  geo.scale(0.35, 0.28, 1) // elongate along local -Z (nose) after lookAt
  const mat = new THREE.MeshStandardMaterial({
    color: 0x9fc2d4,
    roughness: 0.5,
    metalness: 0.1,
    flatShading: true,
  })
  for (let s = 0; s < schoolCount; s++) {
    const members = 16 + Math.floor(rng() * 10)
    const mesh = new THREE.InstancedMesh(geo, mat, members)
    mesh.name = 'fish-school'
    mesh.frustumCulled = false
    // Seed a plausible starting pose so the first frame isn't at the origin.
    const dummy = new THREE.Object3D()
    for (let i = 0; i < members; i++) {
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    root.add(mesh)

    const ang = rng() * Math.PI * 2
    const dist = WORLD.radius * (0.55 + rng() * 0.35)
    schools.push({
      mesh,
      center: new THREE.Vector3(
        Math.cos(ang) * dist,
        WORLD.seafloorY + 10 + rng() * 18,
        Math.sin(ang) * dist,
      ),
      radius: 6 + rng() * 8,
      angularSpeed: (rng() < 0.5 ? -1 : 1) * (0.15 + rng() * 0.2),
      ySpan: 1.5 + rng() * 2,
      count: members,
    })
  }
}

/**
 * Build a flat N-point starfish in the XY plane (rotated flat by the caller),
 * centred at the origin from an alternating outer/inner ring of vertices. The
 * small extrude depth gives it a hair of thickness so lighting catches the arms.
 */
function makeStarGeometry(points: number, outer: number, inner: number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const n = points * 2
  for (let i = 0; i < n; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.12,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 1,
    steps: 1,
  })
  geo.center()
  geo.computeVertexNormals()
  return geo
}
