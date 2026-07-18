// Pure, DOM/AudioContext-free music-theory + audio helper logic. Everything
// here operates on plain numbers and injectable RNGs so it can be unit tested
// in a plain node environment without touching the Web Audio API.

// Equal-tempered semitone ratio.
const SEMITONE = Math.pow(2, 1 / 12)

// Semitone offsets (from the root) of the minor pentatonic scale. This is the
// classic "can't play a wrong note" scale that sits well under ambient pads.
export const MINOR_PENTATONIC = [0, 3, 5, 7, 10]

/** A pseudo-random number generator returning a float in [0, 1). */
export type Rng = () => number

/**
 * Convert a semitone offset from a base frequency into an absolute frequency.
 */
export function semitoneToFreq(baseFreq: number, semitones: number): number {
  return baseFreq * Math.pow(SEMITONE, semitones)
}

/**
 * Build a table of note frequencies for a scale spanning a number of octaves.
 * Ascending, starting at `baseFreq` (the root of the lowest octave).
 */
export function buildScale(baseFreq: number, intervals: number[] = MINOR_PENTATONIC, octaves = 3): number[] {
  const notes: number[] = []
  for (let o = 0; o < octaves; o++) {
    for (const step of intervals) {
      notes.push(semitoneToFreq(baseFreq, step + o * 12))
    }
  }
  return notes
}

/**
 * Pick the index of the next note using a bounded random walk. Keeps melodies
 * smooth (small steps) while occasionally leaping. Pure: takes an injectable
 * RNG (a `() => number` in [0,1)) and the previous index, returns the next
 * index clamped to the scale length. When `prevIndex` is null it seeds a
 * starting note somewhere in the lower-middle of the range.
 */
export function pickNextNote(
  scaleLength: number,
  rng: Rng,
  prevIndex: number | null = null,
  maxStep = 2,
): number {
  if (scaleLength <= 0) return 0
  if (prevIndex == null) {
    // Seed roughly in the lower third so the melody has room to rise.
    return Math.min(scaleLength - 1, Math.floor(rng() * Math.max(1, Math.floor(scaleLength / 3))))
  }
  // Step in [-maxStep, +maxStep].
  const step = Math.round((rng() * 2 - 1) * maxStep)
  let next = prevIndex + step
  // Reflect off the edges so we don't cluster at the extremes.
  if (next < 0) next = -next
  if (next > scaleLength - 1) next = scaleLength - 1 - (next - (scaleLength - 1))
  if (next < 0) next = 0
  if (next > scaleLength - 1) next = scaleLength - 1
  return next
}

/**
 * Hysteresis gate for the low-HP heartbeat loop. Starts when the HP fraction
 * drops below `startBelow`, stops only once it climbs back above `stopAbove`.
 * The gap between the two thresholds prevents rapid on/off flicker when HP
 * hovers near the boundary.
 */
export function heartbeatActive(
  active: boolean,
  hpFraction: number,
  startBelow = 0.3,
  stopAbove = 0.35,
): boolean {
  if (!Number.isFinite(hpFraction)) return active
  if (active) {
    // Only release once we've clearly recovered.
    return hpFraction <= stopAbove
  }
  // Only engage when we've clearly dropped.
  return hpFraction < startBelow
}

/**
 * Map an HP fraction to a heartbeat tempo (beats per minute). Lower HP beats
 * faster for tension. Pure and clamped.
 */
export function heartbeatBpm(hpFraction: number, slow = 60, fast = 110): number {
  const f = Math.max(0, Math.min(1, hpFraction))
  // At 0.3 hp -> slow, at 0 hp -> fast. Linearly interpolate within [0,0.3].
  const t = Math.max(0, Math.min(1, 1 - f / 0.3))
  return slow + (fast - slow) * t
}

/**
 * Decide whether a "hurt" SFX should be suppressed because a fatal bite just
 * fired the death sting. A fatal bite emits 'player-died' (synchronously, just
 * before the audio manager's own 'player-bitten' handler runs), so when the
 * hurt trigger arrives within `windowMs` of the last death we skip it to avoid
 * two loud stingers stacking on the same frame. Pure: takes explicit
 * timestamps in milliseconds.
 */
export function shouldSuppressHurt(
  nowMs: number,
  lastDeathMs: number | null,
  windowMs = 100,
): boolean {
  if (lastDeathMs == null) return false
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastDeathMs)) return false
  const dt = nowMs - lastDeathMs
  return dt >= 0 && dt <= windowMs
}

export default {
  MINOR_PENTATONIC,
  semitoneToFreq,
  buildScale,
  pickNextNote,
  heartbeatActive,
  heartbeatBpm,
  shouldSuppressHurt,
}
