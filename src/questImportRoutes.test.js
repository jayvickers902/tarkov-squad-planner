import { describe, expect, it } from 'vitest'
import { IMPORT_ROUTES, recommendedRoute } from './questImportRoutes'

describe('recommendedRoute', () => {
  it('recommends the desktop app independently of browser log support', () => {
    expect(recommendedRoute()).toEqual({
      key: 'desktop',
      reason: expect.stringMatching(/recommended/i),
    })
    expect(recommendedRoute({ logsSupported: false }).key).toBe('desktop')
    expect(recommendedRoute({ gameMode: 'pvp-season' }).key).toBe('desktop')
  })

  it('acknowledges an existing desktop connection', () => {
    expect(recommendedRoute({ desktopConnected: true })).toEqual({
      key: 'desktop',
      reason: expect.stringMatching(/already connected/i),
    })
  })
})

describe('IMPORT_ROUTES', () => {
  it('contains only desktop, logs and manual routes', () => {
    expect(IMPORT_ROUTES).toHaveLength(3)
    for (const route of IMPORT_ROUTES) {
      expect(route).toEqual(expect.objectContaining({
        key: expect.any(String),
        title: expect.any(String),
        recommended: expect.any(Boolean),
        blurb: expect.any(String),
        bestWhen: expect.any(String),
        requiresChromium: expect.any(Boolean),
      }))
    }
    expect(IMPORT_ROUTES.map(route => route.key)).toEqual(['desktop', 'logs', 'manual'])
    expect(IMPORT_ROUTES.filter(route => route.recommended).map(route => route.key)).toEqual(['desktop'])
  })
})
