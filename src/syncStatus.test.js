import { describe, expect, it } from 'vitest'
import { channelStatus, companionChannelStatus, monitorHealth } from './syncStatus'

const now = Date.parse('2026-08-27T12:00:00.000Z')

describe('channelStatus', () => {
  it('reports unsupported browsers without blaming the user', () => {
    expect(channelStatus({ supported: false, state: 'idle' }, { now })).toMatchObject({
      tone: 'off',
      label: 'UNSUPPORTED',
      detail: expect.stringContaining('Chromium browsers only'),
    })
  })

  it('reports lost folder permission as a warning', () => {
    expect(channelStatus({
      supported: true,
      state: 'permission-needed',
      error: 'Folder permission is needed.',
      rememberedFolderName: 'Screenshots',
    }, { now })).toMatchObject({ tone: 'warn', label: 'NEEDS ACCESS' })
  })

  it('reports a connected channel with an old check as stale', () => {
    expect(channelStatus({
      supported: true,
      state: 'watching',
      rememberedFolderName: 'EFT Logs',
      lastSuccessfulCheck: '2026-08-27T11:50:00.000Z',
    }, { now })).toMatchObject({ tone: 'warn', label: 'STALE', stale: true })
  })

  it('reports controller errors as a plain error sentence', () => {
    const status = channelStatus({ supported: true, state: 'error', error: new Error('Folder C:\\EFT\\Logs could not be read.') }, { now })
    expect(status).toMatchObject({ tone: 'error', label: 'ERROR' })
    expect(status.detail).not.toMatch(/[\\/]/)
  })
})

describe('monitorHealth', () => {
  it('rolls up hidden tabs as a warning and keeps per-channel tones', () => {
    const result = monitorHealth({
      logs: { supported: true, state: 'watching', rememberedFolderName: 'Logs' },
      shots: { supported: true, state: 'idle' },
      now,
      visible: false,
    })
    expect(result).toMatchObject({ tone: 'warn', label: 'TAB HIDDEN', channels: { logs: 'ok', screenshots: 'idle' } })
  })

  it('uses companion-reported service states when supplied', () => {
    const result = monitorHealth({
      statuses: {
        logs: companionChannelStatus({ service: 'logs', configured: true, state: 'watching', updatedAt: '2026-08-27T12:00:00.000Z', detail: 'Connected' }, { now }),
        pings: companionChannelStatus({ service: 'pings', configured: true, state: 'error', updatedAt: '2026-08-27T12:00:00.000Z', detail: 'Retrying' }, { now }),
      },
      now,
      visible: true,
    })
    expect(result).toMatchObject({ tone: 'error', channels: { logs: 'ok', screenshots: 'error' } })

    const connected = monitorHealth({
      statuses: {
        logs: companionChannelStatus({ configured: true, state: 'watching', updatedAt: '2026-08-27T12:00:00.000Z' }, { now }),
        pings: companionChannelStatus({ configured: true, state: 'idle', updatedAt: '2026-08-27T12:00:00.000Z' }, { now }),
      },
      now,
      visible: false,
    })
    expect(connected).toMatchObject({ tone: 'ok', label: 'CONNECTED' })
  })
})

describe('companionChannelStatus', () => {
  it('maps the companion heartbeat to a watching status', () => {
    expect(companionChannelStatus({ configured: true, state: 'watching', updatedAt: '2026-08-27T12:00:00.000Z', detail: 'Connected' }, { now }))
      .toMatchObject({ source: 'companion', tone: 'ok', label: 'CONNECTED', lastCheckedMs: now })
  })

  it('marks an old companion heartbeat stale', () => {
    expect(companionChannelStatus({ configured: true, state: 'watching', updatedAt: '2026-08-27T11:50:00.000Z' }, { now }))
      .toMatchObject({ tone: 'warn', label: 'STALE', stale: true })
  })
})
