import { describe, expect, it } from 'vitest'
import { browserSyncRows, mergeSyncRows, relativeSyncLabel, syncChip } from './syncStatus'

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
