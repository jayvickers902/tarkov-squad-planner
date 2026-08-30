import { describe, it, expect } from 'vitest'
import {
  HIDDEN_QUESTS_CAP,
  HIDDEN_QUESTS_KEY,
  hiddenQuestIds,
  isQuestHidden,
  withQuestHidden,
} from './questVisibility'

function settingsWith(value) {
  return { quest_order: { 'user-1': ['a'] }, [HIDDEN_QUESTS_KEY]: value }
}

describe('hiddenQuestIds', () => {
  it('reads the list for the requested mode only', () => {
    const settings = settingsWith({ regular: ['a', 'b'], pve: ['c'] })
    expect([...hiddenQuestIds(settings, 'regular')]).toEqual(['a', 'b'])
    expect([...hiddenQuestIds(settings, 'pve')]).toEqual(['c'])
  })

  it('falls back to regular for an unknown mode and to empty for junk', () => {
    const settings = settingsWith({ regular: ['a'] })
    expect([...hiddenQuestIds(settings, 'not-a-mode')]).toEqual(['a'])
    expect(hiddenQuestIds(settingsWith(['a']), 'regular').size).toBe(0)
    expect(hiddenQuestIds({}, 'regular').size).toBe(0)
    expect(hiddenQuestIds(undefined, 'regular').size).toBe(0)
  })

  it('drops non-string and duplicate entries', () => {
    const settings = settingsWith({ regular: ['a', 'a', '', null, 7, 'b'] })
    expect([...hiddenQuestIds(settings, 'regular')]).toEqual(['a', 'b'])
  })
})

describe('withQuestHidden', () => {
  it('hides and unhides within one mode', () => {
    const hidden = withQuestHidden({}, 'regular', 'a', true)
    expect(hidden).toEqual({ regular: ['a'] })
    expect(isQuestHidden(settingsWith(hidden), 'regular', 'a')).toBe(true)

    const shown = withQuestHidden(settingsWith(hidden), 'regular', 'a', false)
    expect(shown.regular).toBeUndefined()
  })

  it('leaves other modes untouched', () => {
    const settings = settingsWith({ regular: ['a'], pve: ['c'] })
    expect(withQuestHidden(settings, 'pve', 'd', true)).toEqual({ regular: ['a'], pve: ['c', 'd'] })
    expect(withQuestHidden(settings, 'regular', 'a', false)).toEqual({ pve: ['c'] })
  })

  it('does not return the stored object, so a caller cannot mutate settings', () => {
    const stored = { regular: ['a'] }
    const next = withQuestHidden(settingsWith(stored), 'regular', 'b', true)
    expect(next.regular).toEqual(['a', 'b'])
    expect(stored.regular).toEqual(['a'])
  })

  it('is idempotent in both directions', () => {
    const settings = settingsWith({ regular: ['a'] })
    expect(withQuestHidden(settings, 'regular', 'a', true)).toEqual({ regular: ['a'] })
    expect(withQuestHidden(settings, 'regular', 'zz', false)).toEqual({ regular: ['a'] })
  })

  it('ignores a missing quest id', () => {
    expect(withQuestHidden(settingsWith({ regular: ['a'] }), 'regular', '', true)).toEqual({ regular: ['a'] })
  })

  it('caps the list by dropping the oldest entries', () => {
    const full = Array.from({ length: HIDDEN_QUESTS_CAP }, (_, i) => `q${i}`)
    const next = withQuestHidden(settingsWith({ regular: full }), 'regular', 'new', true)
    expect(next.regular).toHaveLength(HIDDEN_QUESTS_CAP)
    expect(next.regular[0]).toBe('q1')
    expect(next.regular[HIDDEN_QUESTS_CAP - 1]).toBe('new')
  })
})
