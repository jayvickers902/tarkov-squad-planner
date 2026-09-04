import { describe, expect, it } from 'vitest'
import { containsAsciiControlCharacter } from './textValidation.js'

describe('text validation', () => {
  it('detects ASCII controls without rejecting ordinary Unicode text', () => {
    expect(containsAsciiControlCharacter('plain text')).toBe(false)
    expect(containsAsciiControlCharacter('scout 👋')).toBe(false)
    expect(containsAsciiControlCharacter('line\nfeed')).toBe(true)
    expect(containsAsciiControlCharacter(`nul${String.fromCodePoint(0)}`)).toBe(true)
    expect(containsAsciiControlCharacter(`del${String.fromCodePoint(0x7f)}`)).toBe(true)
    expect(containsAsciiControlCharacter(null)).toBe(false)
  })
})
