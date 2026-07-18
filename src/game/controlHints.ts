// Pure, presentation-agnostic control reference data + hint-bar tokens.
// Kept free of React/DOM so it can be unit tested in the node environment and
// shared by the intro screen, the in-game hint bar and the help overlay.
//
// Data here is *icon-friendly*: each control is described as a list of typed
// icon ids plus a short action label. The actual SVG rendering lives in
// src/ui/ControlIcons.tsx; a plain-text fallback (controlHintsText / the row
// `input` field) is kept for tests and aria-labels.

import type { ActiveSource } from './input/normalize.js'

/**
 * A typed id for every controller / keyboard / mouse icon we can render.
 * `key:*` ids carry the visible keycap label after the colon (e.g. 'key:W',
 * 'key:Shift', 'key:Space', 'key:↑').
 */
export type KeyIconId = `key:${string}`
export type ControlIconId =
  // PlayStation face buttons
  | 'cross'
  | 'circle'
  | 'square'
  | 'triangle'
  // Shoulder buttons / triggers
  | 'l1'
  | 'r1'
  | 'l2'
  | 'r2'
  // Analog sticks
  | 'lstick'
  | 'rstick'
  // Analog stick presses
  | 'l3'
  // D-pad (whole pad or a single highlighted direction)
  | 'dpad'
  | 'dpad-up'
  | 'dpad-down'
  | 'dpad-left'
  | 'dpad-right'
  // Mouse
  | 'mouse'
  | 'mouse-left'
  // Keyboard keycaps
  | KeyIconId

/** A single row in a controls reference table (icons + label + text). */
export interface ControlRow {
  action: string
  icons: ControlIconId[]
  /** Plain-text fallback describing the input (aria / tests / README parity). */
  input: string
}

/** A compact hint-bar token: an icon (or a few) paired with a short label. */
export interface HintToken {
  icons: ControlIconId[]
  label: string
}

/** Human-readable text for a single icon id (plain-text fallback). */
export function iconText(id: ControlIconId): string {
  switch (id) {
    case 'cross':
      return '✕'
    case 'circle':
      return '○'
    case 'square':
      return '▢'
    case 'triangle':
      return '△'
    case 'l1':
      return 'L1'
    case 'r1':
      return 'R1'
    case 'l2':
      return 'L2'
    case 'r2':
      return 'R2'
    case 'lstick':
      return 'L-stick'
    case 'rstick':
      return 'R-stick'
    case 'l3':
      return 'L3'
    case 'dpad':
      return 'D-pad'
    case 'dpad-up':
      return 'D-pad up'
    case 'dpad-down':
      return 'D-pad down'
    case 'dpad-left':
      return 'D-pad left'
    case 'dpad-right':
      return 'D-pad right'
    case 'mouse':
      return 'Mouse'
    case 'mouse-left':
      return 'LMB'
    default:
      // key:* — the visible keycap label is everything after the colon.
      return id.slice(4)
  }
}

/** Join a list of icon ids into readable text (e.g. "W A S D"). */
export function iconsText(ids: ControlIconId[]): string {
  return ids.map(iconText).join(' ')
}

/** Keyboard + mouse control reference (mirrors the README table). */
export const KEYBOARD_CONTROLS: ControlRow[] = [
  { action: 'Swim', icons: ['key:W', 'key:A', 'key:S', 'key:D'], input: 'W A D (S brakes)' },
  {
    action: 'Look',
    icons: ['mouse', 'key:←', 'key:↑', 'key:→', 'key:↓'],
    input: 'Mouse (click to lock) / Arrows',
  },
  { action: 'Swim up', icons: ['key:Space'], input: 'Space' },
  { action: 'Swim down', icons: ['key:Ctrl', 'key:C'], input: 'Ctrl / C' },
  { action: 'Sprint', icons: ['key:Shift'], input: 'Shift (hold)' },
  { action: 'Bite / eat', icons: ['mouse-left'], input: 'Left mouse button' },
  { action: 'Mute', icons: ['key:M'], input: 'M' },
  { action: 'Help', icons: ['key:H'], input: 'H' },
]

/** PS4 / DualShock control reference (mirrors the README table). */
export const GAMEPAD_CONTROLS: ControlRow[] = [
  { action: 'Swim', icons: ['lstick'], input: 'Left stick (down brakes)' },
  { action: 'Look', icons: ['rstick'], input: 'Right stick' },
  { action: 'Swim up', icons: ['r1', 'dpad-up'], input: 'R1 / D-pad up' },
  { action: 'Swim down', icons: ['l2', 'dpad-down'], input: 'L2 / D-pad down' },
  { action: 'Sprint', icons: ['l1', 'r2', 'l3'], input: 'L1 / R2 / L3' },
  { action: 'Bite / eat', icons: ['cross', 'square'], input: '✕ Cross / ▢ Square' },
]

/** The full reference table for a device, used by the controls panel. */
export function controlRows(source: ActiveSource): ControlRow[] {
  return source === 'gamepad' ? GAMEPAD_CONTROLS : KEYBOARD_CONTROLS
}

/** Compact hint-bar tokens for the keyboard + mouse scheme. */
export const KEYBOARD_HINTS: HintToken[] = [
  { icons: ['key:W', 'key:A', 'key:S', 'key:D'], label: 'Swim' },
  { icons: ['mouse'], label: 'Look' },
  { icons: ['key:Shift'], label: 'Sprint' },
  { icons: ['key:Space', 'key:Ctrl'], label: 'Up / Down' },
  { icons: ['mouse-left'], label: 'Bite' },
  { icons: ['key:M'], label: 'Mute' },
  { icons: ['key:H'], label: 'Help' },
]

/** Compact hint-bar tokens for the PS4 / DualShock scheme. */
export const GAMEPAD_HINTS: HintToken[] = [
  { icons: ['lstick'], label: 'Swim' },
  { icons: ['rstick'], label: 'Look' },
  { icons: ['l1'], label: 'Sprint' },
  { icons: ['r1', 'l2'], label: 'Up / Down' },
  { icons: ['cross'], label: 'Bite' },
]

/**
 * The compact one-line hint-bar tokens for the currently active input device.
 * Consumers render each token's icons followed by its label.
 */
export function controlHints(source: ActiveSource): HintToken[] {
  return source === 'gamepad' ? GAMEPAD_HINTS : KEYBOARD_HINTS
}

/**
 * Plain-text fallback for the hint bar (used for aria-labels and tests).
 * e.g. "W A S D Swim · Mouse Look · Shift Sprint · …".
 */
export function controlHintsText(source: ActiveSource): string {
  return controlHints(source)
    .map((token) => `${iconsText(token.icons)} ${token.label}`)
    .join(' · ')
}
