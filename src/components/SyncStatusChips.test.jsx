import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SyncStatusChips from './SyncStatusChips'

vi.mock('../EftLogSyncContext', () => ({
  useSyncPresenceContext: vi.fn(() => [
    { client_source: 'browser', service: 'logs', configured: true, state: 'needs_access', detail: 'Folder permission is needed again.', last_sync_at: '2026-08-27T11:00:00Z', last_seen_at: '2026-08-27T12:00:00Z', is_live: true },
    { client_source: 'desktop', service: 'pings', configured: true, state: 'watching', detail: 'Sync up to date', last_sync_at: '2026-08-27T12:00:00Z', last_seen_at: '2026-08-27T12:00:01Z', is_live: true },
  ]),
}))

describe('SyncStatusChips', () => {
  it('shows combined status and exposes source, current state, and full last-sync date', () => {
    render(<SyncStatusChips />)
    expect(screen.getByText('NEEDS ACCESS')).toBeInTheDocument()
    expect(screen.getByText('LIVE')).toBeInTheDocument()
    expect(screen.getByText(/Website: Folder permission is needed again/)).toBeInTheDocument()
    expect(screen.getByText(/Desktop app: Sync up to date/)).toBeInTheDocument()
    expect(screen.getAllByRole('tooltip')).toHaveLength(2)
  })
})
