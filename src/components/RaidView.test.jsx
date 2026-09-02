import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { useEftScreenshotSyncContext, useEftLogSync, useCompanionSyncStatus } = vi.hoisted(() => ({
  useEftScreenshotSyncContext: vi.fn(),
  useEftLogSync: vi.fn(),
  useCompanionSyncStatus: vi.fn(),
}))

vi.mock('../EftLogSyncContext', () => ({ useEftScreenshotSyncContext, useEftLogSync }))
vi.mock('../useCompanionSyncStatus', () => ({ useCompanionSyncStatus }))

// The camera suite renders the whole page, so the map, the two panels and every
// upstream data hook are stubbed out. They are not what is under test here.
const { useMapPings, mapProps } = vi.hoisted(() => ({
  useMapPings: vi.fn(),
  mapProps: { current: null },
}))

vi.mock('./MapLeaflet', () => ({
  default: props => {
    mapProps.current = props
    return <div data-testid="map" />
  },
}))
vi.mock('./RaidRail', () => ({ default: () => <div data-testid="rail" /> }))
vi.mock('./MyTasksPanel', () => ({ default: () => <div data-testid="tasks" /> }))
vi.mock('../useMapPings', () => ({ useMapPings }))
vi.mock('../useMapKeys', () => ({ useMapKeys: () => ({ mapKeys: [], loading: false }) }))
vi.mock('../useIntel', () => ({ useIntel: () => ({ intelPoints: [], loading: false }) }))
vi.mock('../useMapLoot', () => ({ useMapLoot: () => ({ lootRows: [], loading: false }) }))
vi.mock('../useIntelChecklist', () => ({ useIntelChecklist: () => ({ isChecked: () => false }) }))
vi.mock('../usePmcSpawns', () => ({ usePmcSpawns: () => ({}) }))
vi.mock('../useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../useRaidDebrief', () => ({ useRaidDebrief: () => ({ debrief: null, recheck: vi.fn() }) }))
vi.mock('../useTarkov', () => ({
  useBossSpawns: () => ({ getBossesForMap: () => [], loading: false }),
  useExtracts: () => ({ extracts: [] }),
}))

import RaidView, { QuestLogDebriefChip, RaidElapsed, ScreenshotSyncChip } from './RaidView'
import { CAMERA_MODE_STORAGE_KEY } from '../cameraMode'

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

