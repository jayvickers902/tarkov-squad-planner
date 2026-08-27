import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EftLogImport from './EftLogImport'

const taskId = '507f1f77bcf86cd799439011'
const parseSelectedFiles = vi.fn()
const confirmImport = vi.fn().mockResolvedValue({ inserted: 1, updated: 2, ignored: 4 })
const hookState = {
  supported: true,
  persistentSupported: false,
  state: 'preview',
  preview: {
    filesScanned: 2,
    filesParsed: 2,
    parseErrors: 3,
    availableVersions: ['0.16'],
    includedVersions: ['0.16'],
    discoveredProfiles: [],
    events: [
      { eventKey: 'known', taskId, state: 'active', occurredAt: '2026-08-25T00:00:00Z', gameMode: 'regular', profileKey: null, version: '0.16' },
      { eventKey: 'unknown', taskId: '507f1f77bcf86cd799439012', state: 'completed', occurredAt: '2026-08-25T01:00:00Z', gameMode: 'regular', profileKey: null, version: '0.16' },
    ],
    unmatchedTaskIds: ['507f1f77bcf86cd799439012'],
    unmatchedTaskDetails: [{
      taskId: '507f1f77bcf86cd799439012',
      occurrences: 1,
      states: ['completed'],
      versions: ['0.16'],
      lastSeen: '2026-08-25T01:00:00.000Z',
    }],
    malformedRecords: [
      { file: 'notifications.log', line: 12, reason: 'INVALID JSON RECORD' },
      { file: 'notifications.log', line: 15, reason: 'TRUNCATED JSON RECORD' },
    ],
    ambiguousModeEvents: 0,
  },
}

const sync = {
  ...hookState,
  parseSelectedFiles,
  connectRememberedFolder: vi.fn(),
  reconnectRememberedFolder: vi.fn(),
  setIncludedVersions: vi.fn(),
  setProfileSelection: vi.fn(),
  setUnknownModeTarget: vi.fn(),
  confirmImport,
  forgetFolder: vi.fn(),
  reset: vi.fn(),
  checkNow: vi.fn(),
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EftLogImport', () => {
  it('opens a local-only preview and confirms only known task changes', async () => {
    render(<EftLogImport sync={sync} allTasks={[{ id: taskId, name: 'Synthetic Task' }]} gameMode="regular" userId="user-1" onApply={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'IMPORT EFT LOGS' }))

    expect(screen.getByText(/RAW LOGS ARE NEVER UPLOADED/)).toBeInTheDocument()
    expect(screen.getByText('Synthetic Task')).toBeInTheDocument()
    expect(screen.queryByText('UNKNOWN TASK')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM IMPORT' }))
    // CONFIRM IMPORT is the reviewed, one-shot path: it must never authorise
    // later unreviewed writes on its own.
    await waitFor(() => expect(confirmImport).toHaveBeenCalledWith({ autoSync: false }))
  })

  it('reports the counts the reconciliation RPC actually returns', async () => {
    render(<EftLogImport sync={sync} allTasks={[{ id: taskId, name: 'Synthetic Task' }]} gameMode="regular" userId="user-1" onApply={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'IMPORT EFT LOGS' }))
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM IMPORT' }))

    // inserted + updated, not a `changed`/`affected` field the RPC never sends.
    await waitFor(() => expect(screen.getByText(/APPLIED 3 QUEST STATES\./)).toBeInTheDocument())
    expect(screen.getByText(/4 ALREADY UP TO DATE\./)).toBeInTheDocument()
  })

  it('shows the malformed-record count and a plain file fallback', () => {
    render(<EftLogImport sync={sync} allTasks={[{ id: taskId, name: 'Synthetic Task' }]} gameMode="regular" userId="user-1" onApply={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'IMPORT EFT LOGS' }))

    // A directory picker that returns no relative paths still needs a way in.
    expect(screen.getByRole('button', { name: 'CHOOSE LOG FILES INSTEAD' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'SHOW IMPORT NOTES' }))
    // parseErrors is a count, not an array; reading `.length` always showed 0.
    expect(screen.getByText(/3 MALFORMED RECORDS SKIPPED/)).toBeInTheDocument()
    expect(screen.getByText(/507f1f77bcf86cd799439012/)).toBeInTheDocument()

    fireEvent.click(screen.getByText(/3 MALFORMED RECORDS SKIPPED/))
    expect(screen.getByText('notifications.log · LINE 12')).toBeInTheDocument()
    expect(screen.getByText('notifications.log · LINE 15')).toBeInTheDocument()
  })

  it('offers keep-in-sync only where a watchable folder handle exists', () => {
    render(<EftLogImport sync={sync} allTasks={[{ id: taskId, name: 'Synthetic Task' }]} gameMode="regular" userId="user-1" onApply={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'IMPORT EFT LOGS' }))

    // Universal-picker imports can never watch, so promising it would strand
    // the reader on a setting the hook silently refuses.
    expect(screen.queryByRole('button', { name: 'CONFIRM & KEEP IN SYNC' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /AUTO-APPLY/ })).not.toBeInTheDocument()
  })

  it('takes the unreviewed-writes opt-in beside the changes it governs', async () => {
    const connected = { ...sync, persistentSupported: true, rememberedFolderName: 'Logs' }
    render(<EftLogImport sync={connected} allTasks={[{ id: taskId, name: 'Synthetic Task' }]} gameMode="regular" userId="user-1" onApply={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'OPEN' }))

    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM & KEEP IN SYNC' }))
    await waitFor(() => expect(confirmImport).toHaveBeenCalledWith({ autoSync: true }))
  })

  it('exposes auto-apply as one switch on the connected folder', () => {
    const setAutoSync = vi.fn()
    const connected = { ...sync, persistentSupported: true, rememberedFolderName: 'Logs', autoSync: true, setAutoSync }
    render(<EftLogImport sync={connected} allTasks={[{ id: taskId, name: 'Synthetic Task' }]} gameMode="regular" userId="user-1" onApply={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'OPEN' }))

    const toggle = screen.getByRole('button', { name: 'AUTO-APPLY ON' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    expect(setAutoSync).toHaveBeenCalledWith(false)
  })

  it('shows a connected folder its state without opening the panel', () => {
    const connected = { ...sync, persistentSupported: true, rememberedFolderName: 'Logs', state: 'watching', autoSync: true }
    render(<EftLogImport sync={connected} allTasks={[{ id: taskId, name: 'Synthetic Task' }]} gameMode="regular" userId="user-1" onApply={vi.fn()} />)

    expect(screen.getByText(/LOCAL QUEST LOGS · AUTO-APPLY ON/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'IMPORT EFT LOGS' })).not.toBeInTheDocument()
  })
})
