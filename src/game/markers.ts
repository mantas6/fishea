// Pure math backing the HUD prey markers (see Game._computeMarkers, Hud.tsx).
// Kept free of React/Three.js so it can be unit tested in the node environment.
//
// The game projects each eatable fish to normalized device coordinates (NDC)
// with the Three.js camera; this module turns that raw NDC into CSS-friendly
// screen percentages, decides on/off-screen, fades markers by distance, and
// clamps the nearest off-screen target to an edge arrow.

/** A projected point in normalized device coordinates. */
export interface Ndc {
  /** [-1, 1] left→right (values outside are off-screen horizontally). */
  x: number
  /** [-1, 1] bottom→top (values outside are off-screen vertically). */
  y: number
  /** [-1, 1] near→far in front of the camera; > 1 means behind the camera. */
  z: number
}

/** A marker position expressed as a percentage of the viewport (CSS-ready). */
export interface ScreenPct {
  /** Horizontal position, 0 (left) → 100 (right). */
  xPct: number
  /** Vertical position, 0 (top) → 100 (bottom). */
  yPct: number
}

/** An edge-clamped off-screen marker plus the arrow rotation toward the target. */
export interface EdgeMarker extends ScreenPct {
  /** Arrow rotation (radians), 0 = pointing right, +clockwise (screen space). */
  angle: number
}

/**
 * Convert projected NDC (x,y in [-1,1], y up) to viewport percentages (y down)
 * that map directly onto CSS `left`/`top`. Pure.
 */
export function ndcToScreenPct(x: number, y: number): ScreenPct {
  return {
    xPct: (x * 0.5 + 0.5) * 100,
    yPct: (1 - (y * 0.5 + 0.5)) * 100,
  }
}

/**
 * Whether a projected point is visible on screen: in front of the camera
 * (z <= 1) and within the [-1, 1] NDC box on both axes. Pure.
 */
export function isOnScreen(ndc: Ndc): boolean {
  return ndc.z <= 1 && ndc.x >= -1 && ndc.x <= 1 && ndc.y >= -1 && ndc.y <= 1
}

/**
 * Distance-based marker opacity: full at `near` (or closer), fading linearly to
 * `min` at `far` (or beyond). Closer prey read louder. Pure.
 */
export function markerFade(dist: number, near: number, far: number, min = 0): number {
  if (far <= near) return dist <= near ? 1 : min
  if (dist <= near) return 1
  if (dist >= far) return min
  const t = (dist - near) / (far - near)
  return min + (1 - min) * (1 - t)
}

/**
 * Normalized "bite closeness" for an eatable fish: how far the player has
 * closed the gap toward being able to bite it. 0 while still at (or beyond) the
 * `engage` distance where the cue first appears, ramping linearly to 1 once the
 * fish is within `range` (the actual eat range). Clamped to [0, 1]. Pure.
 *
 * `range` should be the exact `eatRange(size)` value so the fill reaches 1 at
 * the same distance the real bite lands — the cue never over- or under-promises.
 * `engage` defaults to a few multiples of the eat range so the marker starts
 * filling as prey enters comfortable approach distance.
 */
export function biteCloseness(dist: number, range: number, engage = range * 4): number {
  if (engage <= range) return dist <= range ? 1 : 0
  if (dist <= range) return 1
  if (dist >= engage) return 0
  return (engage - dist) / (engage - range)
}

/**
 * Clamp an off-screen target to the screen edge and compute the arrow angle
 * pointing toward it from the screen centre. Pure.
 *
 * Only the *direction* of the projected point is used: when the target is
 * behind the camera (`behind`) Three.js mirrors the projection, so the NDC
 * vector is negated to recover the true bearing. The direction is then scaled
 * so its dominant axis lands on the `1 - margin` boundary, keeping the marker
 * just inside the viewport regardless of aspect ratio.
 */
export function edgeMarker(ndcX: number, ndcY: number, behind: boolean, margin = 0.1): EdgeMarker {
  let dx = ndcX
  let dy = ndcY
  if (behind) {
    dx = -dx
    dy = -dy
  }
  // Degenerate (target at the exact centre / straight ahead): point up.
  if (Math.hypot(dx, dy) < 1e-6) {
    dx = 0
    dy = 1
  }
  const limit = Math.max(0, 1 - margin)
  const scale = limit / Math.max(Math.abs(dx), Math.abs(dy))
  const ex = dx * scale
  const ey = dy * scale
  return {
    ...ndcToScreenPct(ex, ey),
    // Screen space has y pointing down, so flip dy for the CSS rotation.
    angle: Math.atan2(-dy, dx),
  }
}
