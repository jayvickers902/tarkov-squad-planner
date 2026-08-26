import { describe, expect, it } from 'vitest'
import { RELEASE_VERSION } from './whatsNew'
import { resolveWelcomeVariant, welcomeStamp } from './welcome'

const base = {
  settingsLoading: false,
  isNewProfile: false,
  releaseVersion: RELEASE_VERSION,
}

describe('welcome gating', () => {
  it('waits for settings before deciding, even for a new profile', () => {
    expect(resolveWelcomeVariant({ ...base, settingsLoading: true, isNewProfile: true })).toBeNull()
  })

  it('shows setup for a profile created in this session', () => {
    expect(resolveWelcomeVariant({ ...base, isNewProfile: true })).toBe('setup')
  })

  it('shows news for an existing account with no welcome state', () => {
    expect(resolveWelcomeVariant({ ...base, settings: {} })).toBe('news')
  })

  it('suppresses news when the stored version matches exactly', () => {
    expect(resolveWelcomeVariant({
      ...base,
      settings: { welcome: { news_version: RELEASE_VERSION } },
    })).toBeNull()
  })

  it('shows news again for any different release version', () => {
    expect(resolveWelcomeVariant({
      ...base,
      settings: { welcome: { news_version: '2026.07' } },
    })).toBe('news')
  })
})

describe('welcome stamps', () => {
  it('stamps both setup and release state for a new profile', () => {
    expect(welcomeStamp('setup', RELEASE_VERSION, '2026-08-25T12:00:00.000Z', { other: true })).toEqual({
      other: true,
      setup_seen_at: '2026-08-25T12:00:00.000Z',
      news_version: RELEASE_VERSION,
    })
  })

  it('stamps news while preserving setup state', () => {
    expect(welcomeStamp('news', RELEASE_VERSION, '2026-08-25T12:00:00.000Z', {
      setup_seen_at: '2026-08-01T12:00:00.000Z',
    })).toEqual({
      setup_seen_at: '2026-08-01T12:00:00.000Z',
      news_version: RELEASE_VERSION,
    })
  })

  it('makes a stamped account quiet on the next decision', () => {
    const stamped = welcomeStamp('news', RELEASE_VERSION, '2026-08-25T12:00:00.000Z')
    expect(resolveWelcomeVariant({ ...base, settings: { welcome: stamped } })).toBeNull()
  })
})
