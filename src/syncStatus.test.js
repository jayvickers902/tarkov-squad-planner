import { describe, expect, it } from 'vitest'
import { browserSyncRows, channelStatus, companionChannelStatus, mergeSyncRows, monitorHealth, relativeSyncLabel, syncChip } from './syncStatus'

describe('unified sync status', () => {
  it('prefers live browser state while retaining desktop state for the tooltip', () => {
    const local = browserSyncRows(
      { state: 'watching', rememberedFolderName: 'Logs', lastSuccessfulCheck: '2026-08-27T12:00:00Z' },
      { state: 'permission-needed', folderName: 'Screenshots', lastSuccessfulCheck: '2026-08-27T11:00:00Z' },
      '2026-08-27T12:00:01Z',
    )
    const rows = mergeSyncRows([
      { client_source: 'desktop', service: 'logs', configured: true, state: 'watching', detail: 'Sync up to date', last_sync_at: '2026-08-27T12:00:02Z', last_seen_at: '2026-08-27T12:00:03Z', is_live: true },
    ], local)
    expect(syncChip('logs', rows, Date.parse('2026-08-27T12:00:04Z'))).toMatchObject({ summary: 'LIVE', tone: 'live' })
    expect(syncChip('logs', rows).rows.map(row => row.client_source).sort()).toEqual(['browser', 'desktop'])
    expect(syncChip('pings', rows)).toMatchObject({ summary: 'NEEDS ACCESS', tone: 'attention' })
  })

  it('shows the newest last-sync age when no configured client is live', () => {
    const chip = syncChip('pings', [{
      client_source: 'desktop', service: 'pings', configured: true, state: 'offline', detail: 'Stopped',
      last_sync_at: '2026-08-27T09:00:00Z', last_seen_at: '2026-08-27T09:00:00Z', is_live: false,
    }], Date.parse('2026-08-27T12:30:00Z'))
    expect(chip).toMatchObject({ summary: '3H AGO', tone: 'stale' })
    expect(relativeSyncLabel(null)).toBe('NO SYNC YET')
  })

  it('shows healthy when either client is syncing even if the other needs attention', () => {
    const chip = syncChip('logs', [
      { client_source: 'browser', service: 'logs', configured: true, state: 'needs_access', is_live: true },
      { client_source: 'desktop', service: 'logs', configured: true, state: 'watching', is_live: true },
    ])
    expect(chip).toMatchObject({ summary: 'LIVE', tone: 'live' })
  })
})

// The chip dots are a connection light: 'ok' paints green, 'connecting' orange,
// 'error'/'idle' red, and 'off' grey. Anything that changes which state maps to
// which tone changes what the light claims, so pin the mapping here.
describe('sync tone as a connection light', () => {
  const now = Date.parse('2026-08-27T12:00:00Z')
  const fresh = '2026-08-27T11:59:00Z'

  it('reads a watching website folder as connected and a reading one as connecting', () => {
    expect(channelStatus({ state: 'watching', rememberedFolderName: 'Logs', lastSuccessfulCheck: fresh }, { now }).tone).toBe('ok')
    expect(channelStatus({ state: 'reading', rememberedFolderName: 'Logs', lastSuccessfulCheck: fresh }, { now }).tone).toBe('connecting')
    expect(channelStatus({ state: 'applying', rememberedFolderName: 'Logs', lastSuccessfulCheck: fresh }, { now }).tone).toBe('connecting')
  })

  it('reads an unconfigured or failed channel as disconnected, and an unsupported one as neither', () => {
    expect(channelStatus({ state: 'idle' }, { now }).tone).toBe('idle')
    expect(channelStatus({ state: 'error', error: 'boom' }, { now }).tone).toBe('error')
    expect(channelStatus({ supported: false }, { now }).tone).toBe('off')
  })

  it('separates the desktop app connecting from the desktop app connected', () => {
    const row = { configured: true, isLive: true, lastSeenAt: fresh, lastSyncAt: fresh }
    expect(companionChannelStatus({ ...row, state: 'connecting' }, { now })).toMatchObject({ tone: 'connecting', label: 'CONNECTING' })
    expect(companionChannelStatus({ ...row, state: 'syncing' }, { now })).toMatchObject({ tone: 'connecting', label: 'SYNCING' })
    expect(companionChannelStatus({ ...row, state: 'watching' }, { now })).toMatchObject({ tone: 'ok', label: 'CONNECTED' })
  })

  it('only reports CONNECTING when connecting is the best news the monitor has', () => {
    const connecting = { tone: 'connecting', source: 'browser' }
    const watching = { tone: 'ok', source: 'browser' }
    expect(monitorHealth({ visible: true, statuses: { logs: connecting, pings: { tone: 'idle', source: 'browser' } } }))
      .toMatchObject({ tone: 'connecting', label: 'CONNECTING' })
    expect(monitorHealth({ visible: true, statuses: { logs: connecting, pings: watching } }).tone).toBe('ok')
  })
})
