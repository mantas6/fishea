import { describe, it, expect } from 'vitest'
import {
  controlHints,
  controlRows,
  KEYBOARD_CONTROLS,
  GAMEPAD_CONTROLS,
} from '../game/controlHints.js'

describe('controlHints', () => {
  it('returns keyboard-focused hints for keyboard-mouse', () => {
    const hint = controlHints('keyboard-mouse')
    expect(hint).toContain('WASD')
    expect(hint).toContain('LMB bite')
    expect(hint).toContain('H help')
  })

  it('returns gamepad-focused hints for gamepad', () => {
    const hint = controlHints('gamepad')
    expect(hint).toContain('L-stick')
    expect(hint).toContain('✕ bite')
    expect(hint).not.toContain('WASD')
  })
})

describe('controlRows', () => {
  it('maps each source to its full reference table', () => {
    expect(controlRows('keyboard-mouse')).toBe(KEYBOARD_CONTROLS)
    expect(controlRows('gamepad')).toBe(GAMEPAD_CONTROLS)
  })

  it('every row has an action and input', () => {
    for (const row of [...KEYBOARD_CONTROLS, ...GAMEPAD_CONTROLS]) {
      expect(row.action.length).toBeGreaterThan(0)
      expect(row.input.length).toBeGreaterThan(0)
    }
  })
})
