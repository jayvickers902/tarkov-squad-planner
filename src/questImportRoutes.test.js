import { describe, expect, it } from 'vitest'
import { IMPORT_ROUTES, recommendedRoute } from './questImportRoutes'

describe('recommendedRoute', () => {
  it('recommends logs when log import is supported', () => {
    expect(recommendedRoute({ logsSupported: true })).toEqual({ key: 'logs', reason: '' })
  })

  it('recommends screenshots with a reason when logs are unsupported', () => {
    const result = recommendedRoute({ logsSupported: false })
    expect(result.key).toBe('screenshot')
    expect(result.reason).toBeTruthy()
  })

  it('treats missing capabilities as unsupported', () => {
    expect(recommendedRoute()).toEqual({ key: 'screenshot', reason: expect.any(String) })
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
