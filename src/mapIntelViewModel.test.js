import { describe, expect, it } from 'vitest'
import {
  hazardCountsFor,
  namedLocksFor,
  playerExtractsFor,
  sortedLootItems,
  spawnIntelPingsFor,
} from './mapIntelViewModel'

describe('MapLeaflet intel view model', () => {
  it('keeps PMC extracts while omitting scav-only exits', () => {
    const extracts = [{ id: 'pmc', faction: 'pmc' }, { id: 'scav', faction: 'scav' }, { id: 'unknown' }]
    expect(playerExtractsFor(extracts)).toEqual([extracts[0], extracts[2]])
    expect(playerExtractsFor(null)).toEqual([])
  })

  it('prefers durable ping-log entries when live realtime data duplicates them', () => {
    const stored = { id: 'event-1', user_id: 'alpha', at: 10 }
    const liveDuplicate = { id: 'event-1', user_id: 'alpha', at: 11, x: 99 }
    const liveUnique = { user_id: 'bravo', at: 12 }
    expect(spawnIntelPingsFor([stored], [liveDuplicate, liveUnique])).toEqual([stored, liveUnique])
    expect(spawnIntelPingsFor(undefined, undefined)).toEqual([])
  })

  it('counts known hazards and groups unknown types as other', () => {
    const style = { minefield: {}, sniper: {} }
    expect(hazardCountsFor([
      { hazardType: 'minefield' },
      { hazardType: 'sniper' },
      { hazardType: 'unknown' },
      {},
    ], style)).toEqual({ minefield: 1, sniper: 1, other: 2 })
  })

  it('resolves only positioned locks whose key item is known', () => {
    const key = { id: 'key-1', name: 'Keycard' }
    const locks = [
      { key: 'key-1', position: [1, 2] },
      { key: 'missing', position: [3, 4] },
      { key: 'key-1' },
    ]
    expect(namedLocksFor(locks, new Map([['key-1', key]]))).toEqual([{ ...locks[0], keyItem: key }])
  })

  it('sorts loot by descending value without mutating the source array', () => {
    const loot = [{ id: 'low', value: 10 }, { id: 'high', value: 100 }, { id: 'none' }]
    expect(sortedLootItems(loot).map(item => item.id)).toEqual(['high', 'low', 'none'])
    expect(loot.map(item => item.id)).toEqual(['low', 'high', 'none'])
  })
})
