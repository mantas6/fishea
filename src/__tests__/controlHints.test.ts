import { describe, it, expect } from 'vitest'
import {
  controlHints,
  controlHintsText,
  controlRows,
  iconText,
  iconsText,
  KEYBOARD_CONTROLS,
  GAMEPAD_CONTROLS,
} from '../game/controlHints.js'
import type { ControlIconId } from '../game/controlHints.js'

describe('controlHints (structured tokens)', () => {
  it('returns keyboard tokens for keyboard-mouse', () => {
    const tokens = controlHints('keyboard-mouse')
    const swim = tokens.find((t) => t.label === 'Swim')
    expect(swim?.icons).toEqual(['key:W', 'key:A', 'key:S', 'key:D'])
    const bite = tokens.find((t) => t.label === 'Bite')
    expect(bite?.icons).toContain('mouse-left')
  })

  it('returns gamepad tokens for gamepad', () => {
    const tokens = controlHints('gamepad')
    const swim = tokens.find((t) => t.label === 'Swim')
    expect(swim?.icons).toEqual(['lstick'])
    const bite = tokens.find((t) => t.label === 'Bite')
    expect(bite?.icons).toContain('cross')
    // No keyboard keycaps in the gamepad scheme.
    const allIcons = tokens.flatMap((t) => t.icons)
    expect(allIcons.some((i) => i.startsWith('key:'))).toBe(false)
  })

  it('every token has at least one icon and a label', () => {
    for (const source of ['keyboard-mouse', 'gamepad'] as const) {
      for (const token of controlHints(source)) {
        expect(token.icons.length).toBeGreaterThan(0)
        expect(token.label.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('controlHintsText (plain-text fallback)', () => {
  it('mirrors the keyboard scheme', () => {
    const text = controlHintsText('keyboard-mouse')
    expect(text).toContain('W A S D Swim')
    expect(text).toContain('LMB Bite')
    expect(text).toContain('H Help')
  })

  it('mirrors the gamepad scheme', () => {
    const text = controlHintsText('gamepad')
    expect(text).toContain('L-stick Swim')
    expect(text).toContain('✕ Bite')
    expect(text).not.toContain('W A S D')
  })
})

describe('iconText / iconsText', () => {
  it('maps face buttons to PlayStation glyphs', () => {
    expect(iconText('cross')).toBe('✕')
    expect(iconText('circle')).toBe('○')
    expect(iconText('square')).toBe('▢')
    expect(iconText('triangle')).toBe('△')
  })

  it('derives keycap labels from the key: id', () => {
    expect(iconText('key:W')).toBe('W')
    expect(iconText('key:Shift')).toBe('Shift')
    expect(iconText('key:↑')).toBe('↑')
  })

  it('joins icon lists with spaces', () => {
    const ids: ControlIconId[] = ['key:W', 'key:A', 'key:S', 'key:D']
    expect(iconsText(ids)).toBe('W A S D')
  })
})

describe('controlRows', () => {
  it('maps each source to its full reference table', () => {
    expect(controlRows('keyboard-mouse')).toBe(KEYBOARD_CONTROLS)
    expect(controlRows('gamepad')).toBe(GAMEPAD_CONTROLS)
  })

  it('lists L1 / R2 / L3 as gamepad sprint inputs', () => {
    const sprint = GAMEPAD_CONTROLS.find((r) => r.action === 'Sprint')
    expect(sprint?.icons).toEqual(['l1', 'r2', 'l3'])
    expect(sprint?.input).toBe('L1 / R2 / L3')
    expect(iconText('l3')).toBe('L3')
  })

  it('every row has an action, icons and text input', () => {
    for (const row of [...KEYBOARD_CONTROLS, ...GAMEPAD_CONTROLS]) {
      expect(row.action.length).toBeGreaterThan(0)
      expect(row.icons.length).toBeGreaterThan(0)
      expect(row.input.length).toBeGreaterThan(0)
    }
  })
})
