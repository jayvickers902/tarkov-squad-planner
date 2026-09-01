import { describe, expect, it } from 'vitest'
import { resolveSetting, withGameModeSetting } from './settings'

describe('mode-scoped progression settings', () => {
  it('resolves independent PMC levels and trader levels per game mode', () => {
    const settings = {
      pmc_level: { regular: 42, pve: 12 },
      trader_levels: { regular: { prapor: 4 }, pve: { prapor: 1 } },
    }
    expect(resolveSetting('pmc_level', { user: settings, gameMode: 'regular' })).toBe(42)
    expect(resolveSetting('pmc_level', { user: settings, gameMode: 'pve' })).toBe(12)
    expect(resolveSetting('trader_levels', { user: settings, gameMode: 'regular' })).toEqual({ prapor: 4 })
    expect(resolveSetting('trader_levels', { user: settings, gameMode: 'pve' })).toEqual({ prapor: 1 })
  })

  it('updates one mode without overwriting the other', () => {
    const settings = { pmc_level: { regular: 42, pve: 12 } }
    expect(withGameModeSetting(settings, 'pmc_level', 'pve', 15).pmc_level).toEqual({ regular: 42, pve: 15 })
  })
})
