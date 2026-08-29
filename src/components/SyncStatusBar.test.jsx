import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../EftLogSyncContext', () => ({
  useEftLogSync: vi.fn(),
  useEftScreenshotSyncContext: vi.fn(),
}))
vi.mock('../useCompanionSyncStatus', () => ({
  useCompanionSyncStatus: vi.fn(),
}))

import { useEftLogSync, useEftScreenshotSyncContext } from '../EftLogSyncContext'
import { useCompanionSyncStatus } from '../useCompanionSyncStatus'
import SyncStatusBar from './SyncStatusBar'

const logCheckNow = vi.fn()
const logReconnect = vi.fn()
const logForget = vi.fn()
const shotCheckNow = vi.fn()
const shotConnect = vi.fn()
const shotForget = vi.fn()

function logController(overrides = {}) {
  return {
    supported: true,
    persistentSupported: true,
    state: 'watching',
    error: null,
    rememberedFolderName: 'EFT Logs',
    lastSuccessfulCheck: new Date().toISOString(),
    pendingJob: null,
    checkNow: logCheckNow,
    reconnectRememberedFolder: logReconnect,
    forgetFolder: logForget,
    ...overrides,
  }
}

function shotController(overrides = {}) {
  return {
    supported: true,
    persistentSupported: true,
    readyForPings: true,
    state: 'watching',
    error: null,
    folderName: 'EFT Screenshots',
    rememberedFolderName: 'EFT Screenshots',
    lastSuccessfulCheck: new Date().toISOString(),
    lastScreenshot: null,
    pending: 0,
    lastPing: null,
    checkNow: shotCheckNow,
    connect: shotConnect,
    reconnect: shotConnect,
    forget: shotForget,
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(useEftLogSync).mockReturnValue(logController())
  vi.mocked(useEftScreenshotSyncContext).mockReturnValue(shotController())
  vi.mocked(useCompanionSyncStatus).mockReturnValue(null)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SyncStatusBar', () => {
  it('keeps exactly one popover open at a time', () => {
    render(<SyncStatusBar onMyQuests={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Quest log sync/ }))
    expect(screen.getByRole('dialog', { name: 'LOGS SYNC' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Screenshot sync/ }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'PINGS SYNC' })).toBeInTheDocument()
  })

  it('closes on Escape and restores focus to the opener', () => {
    render(<SyncStatusBar onMyQuests={vi.fn()} />)
    const opener = screen.getByRole('button', { name: /Quest log sync/ })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('closes on an outside click', () => {
    render(<SyncStatusBar onMyQuests={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Quest log sync/ }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders only folder names, never path separators from folder fixtures', () => {
    vi.mocked(useEftLogSync).mockReturnValue(logController({ rememberedFolderName: String.raw`C:\Users\jay\EFT\Logs` }))
    vi.mocked(useEftScreenshotSyncContext).mockReturnValue(shotController({ folderName: String.raw`D:/Games/Tarkov/Screenshots` }))
    render(<SyncStatusBar onMyQuests={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /Quest log sync/ }))
    expect(screen.getByRole('dialog').textContent).not.toMatch(/[\\/]/)
    fireEvent.click(screen.getByRole('button', { name: /Screenshot sync/ }))
    expect(screen.getByRole('dialog').textContent).not.toMatch(/[\\/]/)
  })
  it('does not claim screenshot pings are flowing without an active party map', () => {
    vi.mocked(useEftScreenshotSyncContext).mockReturnValue(shotController({ readyForPings: false }))
    render(<SyncStatusBar onMyQuests={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Screenshot sync/ }))
    expect(screen.getByRole('dialog').textContent).toMatch(/pings need an active party map/i)
  })

  it('expands details inline when embedded in the room overflow', () => {
    render(<SyncStatusBar embedded onMyQuests={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Quest log sync/ }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'LOGS SYNC' })).toBeInTheDocument()
  })

  it('labels fresh companion heartbeats as connected', () => {
    const updatedAt = new Date().toISOString()
    vi.mocked(useCompanionSyncStatus).mockReturnValue({
      available: true,
      statuses: {
        logs: { configured: true, state: 'watching', detail: 'Sync up to date', updatedAt },
        pings: { configured: true, state: 'watching', detail: 'Sync up to date', updatedAt },
      },
    })
    render(<SyncStatusBar onMyQuests={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Quest log sync: connected/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Screenshot sync: connected/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Local sync monitor: connected/ })).toBeInTheDocument()
  })
})
