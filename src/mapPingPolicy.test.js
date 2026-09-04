import { describe, expect, it } from 'vitest'
import { focusedPingIds, ownPingCard, pingCompanionCards } from './mapPingPolicy'

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

// CENTRE ON ME's half of the resolution. The flight itself is covered in
// MapLeaflet.centreOnMe.test.jsx; this pins down which card it aims at.
describe('own ping resolution', () => {
  const mine = { myUserId: 'alpha', myName: 'ALPHA' }
  const named = (id, user, userId = undefined) => ({ ...card(id, userId, 0, 0), ping: { id, user, user_id: userId } })

  it('takes the newest own ping, since the list arrives newest first', () => {
    const cards = [card('newest', 'alpha', 0, 0), card('older', 'alpha', 10, 10)]
    expect(ownPingCard(cards, mine).ping.id).toBe('newest')
  })

  it('skips teammates however fresh they are', () => {
    const cards = [card('their-newest', 'bravo', 0, 0), card('mine', 'alpha', 10, 10)]
    expect(ownPingCard(cards, mine).ping.id).toBe('mine')
  })

  it('prefers an id match over a fresher callsign match', () => {
    // Callsigns are display text, so a name match is the weaker handle even
    // when it sits on the newer row.
    const cards = [named('name-only', 'ALPHA'), card('by-id', 'alpha', 10, 10)]
    expect(ownPingCard(cards, mine).ping.id).toBe('by-id')
  })

  it('falls back to the callsign when the row carries no id', () => {
    const cards = [named('their-newest', 'BRAVO', 'bravo'), named('mine', 'ALPHA')]
    expect(ownPingCard(cards, mine).ping.id).toBe('mine')
  })

  it('returns null rather than a stranger when neither handle matches', () => {
    expect(ownPingCard([card('theirs', 'bravo', 0, 0)], mine)).toBeNull()
    expect(ownPingCard([], mine)).toBeNull()
    expect(ownPingCard()).toBeNull()
  })

  it('does not let an absent id match a ping that has none either', () => {
    // Both sides undefined is an accidental match, and it would centre the
    // reader on somebody else's ping.
    expect(ownPingCard([named('theirs', 'BRAVO')], { myUserId: undefined, myName: 'ALPHA' })).toBeNull()
  })
})
