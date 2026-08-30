import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

import { settleOptimisticPing, derivePartyQuestRow, autoRejoinQuestPayload } from './useParty'

describe('settleOptimisticPing', () => {
  it('keeps one optimistic ping for a matching stored id', () => {
    const optimistic = {
      id: 'shot-1', user: 'PMC', user_id: 'user-1', map: 'customs', at: 1000, x: 1, y: 0, z: 2,
    }
    const stored = { ...optimistic, at: 1001 }
    expect(settleOptimisticPing([optimistic], stored, 1001, 10_000)).toEqual([optimistic])
  })

  it('does not resurrect a ping cleared while its write was in flight', () => {
    expect(settleOptimisticPing([], { id: 'shot-1', at: 1001 }, 1001, 10_000)).toBeNull()
  })
})


describe('derivePartyQuestRow', () => {
  const saved = (questId, name, mapNorm = null) => ({ quest_id: questId, quest_name: name, map_norm: mapNorm })

  it('drops a row entry the saved list no longer carries', () => {
    // The reported defect: the EFT log sync marks a quest completed, it leaves
    // `user_quests`, and the old merge re-blessed it from the row on every load.
    const { quests } = derivePartyQuestRow([saved('q1', 'Needle and a Haystack')], 'woods', {}, 'user-1')
    expect(quests).toEqual([{ id: 'q1', name: 'Needle and a Haystack' }])
  })

  it('does not depend on what is already in the party row', () => {
    // Two loads of the same saved list must agree regardless of history, which
    // is what makes the derivation authoritative rather than accumulative.
    const savedQuests = [saved('q1', 'Needle and a Haystack')]
    const first = derivePartyQuestRow(savedQuests, 'woods', {}, 'user-1')
    const second = derivePartyQuestRow(savedQuests, 'woods', {}, 'user-1')
    expect(first).toEqual(second)
  })

  it('keeps an unscoped quest on every map', () => {
    // A quest whose steps span maps carries no map_norm, so it must survive the
    // map filter -- this is the row half of the Tarkov Butcher report.
    const savedQuests = [saved('butcher', 'The Tarkov Butcher')]
    expect(derivePartyQuestRow(savedQuests, 'ground-zero', {}, 'user-1').quests)
      .toEqual([{ id: 'butcher', name: 'The Tarkov Butcher' }])
    expect(derivePartyQuestRow(savedQuests, 'streets-of-tarkov', {}, 'user-1').quests)
      .toEqual([{ id: 'butcher', name: 'The Tarkov Butcher' }])
  })

  it('scopes a map-stamped quest to its own map', () => {
    const savedQuests = [saved('q1', 'Woods only', 'woods')]
    expect(derivePartyQuestRow(savedQuests, 'woods', {}, 'user-1').quests).toHaveLength(1)
    expect(derivePartyQuestRow(savedQuests, 'customs', {}, 'user-1').quests).toEqual([])
  })

  it('drops a map change without carrying the previous map forward', () => {
    const savedQuests = [saved('woods-q', 'Woods only', 'woods'), saved('any-q', 'Any map')]
    const { quests } = derivePartyQuestRow(savedQuests, 'customs', {}, 'user-1')
    expect(quests.map(quest => quest.id)).toEqual(['any-q'])
  })

  it('honours a legacy __done__ progress key for the reader only', () => {
    const savedQuests = [saved('q1', 'Done by me'), saved('q2', 'Done by them')]
    const progress = { '__done__:q1::user-1': true, '__done__:q2::user-2': true }
    const { quests } = derivePartyQuestRow(savedQuests, 'woods', progress, 'user-1')
    expect(quests.map(quest => quest.id)).toEqual(['q2'])
  })

  it('reports every saved quest in quests_all regardless of map', () => {
    const savedQuests = [saved('woods-q', 'Woods only', 'woods'), saved('any-q', 'Any map')]
    const { questsAll } = derivePartyQuestRow(savedQuests, 'customs', {}, 'user-1')
    expect(questsAll.map(quest => quest.id)).toEqual(['woods-q', 'any-q'])
  })
})


describe('autoRejoinQuestPayload', () => {
  const quests = [{ quest_id: 'q1', quest_name: 'Needle and a Haystack', map_norm: null }]

  it('seeds the row when the loaded character matches the party', () => {
    expect(autoRejoinQuestPayload('pve', 'pve', quests)).toEqual(quests)
  })

  it('seeds nothing when the loaded character is a different mode', () => {
    // The wrong-mode path: user-level game_mode is PvE, the party is Regular,
    // and there is no second auto-rejoin attempt to correct a bad seed.
    expect(autoRejoinQuestPayload('regular', 'pve', quests)).toEqual([])
  })

  it('seeds the row when the party declares no mode', () => {
    expect(autoRejoinQuestPayload(null, 'pve', quests)).toEqual(quests)
  })
})
