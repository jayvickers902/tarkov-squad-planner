import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { query, removeChannel, channel } = vi.hoisted(() => {
  const query = vi.fn()
  const removeChannel = vi.fn()
  const channel = vi.fn(() => {
    const value = {
      on: vi.fn(() => value),
      subscribe: vi.fn(() => value),
    }
    return value
  })
  return { query, removeChannel, channel }
})

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: query,
      })),
    })),
    channel,
    removeChannel,
  },
}))

import { CompanionSyncStatusProvider, rowsToStatuses, useCompanionSyncStatus } from './useCompanionSyncStatus'

function Probe() {
  const value = useCompanionSyncStatus()
  return <output data-testid="status">{JSON.stringify(value)}</output>
}

afterEach(() => {
  cleanup()
  query.mockReset()
  removeChannel.mockReset()
})

describe('companion sync status data layer', () => {
  it('normalizes the companion service rows', () => {
    expect(rowsToStatuses([
      { service: 'LOGS', configured: true, state: 'WATCHING', detail: 'Connected', last_sync_at: null, updated_at: '2026-08-27T12:00:00.000Z' },
      { service: 'unknown', configured: true, state: 'watching' },
    ])).toEqual({
      logs: {
        service: 'logs', configured: true, state: 'watching', detail: 'Connected',
        lastSyncAt: null, updatedAt: '2026-08-27T12:00:00.000Z',
      },
    })
  })

  it('loads authenticated companion rows and exposes them to the status bar', async () => {
    query.mockResolvedValue({
      data: [{ service: 'logs', configured: true, state: 'watching', detail: 'Connected', updated_at: '2026-08-27T12:00:00.000Z' }],
      error: null,
    })
    render(
      <CompanionSyncStatusProvider userId="user-1">
        <Probe />
      </CompanionSyncStatusProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(/"available":true/))
    expect(query).toHaveBeenCalledWith('user_id', 'user-1')
  })
})
