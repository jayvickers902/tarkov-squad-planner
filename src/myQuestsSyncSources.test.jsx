import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { useEftLogSync, useEftScreenshotSyncContext, useCompanionSyncStatus } = vi.hoisted(() => ({
  useEftLogSync: vi.fn(),
  useEftScreenshotSyncContext: vi.fn(),
  useCompanionSyncStatus: vi.fn(),
}))

vi.mock('./useTarkov', () => ({ useTasks: () => ({ tasks: [], loading: false }) }))
vi.mock('./EftLogSyncContext', () => ({ useEftLogSync, useEftScreenshotSyncContext }))
vi.mock('./useCompanionSyncStatus', () => ({ useCompanionSyncStatus }))

import MyQuests from './components/MyQuests'

const props = {
  userId: 'user-1',
  userQuests: [],
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  onToggleImportant: vi.fn(),
  onToggleSkipped: vi.fn(),
  onClearAll: vi.fn(),
  onRestore: vi.fn(),
  onDone: vi.fn(),
  inParty: false,
  userSettings: {},
  onSetUserSetting: vi.fn(),
  gameMode: 'regular',
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

describe('MyQuests sync sources', () => {
  it('uses the live desktop screenshot configuration instead of prompting for a browser folder', () => {
    const reportedAt = new Date().toISOString()
    useEftLogSync.mockReturnValue({ allTasks: [], lastSuccessfulCheck: null })
    useEftScreenshotSyncContext.mockReturnValue({
      persistentSupported: true,
      state: 'idle',
      folderName: null,
      connect: vi.fn(),
    })
    useCompanionSyncStatus.mockReturnValue({
      available: true,
      desktopState: 'connected',
      desktopConnected: true,
      desktopLastSeen: reportedAt,
      statuses: {
        logs: { configured: true, state: 'watching', isLive: true, lastSeenAt: reportedAt },
        pings: { configured: true, state: 'watching', isLive: true, lastSeenAt: reportedAt },
      },
    })

    render(<MyQuests {...props} />)

    expect(screen.getByText('DESKTOP APP CONNECTED')).toBeInTheDocument()
    expect(screen.getByText('SCREENSHOT PINGS · OK')).toBeInTheDocument()
    expect(screen.getByText(/CONFIGURED IN DESKTOP APP · LAST REPORT JUST NOW/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'CHOOSE SCREENSHOTS' })).not.toBeInTheDocument()
  })
})