describe('QuestLogDebriefChip', () => {
  afterEach(() => cleanup())

  it('renders nothing before a debrief check has run', () => {
    const { container } = render(<QuestLogDebriefChip outcome={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('reports the completions a post-raid check applied', () => {
    render(<QuestLogDebriefChip outcome={{ state: 'applied', tone: 'live', label: '2 COMPLETED' }} />)
    expect(screen.getByText(/QUEST LOGS/)).toHaveTextContent('2 COMPLETED')
  })

  // CHECK AGAIN during a scan would only queue a duplicate promise against
  // runFolderCheck's single flight, so the chip does not offer it.
  it('offers no retry while the check is still running', () => {
    render(<QuestLogDebriefChip outcome={{ state: 'checking', tone: 'idle', label: 'CHECKING' }} onRecheck={() => {}} />)
    expect(screen.queryByRole('button', { name: 'CHECK AGAIN' })).toBeNull()
  })

  it('retries a failed check on request', () => {
    const onRecheck = vi.fn()
    render(<QuestLogDebriefChip outcome={{ state: 'failed', tone: 'warning', label: 'CHECK DID NOT FINISH' }} onRecheck={onRecheck} />)
    fireEvent.click(screen.getByRole('button', { name: 'CHECK AGAIN' }))
    expect(onRecheck).toHaveBeenCalledTimes(1)
  })
})

// --- Camera --------------------------------------------------------------
const MY_PING = { id: 'p1', user_id: 'me', user: 'ME', x: 10, z: 20, at: Date.now(), taps: 1 }

function pingState({ pingList = [] } = {}) {
  return {
    replay: null,
    setReplay: vi.fn(),
    replayData: null,
    canReplay: false,
    replayOn: false,
    pingList,
    replayTrails: [],
    pingCards: [],
    echoCards: [],
    lastKnownCards: [],
    pingAnnouncement: null,
    dismissPingAnnouncement: vi.fn(),
    pausePingAnnouncement: vi.fn(),
    pingSig: '',
  }
}

function renderRaid({ live = true, pings = [MY_PING] } = {}) {
  const party = {
    code: 'ABC123',
    map_id: 'customs',
    map_norm: 'customs',
    map_name: 'Customs',
    members: [],
    drawings: [],
    markers: [],
    pings,
    starred: {},
    settings: {},
    progress: live ? { __raid_start__: Date.now() } : {},
  }
  vi.mocked(useMapPings).mockReturnValue(pingState({ pingList: pings }))
  return render(
    <RaidView
      party={party}
      myUserId="me"
      myName="ME"
      members={[{ user_id: 'me', name: 'ME', quests: [] }]}
      tasks={[]}
      allTasks={[]}
      loadingTasks={false}
      onClose={vi.fn()}
      onStartRaid={vi.fn()}
      onSetSetting={vi.fn()}
      onRaidError={vi.fn()}
      onSubmitProgress={vi.fn()}
    />,
  )
}

describe('RaidView camera', () => {
  beforeEach(() => {
    vi.mocked(useEftScreenshotSyncContext).mockReturnValue(null)
    vi.mocked(useEftLogSync).mockReturnValue(null)
    vi.mocked(useCompanionSyncStatus).mockReturnValue(null)
    window.localStorage.setItem(CAMERA_MODE_STORAGE_KEY, 'follow')
  })

  afterEach(() => {
    cleanup()
    mapProps.current = null
    window.localStorage.removeItem(CAMERA_MODE_STORAGE_KEY)
    vi.clearAllMocks()
  })

  // A1: one OVERVIEW click used to store ALERTS, and ALERTS skips your own pings
  // and single-tap pings, so the camera never moved for a position ping again.
  it('demotes FOLLOW for this sitting without storing the demotion', () => {
    renderRaid()
    expect(mapProps.current.autofocusMode).toBe('follow')

    fireEvent.click(screen.getByLabelText('More camera modes'))
    fireEvent.click(screen.getByText('⌘ OVERVIEW'))

    expect(mapProps.current.autofocusMode).toBe('alerts')
    expect(screen.getByText('ALERTS')).toHaveAttribute('aria-pressed', 'true')
    expect(window.localStorage.getItem(CAMERA_MODE_STORAGE_KEY)).toBe('follow')
  })

  it('ends the demotion when the reader picks a mode, and stores that', () => {
    renderRaid()
    fireEvent.click(screen.getByLabelText('More camera modes'))
    fireEvent.click(screen.getByText('⌘ OVERVIEW'))
    expect(mapProps.current.autofocusMode).toBe('alerts')

    fireEvent.click(screen.getByText('FOLLOW'))

    expect(mapProps.current.autofocusMode).toBe('follow')
    expect(window.localStorage.getItem(CAMERA_MODE_STORAGE_KEY)).toBe('follow')

    fireEvent.click(screen.getByText('ALL'))
    expect(window.localStorage.getItem(CAMERA_MODE_STORAGE_KEY)).toBe('all')
  })

  // A3: the map's own OVERVIEW button reaches the same session-scoped demotion.
  it('takes the same demotion from the map toolbar overview button', () => {
    renderRaid()
    act(() => { mapProps.current.onCameraDemote() })
    expect(mapProps.current.autofocusMode).toBe('alerts')
    expect(window.localStorage.getItem(CAMERA_MODE_STORAGE_KEY)).toBe('follow')
  })
})

describe('CENTRE ON ME', () => {
  beforeEach(() => {
    vi.mocked(useEftScreenshotSyncContext).mockReturnValue(null)
    vi.mocked(useEftLogSync).mockReturnValue(null)
    vi.mocked(useCompanionSyncStatus).mockReturnValue(null)
  })

  afterEach(() => {
    cleanup()
    mapProps.current = null
    vi.clearAllMocks()
  })

  it('asks the map to re-centre on every click, same ping or not', () => {
    renderRaid()
    const button = screen.getByRole('button', { name: /centre on me/i })
    expect(button).toBeEnabled()

    const before = mapProps.current.centreMeNonce
    fireEvent.click(button)
    expect(mapProps.current.centreMeNonce).toBe(before + 1)
    fireEvent.click(button)
    expect(mapProps.current.centreMeNonce).toBe(before + 2)
  })

  it('centres on the C key, and leaves Ctrl+C to the browser', () => {
    renderRaid()
    const before = mapProps.current.centreMeNonce

    fireEvent.keyDown(window, { key: 'c' })
    expect(mapProps.current.centreMeNonce).toBe(before + 1)

    // Every letter shortcut on this page collides with a browser one, and the
    // party code is right there in the header waiting to be copied.
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'c', metaKey: true })
    expect(mapProps.current.centreMeNonce).toBe(before + 1)
  })

  it('stays visible but disabled in a live raid with no ping yet', () => {
    renderRaid({ pings: [] })
    expect(screen.getByRole('button', { name: /centre on me/i })).toBeDisabled()
  })

  it('is absent in PLAN with nothing to centre on', () => {
    renderRaid({ live: false, pings: [] })
    expect(screen.queryByRole('button', { name: /centre on me/i })).toBeNull()
  })

  it('is offered in PLAN when a ping is still live', () => {
    renderRaid({ live: false })
    expect(screen.getByRole('button', { name: /centre on me/i })).toBeEnabled()
  })
})
