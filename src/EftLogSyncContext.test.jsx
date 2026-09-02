import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EftLogSyncProvider, useEftLogSync } from './EftLogSyncContext'

const taskState = vi.hoisted(() => ({ current: { tasks: [{ id: 'task-1' }], loading: false } }))
const logState = vi.hoisted(() => ({ current: { state: 'idle', supported: true } }))

vi.mock('./useTarkov', () => ({ useTasks: vi.fn(() => taskState.current) }))
vi.mock('./useEftLogImport', () => ({ useEftLogImport: vi.fn(() => logState.current) }))
vi.mock('./useEftScreenshotSync', () => ({ useEftScreenshotSync: vi.fn(() => ({ state: 'watching', supported: true })) }))

import { useTasks } from './useTarkov'
import { useEftLogImport } from './useEftLogImport'
import { useEftScreenshotSync } from './useEftScreenshotSync'

const mockUseTasks = vi.mocked(useTasks)
const mockUseEftLogImport = vi.mocked(useEftLogImport)
const mockUseEftScreenshotSync = vi.mocked(useEftScreenshotSync)

beforeEach(() => {
  taskState.current = { tasks: [{ id: 'task-1' }], loading: false }
  logState.current = { state: 'idle', supported: true }
  mockUseTasks.mockClear()
  mockUseEftLogImport.mockClear()
  mockUseEftScreenshotSync.mockClear()
})

afterEach(cleanup)

function Consumer() {
  const sync = useEftLogSync()
  return <output>{`${sync.allTasks.length}:${sync.state}`}</output>
}

describe('EftLogSyncProvider', () => {
  it('loads complete tasks and creates one controller for its signed-in lifetime', () => {
    const { rerender } = render(
      <EftLogSyncProvider userId="user-1" gameMode="regular" onApply={() => {}}>
        <Consumer />
      </EftLogSyncProvider>,
    )

    expect(screen.getByText('1:idle')).toBeInTheDocument()
    expect(mockUseTasks).toHaveBeenCalledWith(null, 'regular')
    expect(mockUseEftLogImport).toHaveBeenCalledTimes(1)
    expect(mockUseEftScreenshotSync).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }))

    rerender(
      <EftLogSyncProvider userId="user-1" gameMode="regular" onApply={() => {}}>
        <Consumer />
      </EftLogSyncProvider>,
    )
    expect(mockUseEftLogImport).toHaveBeenCalledTimes(2)
  })

  it('repairs names once when tasks arrive after the initial quest load', async () => {
    taskState.current = { tasks: [], loading: false }
    const onRepairRows = vi.fn().mockResolvedValue(1)
    const { rerender } = render(
      <EftLogSyncProvider userId="user-1" gameMode="regular" questsLoading={false} onApply={() => {}} onRepairRows={onRepairRows}>
        <Consumer />
      </EftLogSyncProvider>,
    )
    expect(onRepairRows).not.toHaveBeenCalled()

    taskState.current = { tasks: [{ id: 'task-1', name: 'Task One' }], loading: false }
    rerender(
      <EftLogSyncProvider userId="user-1" gameMode="regular" questsLoading={false} onApply={() => {}} onRepairRows={onRepairRows}>
        <Consumer />
      </EftLogSyncProvider>,
    )
    await waitFor(() => expect(onRepairRows).toHaveBeenCalledTimes(1))
    expect(onRepairRows).toHaveBeenCalledWith([{ id: 'task-1', name: 'Task One' }])
  })

  it('waits while the initial quest load is pending and does not re-fire on rerender', async () => {
    const onRepairRows = vi.fn().mockResolvedValue(1)
    const { rerender } = render(
      <EftLogSyncProvider userId="user-1" gameMode="regular" questsLoading={true} onApply={() => {}} onRepairRows={onRepairRows}>
        <Consumer />
      </EftLogSyncProvider>,
    )
    expect(onRepairRows).not.toHaveBeenCalled()

    rerender(
      <EftLogSyncProvider userId="user-1" gameMode="regular" questsLoading={false} onApply={() => {}} onRepairRows={onRepairRows}>
        <Consumer />
      </EftLogSyncProvider>,
    )
    await waitFor(() => expect(onRepairRows).toHaveBeenCalledTimes(1))
    rerender(
      <EftLogSyncProvider userId="user-1" gameMode="regular" questsLoading={false} onApply={() => {}} onRepairRows={onRepairRows}>
        <Consumer />
      </EftLogSyncProvider>,
    )
    expect(onRepairRows).toHaveBeenCalledTimes(1)
  })

  it('does not surface a failed repair to the provider consumer', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onRepairRows = vi.fn().mockRejectedValue(new Error('offline'))
    render(
      <EftLogSyncProvider userId="user-1" gameMode="regular" questsLoading={false} onApply={() => {}} onRepairRows={onRepairRows}>
        <Consumer />
      </EftLogSyncProvider>,
    )
    await waitFor(() => expect(onRepairRows).toHaveBeenCalledTimes(1))
    expect(screen.getByText('1:idle')).toBeInTheDocument()
    expect(warnSpy).toHaveBeenCalledWith('Quest row repair failed', expect.any(Error))
    warnSpy.mockRestore()
  })

  it('checks an opted-in remembered folder once when entering each party', async () => {
    const checkNow = vi.fn().mockResolvedValue({ changed: false })
    logState.current = {
      state: 'watching',
      supported: true,
      rememberedFolderName: 'Logs',
      checkNow,
    }
    const { rerender } = render(
      <EftLogSyncProvider userId="user-1" gameMode="regular" questPartyId="party-1" onApply={() => {}}>
        <Consumer />
      </EftLogSyncProvider>,
    )

    await waitFor(() => expect(checkNow).toHaveBeenCalledTimes(1))
    rerender(
      <EftLogSyncProvider userId="user-1" gameMode="regular" questPartyId="party-1" onApply={() => {}}>
        <Consumer />
      </EftLogSyncProvider>,
    )
    expect(checkNow).toHaveBeenCalledTimes(1)

    rerender(
      <EftLogSyncProvider userId="user-1" gameMode="regular" questPartyId="party-2" onApply={() => {}}>
        <Consumer />
      </EftLogSyncProvider>,
    )
    await waitFor(() => expect(checkNow).toHaveBeenCalledTimes(2))
  })

  it('does not auto-check a remembered folder when automatic sync is off', () => {
    const checkNow = vi.fn()
    logState.current = {
      state: 'idle',
      supported: true,
      rememberedFolderName: 'Logs',
      checkNow,
    }
    render(
      <EftLogSyncProvider userId="user-1" gameMode="regular" questPartyId="party-1" onApply={() => {}}>
        <Consumer />
      </EftLogSyncProvider>,
    )
    expect(checkNow).not.toHaveBeenCalled()
  })
})
