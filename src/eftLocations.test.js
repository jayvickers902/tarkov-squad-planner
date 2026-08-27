import { describe, expect, it } from 'vitest'
import { eftLocationToFeatured, mapEftLocation, normalizeEftLocation } from './eftLocations'

describe('eft location normalization', () => {
  it('maps EFT raid ids to featured map names', () => {
    expect(eftLocationToFeatured('Sandbox_high')).toBe('ground-zero')
    expect(normalizeEftLocation('bigmap')).toBe('customs')
    expect(mapEftLocation('factory4_night')).toBe('factory')
    expect(eftLocationToFeatured('laboratory')).toBe('the-lab')
  })

  it('rejects unknown and deliberately non-featured locations', () => {
    expect(eftLocationToFeatured('icebreaker')).toBeNull()
    expect(eftLocationToFeatured('Labyrinth')).toBeNull()
    expect(eftLocationToFeatured('')).toBeNull()
    expect(eftLocationToFeatured({ location: 'Sandbox_high' })).toBeNull()
  })
})
