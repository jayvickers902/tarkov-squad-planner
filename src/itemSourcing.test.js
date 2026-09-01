import { describe, expect, it } from 'vitest'
import { resolveSource } from './itemSourcing'

const trader = (minTraderLevel, priceRUB, traderKey = 'prapor') => ({
  traderId: traderKey,
  traderKey,
  traderName: 'Prapor',
  minTraderLevel,
  priceRUB,
})

describe('resolveSource', () => {
  it.each([[1, 'trader'], [2, 'trader'], [3, 'trader'], [4, 'trader']])('accepts trader LL boundary %i', (level, kind) => {
    expect(resolveSource({ traderOffers: [trader(level, 100)], fleaPrice: 200 }, { traderLevels: { prapor: level } }).kind).toBe(kind)
  })

  it('skips locked trader offers and uses flea when available', () => {
    expect(resolveSource({ traderOffers: [trader(2, 100)], fleaPrice: 200 }, { traderLevels: { prapor: 1 }, playerLevel: 1 })).toMatchObject({ price: 200, kind: 'flea' })
  })

  it('enforces the flea level gate and flea disabled state', () => {
    const entry = { fleaPrice: 200, minLevelForFlea: 15 }
    expect(resolveSource(entry, { playerLevel: 14 })).toMatchObject({ kind: 'none' })
    expect(resolveSource(entry, { playerLevel: 15 })).toMatchObject({ price: 200, kind: 'flea' })
    expect(resolveSource(entry, { playerLevel: 79, fleaEnabled: false })).toMatchObject({ kind: 'none' })
  })

  it('returns an available barter without inventing a price', () => {
    expect(resolveSource({ barters: [{ traderId: 't', traderKey: 't', traderName: 'Ragman', minTraderLevel: 2, requiredItems: [{ item: 'x', count: 2 }] }] }, { traderLevels: { t: 2 } })).toEqual({ price: null, label: 'BARTER · Ragman LL2', kind: 'barter' })
  })

  it('returns no source when every option is unavailable', () => {
    expect(resolveSource({ traderOffers: [trader(3, 100)], fleaPrice: 200, minLevelForFlea: 20 }, { traderLevels: { prapor: 0 }, playerLevel: 19 })).toMatchObject({ kind: 'none' })
  })

  it('chooses the cheapest available real price across sources', () => {
    const entry = { traderOffers: [trader(1, 300, 'prapor'), trader(2, 100, 'therapist')], fleaPrice: 200 }
    expect(resolveSource(entry, { traderLevels: { prapor: 1, therapist: 2 }, playerLevel: 1 })).toMatchObject({ price: 100, kind: 'trader' })
    expect(resolveSource({ ...entry, fleaPrice: 50 }, { traderLevels: { prapor: 1, therapist: 2 }, playerLevel: 1 })).toMatchObject({ price: 50, kind: 'flea' })
  })

  it('surfaces a quest lock on a trader offer', () => {
    expect(resolveSource({ traderOffers: [{ ...trader(1, 100), taskUnlock: 'task-1' }] })).toMatchObject({ label: 'Prapor LL1 · QUEST-LOCKED' })
  })
})
