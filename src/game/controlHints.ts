// Pure, presentation-agnostic control reference data + hint-bar text selection.
// Kept free of React/DOM so it can be unit tested in the node environment and
// shared by the intro screen, the in-game hint bar and the help overlay.

import type { ActiveSource } from './input/normalize.js'

/** A single row in a controls reference table. */
export interface ControlRow {
  action: string
  input: string
}

/** Keyboard + mouse control reference (mirrors the README table). */
export const KEYBOARD_CONTROLS: ControlRow[] = [
  { action: 'Swim', input: 'W A D (S brakes)' },
  { action: 'Look', input: 'Mouse (click to lock) / Arrows' },
  { action: 'Swim up', input: 'Space' },
  { action: 'Swim down', input: 'Ctrl / C' },
  { action: 'Sprint', input: 'Shift (hold)' },
  { action: 'Bite / eat', input: 'Left mouse button' },
  { action: 'Mute', input: 'M' },
  { action: 'Help', input: 'H' },
]

/** PS4 / DualShock control reference (mirrors the README table). */
export const GAMEPAD_CONTROLS: ControlRow[] = [
  { action: 'Swim', input: 'Left stick (down brakes)' },
  { action: 'Look', input: 'Right stick' },
  { action: 'Swim up', input: 'R1 / D-pad up' },
  { action: 'Swim down', input: 'L2 / D-pad down' },
  { action: 'Sprint', input: 'L1 / R2' },
  { action: 'Bite / eat', input: '✕ Cross / ▢ Square' },
]

/** The full reference table for a device, used by the controls panel. */
export function controlRows(source: ActiveSource): ControlRow[] {
  return source === 'gamepad' ? GAMEPAD_CONTROLS : KEYBOARD_CONTROLS
}

const KEYBOARD_HINT =
  'WASD swim · Mouse/Arrows look · Shift sprint · Space/Ctrl up/down · LMB bite · M mute · H help'
const GAMEPAD_HINT =
  'L-stick swim · R-stick look · L1 sprint · R1/L2 up/down · ✕ bite'

/**
 * The compact one-line hint bar text for the currently active input device.
 */
export function controlHints(source: ActiveSource): string {
  return source === 'gamepad' ? GAMEPAD_HINT : KEYBOARD_HINT
}
