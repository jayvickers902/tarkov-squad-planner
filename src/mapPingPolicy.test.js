import { describe, expect, it } from 'vitest'
import { focusedPingIds, pingCompanionCards } from './mapPingPolicy'

const target = {
  ping: { id: 'target', user_id: 'alpha', x: 100, z: 100 },
  age: 1_000,
  floor: 'ground',
}

const card = (id, userId, x, z, overrides = {}) => ({
  ping: { id, user_id: userId, x, z },
  age: 1_000,
  floor: 'ground',
  ...overrides,
})

describe('map ping focus policy', () => {
  it('groups recent same-floor pings within 150 metres', () => {
    expect(pingCompanionCards(target, [
      card('near', 'bravo', 220, 100),
      card('far', 'charlie', 260, 100),
    ]).map(item => item.ping.id)).toEqual(['near'])
  })

  it('excludes the target, same-user pings, stale pings, and other floors', () => {
    expect(pingCompanionCards(target, [
      target,
      card('same-user', 'alpha', 110, 100),
      card('stale', 'bravo', 110, 100, { age: 90_001 }),
      card('other-floor', 'charlie', 110, 100, { floor: 'upper' }),
    ])).toEqual([])
  })

  it('returns a stable set containing the focused ping and companions', () => {
    expect(focusedPingIds(target, [card('near', 'bravo', 110, 100)])).toEqual(new Set(['target', 'near']))
    expect(focusedPingIds(null, [card('near', 'bravo', 110, 100)])).toEqual(new Set())
  })
})
