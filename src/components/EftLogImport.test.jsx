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
    await waitFor(() => expect(confirmImport).toHaveBeenCalledWith({ autoSync: false, remember: false }))
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
    expect(screen.getByRole('button', { name: 'IMPORT LOG FILES ONCE' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'SHOW IMPORT NOTES' }))
    // parseErrors is a count, not an array; reading `.length` always showed 0.
    expect(screen.getByText(/3 MALFORMED RECORDS SKIPPED/)).toBeInTheDocument()
    expect(screen.getByText(/507f1f77bcf86cd799439012/)).toBeInTheDocument()

    fireEvent.click(screen.getByText(/3 MALFORMED RECORDS SKIPPED/))
    expect(screen.getByText('notifications.log · LINE 12')).toBeInTheDocument()
    expect(screen.getByText('notifications.log · LINE 15')).toBeInTheDocument()
  })

  it('captures an undo point before applying and returns a structured receipt', async () => {
    const onImportStart = vi.fn().mockResolvedValue(undefined)
    const onImportComplete = vi.fn()
    confirmImport.mockResolvedValueOnce({ inserted: 1, updated: 0, ignored: 0, affected_task_ids: [taskId] })
    render(
      <EftLogImport
        sync={sync}
        allTasks={[{ id: taskId, name: 'Synthetic Task' }]}
        gameMode="regular"
        userId="user-1"
        onApply={vi.fn()}
        onImportStart={onImportStart}
        onImportComplete={onImportComplete}
        defaultOpen
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM IMPORT' }))
    await waitFor(() => expect(onImportComplete).toHaveBeenCalledWith(expect.objectContaining({
      source: 'logs',
      questIds: [taskId],
      applied: 1,
      states: { active: 1, failed: 0, completed: 0 },
      syncEnabled: false,
    })))
    expect(onImportStart.mock.invocationCallOrder[0]).toBeLessThan(confirmImport.mock.invocationCallOrder.at(-1))
  })
})
