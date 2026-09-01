import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { useEftScreenshotSyncContext, useCompanionSyncStatus } = vi.hoisted(() => ({
  useEftScreenshotSyncContext: vi.fn(),
  useCompanionSyncStatus: vi.fn(),
}))

vi.mock('../EftLogSyncContext', () => ({ useEftScreenshotSyncContext }))
vi.mock('../useCompanionSyncStatus', () => ({ useCompanionSyncStatus }))

import { RaidElapsed, ScreenshotSyncChip } from './RaidView'

describe('RaidElapsed', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('updates its elapsed label without re-rendering the squad rail', () => {
    const startedAt = Date.now()
    let railRenders = 0
    function SquadRailSpy() {
      railRenders += 1
      return <div data-testid="squad-rail">SQUAD</div>
    }

    render(<><RaidElapsed startedAt={startedAt} /><SquadRailSpy /></>)
    expect(screen.getByText('00:00 ELAPSED')).toBeInTheDocument()
    expect(railRenders).toBe(1)

    act(() => { vi.advanceTimersByTime(3000) })

    expect(screen.getByText('00:03 ELAPSED')).toBeInTheDocument()
    expect(railRenders).toBe(1)
  })
})

function screenshotController(overrides = {}) {
  return {
    supported: true,
    persistentSupported: true,
    state: 'idle',
    folderName: null,
    readyForPings: true,
    connect: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
}

function companionStatus(overrides = {}) {
  return {
    available: true,
    statuses: {
      pings: {
        configured: true,
        state: 'watching',
        isLive: true,
        lastSeenAt: new Date().toISOString(),
        ...overrides,
      },
    },
  }
}

describe('ScreenshotSyncChip', () => {
  beforeEach(() => {
    vi.mocked(useCompanionSyncStatus).mockReturnValue(null)
  })

  // This suite has no global auto-cleanup, so a render left standing is found
  // by the next test's queries.
  afterEach(cleanup)

  it('labels a screenshot chip backed only by the desktop companion', () => {
    vi.mocked(useCompanionSyncStatus).mockReturnValue(companionStatus())

    render(<ScreenshotSyncChip sync={screenshotController()} />)

    expect(screen.getByText('SCREENSHOTS · DESKTOP APP · CONNECTED')).toBeInTheDocument()
  })

  it('offers browser connection while idle, unless desktop pings are configured', () => {
    const sync = screenshotController()
    render(<ScreenshotSyncChip sync={sync} />)
    fireEvent.click(screen.getByRole('button', { name: 'CONNECT' }))
    expect(sync.connect).toHaveBeenCalledTimes(1)

    cleanup()
    vi.mocked(useCompanionSyncStatus).mockReturnValue(companionStatus())
    render(<ScreenshotSyncChip sync={screenshotController()} />)
    expect(screen.queryByRole('button', { name: 'CONNECT' })).not.toBeInTheDocument()
  })
})

describe('ScreenshotSyncChip source attribution', () => {
  beforeEach(() => {
    vi.mocked(useCompanionSyncStatus).mockReturnValue(null)
  })

  afterEach(cleanup)

  it('does not blame the desktop app when the companion has no screenshots folder', () => {
    vi.mocked(useCompanionSyncStatus).mockReturnValue(companionStatus({ configured: false, state: 'idle' }))

    const sync = screenshotController()
    render(<ScreenshotSyncChip sync={sync} />)

    expect(screen.getByText('SCREENSHOTS · NOT SET UP')).toBeInTheDocument()
    expect(screen.queryByText(/DESKTOP APP/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CONNECT' })).toBeInTheDocument()
  })

  it('still reports an unsupported browser when the companion is present but unconfigured', () => {
    vi.mocked(useCompanionSyncStatus).mockReturnValue(companionStatus({ configured: false, state: 'idle' }))

    render(<ScreenshotSyncChip sync={screenshotController({ supported: false, persistentSupported: false })} />)

    expect(screen.getByText('SCREENSHOTS · NOT SUPPORTED')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'CONNECT' })).not.toBeInTheDocument()
  })
})
