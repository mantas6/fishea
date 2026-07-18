import { describe, it, expect } from 'vitest'

describe('sanity', () => {
  it('math works', () => {
    expect(1 + 1).toBe(2)
  })

  it('environment is set up', () => {
    expect(typeof structuredClone).toBe('function')
  })
})
