import * as THREE from 'three'
import { WORLD, stepPhase } from './movement.js'
import type { Vec3 } from './movement.js'

// Water visual FX: ambient rising bubbles, sprint bubble trails, drifting
// "marine snow" particulate, and soft light shafts from the surface.
//
// All the heavy lifting is done with THREE.Points (one draw call per field)
// and a tiny pool of shared-geometry light-shaft meshes, so the whole system
// stays cheap regardless of how long the game runs. The pure stepping math
// lives at the bottom (wobbleOffset / reachedSurface / wrapCoord / …) and is
// unit-tested without touching WebGL, mirroring movement.ts.

/** The built FX system: a root group plus a per-frame update and teardown. */
export interface WaterFX {
  root: THREE.Group
  update: (dt: number, ctx: WaterFXContext) => void
  dispose: () => void
}

/** A source that puffs out bubble-trail particles while `emitting` is true. */
export interface BubbleEmitter {
  position: Vec3
  emitting: boolean
  /** Bubbles per second while emitting (defaults to FX.trailRate). */
  rate?: number
}

/** Per-frame context handed to WaterFX.update. */
export interface WaterFXContext {
  /** The point the volumetric fields (bubbles / snow / rays) recenter around. */
  center: Vec3
  /** Optional bubble-trail sources (e.g. the player while sprinting). */
  emitters?: BubbleEmitter[]
}

// --- Tuning ---------------------------------------------------------------
// Counts are hard caps: fields are pre-allocated and recycled, never grown.
export const FX = {
  // Ambient bubbles perpetually rising through the water column.
  ambientBubbleCount: 220,
  ambientRadius: 90, // XZ radius around the center they populate
  ambientRiseMin: 2.4,
  ambientRiseMax: 6.0,
  ambientSize: 1.3,

  // Sprint bubble trails.
  trailBubbleCount: 180,
  trailRate: 30, // bubbles/sec while an emitter is active
  trailSize: 0.75,
  trailSpread: 0.5, // random XZ jitter at the emit point
  trailRiseMin: 3.5,
  trailRiseMax: 6.5,
  trailTtlMin: 1.2,
  trailTtlMax: 2.6,

  // Drifting marine snow.
  snowCount: 420,
  snowSize: 0.42,
  snowBox: 75, // half-extent of the cube (around center) it wraps within
  snowDrift: 0.7, // downward drift (units/s)
  snowSway: 0.35, // horizontal sway amplitude scale

  // Light shafts from the surface.
  rayCount: 7,
  rayRadius: 70,
  raySpanTop: 4, // how far below the surface a shaft starts
} as const

// Wobble tuning shared by both bubble fields.
const WOBBLE_FREQ_MIN = 1.4
const WOBBLE_FREQ_MAX = 3.2
const WOBBLE_AMP_MIN = 0.12
const WOBBLE_AMP_MAX = 0.4
const SURFACE_POP_MARGIN = 1.0 // pop this far below the surface

// Where parked (inactive) particles are hidden: far below the seafloor so the
// exponential fog swallows them completely and they never render visibly.
const PARK_Y = WORLD.seafloorY - 10000

/**
 * Build the water FX system and add it to the scene. Returns a root group plus
 * update(dt, ctx) / dispose(), mirroring the World contract in world.ts.
 */
