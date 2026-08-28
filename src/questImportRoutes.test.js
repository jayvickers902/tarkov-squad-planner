import { describe, expect, it } from 'vitest'
import { IMPORT_ROUTES, recommendedRoute } from './questImportRoutes'

describe('recommendedRoute', () => {
  it('recommends logs when log import is supported', () => {
    expect(recommendedRoute({ logsSupported: true })).toEqual({ key: 'logs', reason: 'Import your logs once from this PC.' })
  })

  it('recommends screenshots with a reason when logs are unsupported', () => {
    const result = recommendedRoute({ logsSupported: false })
    expect(result.key).toBe('screenshot')
    expect(result.reason).toBeTruthy()
  })

  it('treats missing capabilities as unsupported', () => {
    expect(recommendedRoute()).toEqual({ key: 'screenshot', reason: expect.any(String) })
  })

  it('routes Season and mobile users to screenshots', () => {
    expect(recommendedRoute({ gameMode: 'pvp-season', logsSupported: true }).key).toBe('screenshot')
    expect(recommendedRoute({ gameMode: 'regular', logsSupported: true, mobileLikely: true }).key).toBe('screenshot')
  })

  it('acknowledges a healthy desktop connection without recommending a disabled route', () => {
    expect(recommendedRoute({ logsSupported: true, desktopConnected: true, desktopFresh: true })).toEqual({
      key: 'logs',
      reason: expect.stringMatching(/already connected/i),
    })
    expect(recommendedRoute({ logsSupported: false, desktopConnected: true, desktopFresh: true }).key).toBe('screenshot')
  })
})

describe('IMPORT_ROUTES', () => {
  it('contains the four route shapes', () => {
    expect(IMPORT_ROUTES).toHaveLength(4)
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
    expect(IMPORT_ROUTES.filter(route => route.recommended).map(route => route.key)).toEqual(['logs'])
  })
})
