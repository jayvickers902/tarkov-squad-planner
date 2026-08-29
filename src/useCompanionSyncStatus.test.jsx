import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { rpc, removeChannel, channel } = vi.hoisted(() => {
  const rpc = vi.fn()
  const removeChannel = vi.fn()
  const channel = vi.fn(() => {
    const value = {
      on: vi.fn(() => value),
      subscribe: vi.fn(() => value),
    }
    return value
  })
  return { rpc, removeChannel, channel }
})

vi.mock('./supabase', () => ({
  supabase: {
    rpc,
    channel,
    removeChannel,
  },
}))

import { CompanionSyncStatusProvider, deriveDesktopSummary, rowsToStatuses, useCompanionSyncStatus } from './useCompanionSyncStatus'

function Probe() {
  const value = useCompanionSyncStatus()
  return <output data-testid="status">{JSON.stringify(value)}</output>
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  rpc.mockReset()
  removeChannel.mockReset()
  channel.mockClear()
})

describe('companion sync status data layer', () => {
  it('normalizes the companion service rows', () => {
    expect(rowsToStatuses([
      { service: 'LOGS', configured: true, state: 'WATCHING', detail: 'Connected', last_sync_at: null, updated_at: '2026-08-27T12:00:00.000Z' },
      { service: 'unknown', configured: true, state: 'watching' },
    ])).toEqual({
      logs: {
        clientSource: 'desktop', service: 'logs', configured: true, state: 'watching', detail: 'Connected',
        lastSyncAt: null, lastSeenAt: '2026-08-27T12:00:00.000Z',
        updatedAt: '2026-08-27T12:00:00.000Z', isLive: null,
      },
    })
  })

  it('loads authenticated companion rows and exposes them to the status bar', async () => {
    const reportedAt = new Date().toISOString()
    rpc.mockResolvedValue({
      data: [{ client_source: 'desktop', service: 'logs', configured: true, state: 'watching', detail: 'Connected', last_sync_at: '2026-08-27T11:59:00.000Z', last_seen_at: reportedAt, is_live: true }],
      error: null,
    })
    render(
      <CompanionSyncStatusProvider userId="user-1">
        <Probe />
      </CompanionSyncStatusProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(/"available":true/))
    expect(rpc).toHaveBeenCalledWith('get_sync_client_status')
    // sync_client_status is RPC-only — `authenticated` holds no SELECT on the
    // table, so a postgres_changes channel would subscribe and then deliver
    // nothing. Polling is the mechanism, not a fallback.
    expect(channel).not.toHaveBeenCalled()
    expect(screen.getByTestId('status')).toHaveTextContent(/"desktopState":"connected"/)
    expect(screen.getByTestId('status')).toHaveTextContent(/"desktopConnected":true/)
    expect(screen.getByTestId('status')).toHaveTextContent(new RegExp(`"desktopLastSeen":"${reportedAt}"`))
    expect(screen.getByTestId('status')).toHaveTextContent(/"desktopLastSuccessfulSync":"2026-08-27T11:59:00.000Z"/)
  })

  it('reports no connected desktop when no companion rows exist', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    render(
      <CompanionSyncStatusProvider userId="user-1">
        <Probe />
      </CompanionSyncStatusProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(/"loading":false/))
    expect(screen.getByTestId('status')).toHaveTextContent(/"desktopState":"not-setup"/)
    expect(screen.getByTestId('status')).toHaveTextContent(/"desktopConnected":false/)
    expect(screen.getByTestId('status')).toHaveTextContent(/"desktopLastSeen":null/)
  })

  it('pauses interval RPCs while hidden and refreshes immediately when visible', async () => {
    vi.useFakeTimers()
    let visibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilityState)
    rpc.mockResolvedValue({ data: [], error: null })

    render(
      <CompanionSyncStatusProvider userId="user-1">
        <Probe />
      </CompanionSyncStatusProvider>,
    )
    await act(async () => {})
    expect(rpc).toHaveBeenCalledTimes(1)

    visibilityState = 'hidden'
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(rpc).toHaveBeenCalledTimes(1)

    visibilityState = 'visible'
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('does not treat a historical row as a connected desktop', () => {
    const summary = deriveDesktopSummary({
      logs: { configured: true, state: 'watching', lastSeenAt: '2026-08-27T12:00:00.000Z', lastSyncAt: '2026-08-27T11:58:00.000Z' },
    }, { now: Date.parse('2026-08-27T12:10:00.000Z') })

    expect(summary).toMatchObject({
      desktopState: 'offline',
      desktopConnected: false,
      desktopLastSeen: '2026-08-27T12:00:00.000Z',
      desktopLastSuccessfulSync: '2026-08-27T11:58:00.000Z',
    })
  })

  it('trusts the server is_live verdict over a skewed client clock', () => {
    // The viewer's clock runs ten minutes fast. last_seen_at is a server
    // timestamp, so a client-side subtraction would call this companion
    // offline; the server already said it reported within 90 seconds.
    expect(deriveDesktopSummary({
      logs: { configured: true, state: 'watching', lastSeenAt: '2026-08-27T12:00:00.000Z', isLive: true },
    }, { now: Date.parse('2026-08-27T12:10:00.000Z'), fetchedAt: Date.parse('2026-08-27T12:10:00.000Z') }))
      .toMatchObject({ desktopState: 'connected', desktopConnected: true })
  })

  it('stops trusting a stale is_live answer once polling falls behind', () => {
    expect(deriveDesktopSummary({
      logs: { configured: true, state: 'watching', lastSeenAt: '2026-08-27T12:00:00.000Z', isLive: true },
    }, { now: Date.parse('2026-08-27T12:10:00.000Z'), fetchedAt: Date.parse('2026-08-27T12:05:00.000Z') }))
      .toMatchObject({ desktopState: 'offline', desktopConnected: false })
  })

  it('marks a fresh unhealthy report as needing attention', () => {
    expect(deriveDesktopSummary({
      logs: { configured: true, state: 'needs_access', lastSeenAt: '2026-08-27T12:00:00.000Z', isLive: true },
    }, { now: Date.parse('2026-08-27T12:00:30.000Z') })).toMatchObject({
      desktopState: 'attention',
      desktopConnected: false,
    })
  })
})