export function createWaterFX(scene: THREE.Scene): WaterFX {
  const root = new THREE.Group()
  root.name = 'water-fx'

  const rng = mulberry32(0xb0bb1e)

  // Shared sprite textures (one each, reused across every particle).
  const bubbleTex = makeBubbleTexture()
  const dotTex = makeDotTexture()
  const shaftTex = makeShaftTexture()

  const ambient = new BubbleField({
    count: FX.ambientBubbleCount,
    texture: bubbleTex,
    size: FX.ambientSize,
    color: 0xbfefff,
    opacity: 0.5,
    ambient: true,
    rng,
  })
  root.add(ambient.points)

  const trail = new BubbleField({
    count: FX.trailBubbleCount,
    texture: bubbleTex,
    size: FX.trailSize,
    color: 0xdff6ff,
    opacity: 0.7,
    ambient: false,
    rng,
  })
  root.add(trail.points)

  const snow = new MarineSnow(FX.snowCount, dotTex, rng)
  root.add(snow.points)

  const rays = new LightShafts(FX.rayCount, shaftTex, rng)
  root.add(rays.group)

  // Per-emitter fractional bubble accumulators (persist across frames).
  const emitAccum: number[] = []

  function update(dt: number, ctx: WaterFXContext): void {
    const c = ctx.center

    // Spawn trail bubbles for each active emitter using a fractional rate so
    // emission is frame-rate independent.
    const emitters = ctx.emitters ?? []
    for (let e = 0; e < emitters.length; e++) {
      const em = emitters[e]
      const rate = em.rate ?? FX.trailRate
      const prev = emitAccum[e] ?? 0
      if (!em.emitting) {
        emitAccum[e] = 0
        continue
      }
      const { count, accumulator } = drainEmission(prev, rate, dt)
      emitAccum[e] = accumulator
      for (let i = 0; i < count; i++) trail.emit(em.position)
    }

    ambient.update(dt, c.x, c.z)
    trail.update(dt, c.x, c.z)
    snow.update(dt, c.x, c.y, c.z)
    rays.update(dt, c.x, c.z)
  }

  function dispose(): void {
    ambient.dispose()
    trail.dispose()
    snow.dispose()
    rays.dispose()
    bubbleTex.dispose()
    dotTex.dispose()
    shaftTex.dispose()
    if (root.parent) root.parent.remove(root)
    scene.remove(root)
  }

  scene.add(root)
  return { root, update, dispose }
}

// --- Bubble field ---------------------------------------------------------

interface BubbleFieldOptions {
  count: number
  texture: THREE.Texture
  size: number
  color: number
  opacity: number
  /** Ambient fields are always full & recycle at the surface; trails are pooled. */
  ambient: boolean
  rng: () => number
}

/**
 * A THREE.Points field of rising, wobbling bubbles. In `ambient` mode every
 * particle is always alive and respawns near the seafloor when it reaches the
 * surface. In trail mode particles are dormant until emit() activates one from
 * a ring buffer, and they retire on a TTL or at the surface.
 */
class BubbleField {
  points: THREE.Points
  private count: number
  private ambient: boolean
  private rng: () => number
  private posAttr: THREE.BufferAttribute
  private baseX: Float32Array
  private baseZ: Float32Array
  private y: Float32Array
  private vy: Float32Array
  private phase: Float32Array
  private freq: Float32Array
  private amp: Float32Array
  private ttl: Float32Array
  private active: Uint8Array
  private cursor: number

  constructor(opts: BubbleFieldOptions) {
    this.count = opts.count
    this.ambient = opts.ambient
    this.rng = opts.rng
    this.cursor = 0

    const n = this.count
    this.baseX = new Float32Array(n)
    this.baseZ = new Float32Array(n)
    this.y = new Float32Array(n)
    this.vy = new Float32Array(n)
    this.phase = new Float32Array(n)
    this.freq = new Float32Array(n)
    this.amp = new Float32Array(n)
    this.ttl = new Float32Array(n)
    this.active = new Uint8Array(n)

    const positions = new Float32Array(n * 3)
    const geo = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(positions, 3)
    this.posAttr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('position', this.posAttr)

    const mat = new THREE.PointsMaterial({
      color: opts.color,
      map: opts.texture,
      size: opts.size,
      sizeAttenuation: true,
      transparent: true,
      opacity: opts.opacity,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })

    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    this.points.name = opts.ambient ? 'ambient-bubbles' : 'trail-bubbles'

    if (this.ambient) {
      // Fill the column immediately so the field looks established at t=0.
      for (let i = 0; i < n; i++) this.spawnAmbient(i, 0, 0, true)
    } else {
      for (let i = 0; i < n; i++) this.park(i)
    }
    this.posAttr.needsUpdate = true
  }

