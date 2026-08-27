import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EftLogSyncProvider, useEftLogSync } from './EftLogSyncContext'

vi.mock('./useTarkov', () => ({ useTasks: vi.fn(() => ({ tasks: [{ id: 'task-1' }], loading: false })) }))
vi.mock('./useEftLogImport', () => ({ useEftLogImport: vi.fn(() => ({ state: 'idle', supported: true })) }))
vi.mock('./useEftScreenshotSync', () => ({ useEftScreenshotSync: vi.fn(() => ({ state: 'watching', supported: true })) }))

import { useTasks } from './useTarkov'
import { useEftLogImport } from './useEftLogImport'
import { useEftScreenshotSync } from './useEftScreenshotSync'

const mockUseTasks = vi.mocked(useTasks)
const mockUseEftLogImport = vi.mocked(useEftLogImport)
const mockUseEftScreenshotSync = vi.mocked(useEftScreenshotSync)

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
})
