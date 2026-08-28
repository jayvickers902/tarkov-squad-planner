import { describe, expect, it, vi } from 'vitest'
import { NetworkBoundaryError, createNetworkAdapter, normalizeSyncContext, sanitizeScanMetrics, sanitizeSyncStatuses } from './network.js'

const taskId = '507f1f77bcf86cd799439011'
const ping = { id: 'ping-1', map: 'Customs', x: 1, y: 2, z: 3, yaw: 90, at: 1000, taps: 1, path: 'C:\\secret.log', logText: 'do not send' }

describe('companion network boundary', () => {
  it('normalizes desktop context rows to camelCase', () => {
    expect(normalizeSyncContext({ user_id: 'user-1', callsign: 'Scout', game_mode: 'regular', party_id: 4, party_code: 'ABCD', raid_id: 5, map_norm: 'customs' })).toEqual({
      userId: 'user-1', callsign: 'Scout', gameMode: 'regular', partyId: 4, partyCode: 'ABCD', raidId: 5, mapNorm: 'customs',
    })
  })

  it('uses exact RPC contracts and strips filenames/log text', async () => {
    const rpc = vi.fn(async (name) => name === 'get_desktop_sync_context'
      ? { data: [{ user_id: 'user-1', game_mode: 'regular' }], error: null }
      : name === 'reconcile_user_quest_log_events'
        ? { data: { inserted: 1, updated: 0, ignored: 0, affected_task_ids: [taskId] }, error: null }
        : { data: { id: 1, source_event_id: 'ping-1', party_id: 4, raid_id: 5, user_id: 'user-1', map_norm: 'customs', x: 1, y: 2, z: 3, yaw: 90, client_at: 1000, taps: 1 }, error: null })
    const network = createNetworkAdapter({ supabase: { rpc } })
    await expect(network.getDesktopSyncContext()).resolves.toMatchObject({ userId: 'user-1', gameMode: 'regular' })
    await network.reconcileUserQuestLogEvents('regular', [{ taskId, state: 'completed', eventKey: 'event:1', occurredAt: null, path: 'C:\\bad', logText: 'secret' }])
    await network.appendPartyPing('ABCD', 5, ping)
    expect(rpc.mock.calls).toEqual([
      ['get_desktop_sync_context'],
      ['reconcile_user_quest_log_events', { p_game_mode: 'regular', p_events: [{ task_id: taskId, state: 'completed', occurred_at: null, event_key: 'event:1' }] }],
      ['append_party_ping', { p_code: 'ABCD', p_raid_id: 5, p_ping: { id: 'ping-1', map: 'customs', x: 1, y: 2, z: 3, yaw: 90, at: 1000, taps: 1 } }],
    ])
  })

  it('rejects malformed payloads and does not invoke RPC', async () => {
    const rpc = vi.fn()
    const network = createNetworkAdapter({ supabase: { rpc } })
    await expect(network.reconcileUserQuestLogEvents('regular', [{ taskId: 'not-a-task', state: 'completed', eventKey: 'x' }])).rejects.toBeInstanceOf(NetworkBoundaryError)
    await expect(network.appendPartyPing('ABCD', 1, { ...ping, x: Infinity })).rejects.toMatchObject({ code: 'NETWORK_INVALID_PING' })
    await expect(network.appendPartyPing('ABCD', 1, { ...ping, x: 100001 })).rejects.toMatchObject({ code: 'NETWORK_INVALID_PING' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('reports only bounded desktop operational status', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }))
    const network = createNetworkAdapter({ supabase: { rpc } })
    await network.reportSyncClientStatus([{ service: 'logs', configured: true, state: 'watching', detail: 'Sync up to date', lastSyncAt: '2026-08-27T12:00:00.000Z', path: 'C:\\private' }])
    expect(rpc).toHaveBeenCalledWith('report_sync_client_status', {
      p_client_source: 'desktop',
      p_statuses: [{ service: 'logs', configured: true, state: 'watching', detail: 'Sync up to date', last_sync_at: '2026-08-27T12:00:00.000Z' }],
    })
    expect(() => sanitizeSyncStatuses([{ service: 'logs', state: 'watching' }, { service: 'logs', state: 'watching' }])).toThrow(NetworkBoundaryError)
  })

  it('reports only bounded privacy-safe scan metrics and accepts Seasonal reconciliation', async () => {
    const rpc = vi.fn(async (name) => name === 'reconcile_user_quest_log_events'
      ? { data: { inserted: 0, updated: 0, ignored: 0, affected_task_ids: [] }, error: null }
      : { data: null, error: null })
    const network = createNetworkAdapter({ supabase: { rpc } })
    await network.reportSyncClientStatus([{
      service: 'logs', configured: true, state: 'watching',
      scanMetrics: {
        files: 42, sessions: 3, candidates: 3, matched: 221, applied: 118, active: 103,
        selection: 'auto', scannerVersion: '0.2.0', profileId: 'must-not-send', path: 'C:\\private',
      },
    }])
    expect(rpc).toHaveBeenCalledWith('report_sync_client_status', {
      p_client_source: 'desktop',
      p_statuses: [{
        service: 'logs', configured: true, state: 'watching', detail: '', last_sync_at: null,
        scan_metrics: { files: 42, sessions: 3, candidates: 3, matched: 221, applied: 118, active: 103, selection: 'auto', scanner_version: '0.2.0' },
      }],
    })
    await expect(network.reconcileUserQuestLogEvents('pvp-season', [])).resolves.toEqual({ inserted: 0, updated: 0, ignored: 0, affectedTaskIds: [] })
    rpc.mockResolvedValueOnce({ data: 12, error: null })
    await expect(network.resetUserQuestLogImports('pvp-season')).resolves.toEqual({ deleted: 12 })
    expect(rpc).toHaveBeenLastCalledWith('reset_user_quest_log_imports', { p_game_mode: 'pvp-season' })
  })

  it('rejects invalid scan counters and selection values before RPC', () => {
    expect(() => sanitizeScanMetrics({ files: -1 })).toThrow(NetworkBoundaryError)
    expect(() => sanitizeScanMetrics({ matched: 1.5 })).toThrow(NetworkBoundaryError)
    expect(() => sanitizeScanMetrics({ selection: 'profile-raw-id' })).toThrow(NetworkBoundaryError)
    expect(() => sanitizeScanMetrics({ scannerVersion: 'C:\\private\\scanner.exe' })).toThrow(NetworkBoundaryError)
  })
})