  /** (Re)seed an ambient bubble around (cx, cz); `initial` scatters it in Y. */
  private spawnAmbient(i: number, cx: number, cz: number, initial: boolean): void {
    const ang = this.rng() * Math.PI * 2
    const r = Math.sqrt(this.rng()) * FX.ambientRadius
    this.baseX[i] = cx + Math.cos(ang) * r
    this.baseZ[i] = cz + Math.sin(ang) * r
    const floor = WORLD.seafloorY + 0.5
    this.y[i] = initial
      ? floor + this.rng() * (WORLD.surfaceY - floor)
      : floor + this.rng() * 3
    this.vy[i] = FX.ambientRiseMin + this.rng() * (FX.ambientRiseMax - FX.ambientRiseMin)
    this.phase[i] = this.rng() * Math.PI * 2
    this.freq[i] = WOBBLE_FREQ_MIN + this.rng() * (WOBBLE_FREQ_MAX - WOBBLE_FREQ_MIN)
    this.amp[i] = WOBBLE_AMP_MIN + this.rng() * (WOBBLE_AMP_MAX - WOBBLE_AMP_MIN)
    this.active[i] = 1
    this.writePos(i)
  }

  /** Activate a trail bubble at `p` (ring-buffered so it never allocates). */
  emit(p: Vec3): void {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % this.count
    this.baseX[i] = p.x + (this.rng() - 0.5) * FX.trailSpread * 2
    this.baseZ[i] = p.z + (this.rng() - 0.5) * FX.trailSpread * 2
    this.y[i] = p.y + (this.rng() - 0.5) * FX.trailSpread
    this.vy[i] = FX.trailRiseMin + this.rng() * (FX.trailRiseMax - FX.trailRiseMin)
    this.phase[i] = this.rng() * Math.PI * 2
    this.freq[i] = WOBBLE_FREQ_MIN + this.rng() * (WOBBLE_FREQ_MAX - WOBBLE_FREQ_MIN)
    this.amp[i] = WOBBLE_AMP_MIN + this.rng() * (WOBBLE_AMP_MAX - WOBBLE_AMP_MIN)
    this.ttl[i] = FX.trailTtlMin + this.rng() * (FX.trailTtlMax - FX.trailTtlMin)
    this.active[i] = 1
    this.writePos(i)
  }

  private park(i: number): void {
    this.active[i] = 0
    const o = i * 3
    const arr = this.posAttr.array as Float32Array
    arr[o] = 0
    arr[o + 1] = PARK_Y
    arr[o + 2] = 0
  }

  /** Push particle i's wobbled world position into the geometry buffer. */
  private writePos(i: number): void {
    const o = i * 3
    const arr = this.posAttr.array as Float32Array
    arr[o] = this.baseX[i] + wobbleOffset(this.phase[i], this.amp[i])
    arr[o + 1] = this.y[i]
    arr[o + 2] = this.baseZ[i] + Math.cos(this.phase[i]) * this.amp[i]
  }

  update(dt: number, cx: number, cz: number): void {
    for (let i = 0; i < this.count; i++) {
      if (!this.ambient && !this.active[i]) continue

      this.phase[i] = stepPhase(this.phase[i], this.freq[i], dt)
      this.y[i] += this.vy[i] * dt

      if (this.ambient) {
        if (reachedSurface(this.y[i], WORLD.surfaceY, SURFACE_POP_MARGIN)) {
          this.spawnAmbient(i, cx, cz, false)
          continue
        }
        this.writePos(i)
      } else {
        this.ttl[i] -= dt
        if (this.ttl[i] <= 0 || reachedSurface(this.y[i], WORLD.surfaceY, SURFACE_POP_MARGIN)) {
          this.park(i)
        } else {
          this.writePos(i)
        }
      }
    }
    this.posAttr.needsUpdate = true
  }

