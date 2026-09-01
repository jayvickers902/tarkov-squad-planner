import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeCached } from './idbCache'
import { adaptItemSourcing, getRestKeys } from './tarkovRest'

describe('tarkov REST adapters and cache fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('prunes item sourcing to items that have a source', () => {
    const result = adaptItemSourcing({ items: [
      { id: 'priced', avg24hPrice: 100, minLevelForFlea: 1, buyFromTrader: [] },
      { id: 'bartered', buyFromTrader: [] },
      { id: 'no-flea', avg24hPrice: 100, noFlea: true, buyFromTrader: [] },
      { id: 'empty', buyFromTrader: [] },
    ] }, {
      barters: [{ trader: 't1', minTraderLevel: 2, requiredItems: [{ item: 'component', count: 2 }], offeredItem: { item: 'bartered', count: 1 } }],
    }, { t1: { id: 't1', normalizedName: 'ragman', name: 'ragman' } }, { 'ragman Nickname': 'Ragman' })
    expect(Object.keys(result)).toEqual(['priced', 'bartered'])
    expect(result.empty).toBeUndefined()
    expect(result.bartered.barters[0]).toMatchObject({ traderId: 't1', traderName: 'Ragman', requiredItems: [{ item: 'component', count: 2 }] })
  })

  it('serves a cached dataset after a rejected producer', async () => {
    const cached = [{ id: 'key-1', name: 'Cached key' }]
    await writeCached('regular.keys', cached)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(getRestKeys()).resolves.toMatchObject({ data: cached, fromCache: true })
  })

  it('does not serve stale data for an aborted producer', async () => {
    await writeCached('regular.keys', [{ id: 'key-2', name: 'Stale key' }])
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    const controller = new AbortController()
    controller.abort()
    await expect(getRestKeys(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
