import { describe, expect, it } from 'vitest'
import { channelStatus, monitorHealth } from './syncStatus'

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
})
