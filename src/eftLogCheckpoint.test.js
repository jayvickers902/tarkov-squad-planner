import { describe, expect, it } from 'vitest'
import {
  checkpointFrom,
  currentProfileKeyForCheckpoint,
  isContextLogPath,
  isNotificationLogPath,
  notifierSeasonalMap,
} from './eftLogCheckpoint'
import { CHECKPOINT_VERSION } from './eftLogHandleStore'

describe('EFT log checkpoint policy', () => {
  it('recognizes rotated notification/context logs by their basename', () => {
    expect(isNotificationLogPath('session/notifications.log')).toBe(true)
    expect(isNotificationLogPath('session/push-notifications_2.log')).toBe(true)
    expect(isNotificationLogPath('session/backend.log')).toBe(false)
    expect(isContextLogPath('session/application-3.log')).toBe(true)
    expect(isContextLogPath('session/notifications.log')).toBe(false)
  })

  it('resolves a canonical profile key from a stored canonical or legacy key', () => {
    const preview = { discoveredProfiles: [{ profileKey: 'canonical', legacyProfileKeys: ['legacy'] }] }
    expect(currentProfileKeyForCheckpoint(preview, 'canonical')).toBe('canonical')
    expect(currentProfileKeyForCheckpoint(preview, 'legacy')).toBe('canonical')
    expect(currentProfileKeyForCheckpoint(preview, 'unknown')).toBe('unknown')
    expect(currentProfileKeyForCheckpoint(preview, null)).toBeNull()
  })

  it('keeps only boolean notifier-seasonal verdicts', () => {
    expect([...notifierSeasonalMap({ notifierSeasonalByFile: {
      'notifications.log': true, 'other.log': false, bad: 'unknown',
    } })]).toEqual([['notifications.log', true], ['other.log', false]])
    expect(notifierSeasonalMap({})).toBeNull()
  })

  it('serializes offsets and seasonal verdicts only for notification logs', () => {
    const files = [
      { relativeFilename: 'session/notifications.log', size: 200, lastModified: 4 },
      { relativeFilename: 'session/backend.log', size: 300, lastModified: 5 },
    ]
    const result = checkpointFrom(
      files,
      { includedVersions: ['0.16'] },
      { profileKey: 'profile-a', unknownModeTargets: { s: 'regular' }, includePreWipeHistory: false },
      true,
      'regular',
      new Map([['session/notifications.log', 150]]),
      new Map([['session/notifications.log', true], ['session/backend.log', false]]),
      1234,
    )
    expect(result).toMatchObject({
      // Asserted against the constant: bumping it is how every remembered
      // folder is made to do one more full read, not a change to this shape.
      version: CHECKPOINT_VERSION,
      profileKey: 'profile-a',
      unknownModeTargets: { s: 'regular' },
      includePreWipeHistory: false,
      gameMode: 'regular',
      autoSync: true,
      updatedAt: 1234,
    })
    expect(result.files).toEqual([
      { relativeFilename: files[0].relativeFilename, size: 200, lastModified: 4, parsedOffset: 150, notifierSeasonal: true },
      { relativeFilename: files[1].relativeFilename, size: 300, lastModified: 5 },
    ])
  })
})