  dispose(): void {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}

// --- Marine snow ----------------------------------------------------------

/**
 * Slow-drifting particulate suspended in the water. Particles are tracked as
 * offsets from the recenter point and wrap within a cube around it, so the
 * effect follows the camera/player without ever moving out of view.
 */
class MarineSnow {
  points: THREE.Points
  private count: number
  private posAttr: THREE.BufferAttribute
  private offX: Float32Array
  private offY: Float32Array
  private offZ: Float32Array
  private vx: Float32Array
  private phase: Float32Array
  private freq: Float32Array

  constructor(count: number, texture: THREE.Texture, rng: () => number) {
    this.count = count
    const n = count
    this.offX = new Float32Array(n)
    this.offY = new Float32Array(n)
    this.offZ = new Float32Array(n)
    this.vx = new Float32Array(n)
    this.phase = new Float32Array(n)
    this.freq = new Float32Array(n)

    const box = FX.snowBox
    for (let i = 0; i < n; i++) {
      this.offX[i] = (rng() - 0.5) * box * 2
      this.offY[i] = (rng() - 0.5) * box * 2
      this.offZ[i] = (rng() - 0.5) * box * 2
      this.vx[i] = (rng() - 0.5) * FX.snowSway
      this.phase[i] = rng() * Math.PI * 2
      this.freq[i] = 0.3 + rng() * 0.6
    }

    const positions = new Float32Array(n * 3)
    const geo = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(positions, 3)
    this.posAttr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('position', this.posAttr)

    const mat = new THREE.PointsMaterial({
      color: 0xdfeeff,
      map: texture,
      size: FX.snowSize,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    this.points.name = 'marine-snow'
  }

  update(dt: number, cx: number, cy: number, cz: number): void {
    const box = FX.snowBox
    const arr = this.posAttr.array as Float32Array
    for (let i = 0; i < this.count; i++) {
      this.phase[i] = stepPhase(this.phase[i], this.freq[i], dt)
      this.offY[i] -= FX.snowDrift * dt
      this.offX[i] += (this.vx[i] + Math.sin(this.phase[i]) * FX.snowSway * 0.5) * dt

      // Wrap each offset into [-box, box] so the field stays around the center.
      this.offX[i] = wrapCoord(this.offX[i], 0, box)
      this.offY[i] = wrapCoord(this.offY[i], 0, box)
      this.offZ[i] = wrapCoord(this.offZ[i], 0, box)

      const o = i * 3
      arr[o] = cx + this.offX[i]
      arr[o + 1] = cy + this.offY[i]
      arr[o + 2] = cz + this.offZ[i]
    }
    this.posAttr.needsUpdate = true
  }

  dispose(): void {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}

// --- Light shafts ---------------------------------------------------------

interface Shaft {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  baseOpacity: number
  phase: number
  freq: number
}

/**
 * A handful of soft "god ray" shafts hanging from the surface. Each shaft is
 * two crossed additive planes (so it reads from any viewing angle) sharing a
 * single gradient texture and geometry. Opacity gently pulses per shaft.
 */
class LightShafts {
  group: THREE.Group
  private shafts: Shaft[]
  private geo: THREE.PlaneGeometry

  constructor(count: number, texture: THREE.Texture, rng: () => number) {
    this.group = new THREE.Group()
    this.group.name = 'light-shafts'
    this.shafts = []

    const topY = WORLD.surfaceY - FX.raySpanTop
    const bottomY = WORLD.seafloorY + 8
    const height = topY - bottomY
    // A tall thin plane, pivoted so its top edge sits at the surface.
    this.geo = new THREE.PlaneGeometry(1, height)

    for (let i = 0; i < count; i++) {
      const ang = rng() * Math.PI * 2
      const r = Math.sqrt(rng()) * FX.rayRadius
      const x = Math.cos(ang) * r
      const z = Math.sin(ang) * r
      const width = 6 + rng() * 10
      const baseOpacity = 0.05 + rng() * 0.06

      const material = new THREE.MeshBasicMaterial({
        color: 0x9fd8ff,
        map: texture,
        transparent: true,
        opacity: baseOpacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      })

      const shaft = new THREE.Group()
      shaft.position.set(x, (topY + bottomY) / 2, z)
      shaft.rotation.y = rng() * Math.PI

      const planeA = new THREE.Mesh(this.geo, material)
      planeA.scale.x = width
      const planeB = new THREE.Mesh(this.geo, material)
      planeB.scale.x = width
      planeB.rotation.y = Math.PI / 2
      shaft.add(planeA)
      shaft.add(planeB)
      this.group.add(shaft)

      this.shafts.push({
        mesh: shaft as unknown as THREE.Mesh,
        material,
        baseOpacity,
        phase: rng() * Math.PI * 2,
        freq: 0.15 + rng() * 0.25,
      })
    }
  }

  update(dt: number, cx: number, cz: number): void {
    // Follow the center on XZ so the shafts stay near the viewer.
    this.group.position.x = cx
    this.group.position.z = cz
    for (const s of this.shafts) {
      s.phase = stepPhase(s.phase, s.freq, dt)
      // Keep opacity in [0.35, 1] of the base so shafts never fully vanish.
      s.material.opacity = s.baseOpacity * (0.675 + 0.325 * Math.sin(s.phase))
    }
  }

  dispose(): void {
    this.geo.dispose()
    for (const s of this.shafts) s.material.dispose()
  }
}

// --- Procedural sprite textures -------------------------------------------

/** A soft ring/highlight sprite that reads as a little bubble. */
function makeBubbleTexture(): THREE.CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const cx = size / 2
  ctx.clearRect(0, 0, size, size)
  // Faint fill.
  const fill = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx)
  fill.addColorStop(0, 'rgba(255,255,255,0.10)')
  fill.addColorStop(0.6, 'rgba(255,255,255,0.05)')
  fill.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.arc(cx, cx, cx, 0, Math.PI * 2)
  ctx.fill()
  // Bright rim.
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = size * 0.06
  ctx.beginPath()
  ctx.arc(cx, cx, cx * 0.7, 0, Math.PI * 2)
  ctx.stroke()
  // Specular highlight.
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath()
  ctx.arc(cx * 0.72, cx * 0.66, size * 0.09, 0, Math.PI * 2)
  ctx.fill()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** A soft round dot for marine snow. */
function makeDotTexture(): THREE.CanvasTexture {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const cx = size / 2
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.5)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** A vertical gradient (bright at top, fading down) for the light shafts. */
function makeShaftTexture(): THREE.CanvasTexture {
  const w = 16
  const h = 128
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  // Soft horizontal falloff toward the edges.
  const hg = ctx.createLinearGradient(0, 0, w, 0)
  hg.addColorStop(0, 'rgba(0,0,0,0.6)')
  hg.addColorStop(0.5, 'rgba(0,0,0,0)')
  hg.addColorStop(1, 'rgba(0,0,0,0.6)')
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = hg
  ctx.fillRect(0, 0, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// --- Pure helpers (unit tested) -------------------------------------------

/** Horizontal wobble displacement for a rising particle. Pure. */
export function wobbleOffset(phase: number, amp: number): number {
  return Math.sin(phase) * amp
}

/** Whether a rising particle has reached the surface pop line. Pure. */
export function reachedSurface(y: number, surfaceY: number, margin = 0): boolean {
  return y >= surfaceY - margin
}

/**
 * Wrap `value` into the interval [center - half, center + half). Used to keep
 * marine-snow offsets bounded around the recenter point. Pure.
 */
export function wrapCoord(value: number, center: number, half: number): number {
  if (half <= 0) return center
  const span = half * 2
  const min = center - half
  const rel = (((value - min) % span) + span) % span
  return min + rel
}

/**
 * Drain a fractional emission accumulator: add rate*dt, return the whole number
 * of particles to spawn this frame plus the leftover fraction to carry over.
 * Frame-rate independent. Pure.
 */
export function drainEmission(
  accumulator: number,
  rate: number,
  dt: number,
): { count: number; accumulator: number } {
  let acc = accumulator + Math.max(0, rate) * Math.max(0, dt)
  const count = Math.floor(acc)
  acc -= count
  return { count, accumulator: acc }
}

/** Seeded PRNG (mulberry32) so FX scatter is deterministic across reloads. */
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
