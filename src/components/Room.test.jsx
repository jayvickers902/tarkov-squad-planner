import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The party view is a layout, not a data layer: everything that talks to the
// network or the filesystem is stubbed so these tests can assert the header,
// the map selector and the objective rows actually render for a real party.
vi.mock('../useTarkov', () => ({
  useMaps: () => ({ maps: MAPS, loading: false }),
  useTasks: () => ({ tasks: TASKS, loading: false }),
  useExtracts: () => ({ extracts: [] }),
}))
vi.mock('../useEphemeralSweep', () => ({ default: () => {} }))
vi.mock('../useQuestShareOverrides', () => ({ useQuestShareOverrides: () => ({ overrides: {} }) }))
vi.mock('../EftLogSyncContext', () => ({
  useEftLogSync: () => null,
  useEftScreenshotSyncContext: () => null,
}))
vi.mock('../useCompanionSyncStatus', () => ({ useCompanionSyncStatus: () => null }))

const MAPS = [
  { id: 'map-woods', name: 'Woods', normalizedName: 'woods' },
  { id: 'map-customs', name: 'Customs', normalizedName: 'customs' },
  { id: 'map-streets', name: 'Streets of Tarkov', normalizedName: 'streets-of-tarkov' },
]

const WOODS = { id: 'map-woods', name: 'Woods', normalizedName: 'woods' }
const STREETS = { id: 'map-streets', name: 'Streets of Tarkov', normalizedName: 'streets-of-tarkov' }

const TASKS = [
  {
    id: 'task-punisher',
    name: 'The Punisher — Part 1',
    map: WOODS,
    wikiLink: '',
    objectives: [
      { id: 'obj-kill', description: 'Eliminate 12 Scavs at the Sawmill', type: 'shoot', maps: [WOODS], zones: [{ id: 'z1', map: WOODS, position: { x: 1, y: 2, z: 3 } }] },
    ],
  },
  {
    id: 'task-signal',
    name: 'Signal — Part 1',
    map: WOODS,
    wikiLink: '',
    objectives: [
      { id: 'obj-visit', description: 'Locate the intercepted transmission point', type: 'visit', maps: [WOODS], zones: [{ id: 'z2', map: WOODS, position: { x: 4, y: 5, z: 6 } }] },
    ],
  },
  {
    id: 'task-streets',
    name: 'Urban Medicine',
    map: STREETS,
    wikiLink: '',
    objectives: [],
  },
]

const { default: Room } = await import('./Room')

function makeParty(overrides = {}) {
  return {
    code: '8QEJ4C',
    leader_id: 'user-1',
    map_id: 'map-woods',
    map_name: 'Woods',
    map_norm: 'woods',
    progress: {},
    starred: {},
    drawings: [],
    markers: [],
    pings: [],
    settings: {},
    members: [
      { user_id: 'user-1', callsign: 'SHRIKE', quests: [{ id: 'task-punisher' }, { id: 'task-signal' }], quests_all: [{ id: 'task-punisher' }, { id: 'task-signal' }] },
      { user_id: 'user-2', callsign: 'BOOTS', quests: [{ id: 'task-punisher' }], quests_all: [{ id: 'task-punisher' }] },
    ],
    ...overrides,
  }
}

function renderRoom(overrides = {}) {
  const props = {
    party: makeParty(overrides.party),
    myUserId: 'user-1',
    myName: 'SHRIKE',
    isAdmin: false,
    questsLoading: false,
    gameMode: 'regular',
    onlineMemberIds: ['user-1'],
    presenceReady: true,
    userSettings: {},
    userObjProgress: {},
    friends: [],
    pendingIn: [],
    pendingOut: [],
    onLeave: vi.fn(),
    onSelectMap: vi.fn(),
    onToggleStar: vi.fn(),
    onAddStroke: vi.fn(),
    onClearMyStrokes: vi.fn(),
    onAddMarker: vi.fn(),
    onClearMyMarkers: vi.fn(),
    onAddPing: vi.fn(),
    onClearPings: vi.fn(),
    onMyQuests: vi.fn(),
    onAdmin: vi.fn(),
    onSubmitProgress: vi.fn(),
    onQuestComplete: vi.fn(),
    onSetUserSetting: vi.fn(),
    onSetRaidSettings: vi.fn(),
    onSweepEphemeral: vi.fn(),
    onSendRequest: vi.fn(),
    onAcceptRequest: vi.fn(),
    onRemoveRequest: vi.fn(),
    onRemoveFriend: vi.fn(),
    onRefreshFriends: vi.fn(),
    onRefresh: vi.fn(),
    onStartRaid: vi.fn(),
    onOpenRaid: vi.fn(),
    onCloseRaid: vi.fn(),
    ...overrides.props,
  }
  return { props, ...render(<Room {...props} />) }
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.useRealTimers(); cleanup() })

describe('Room banner header', () => {
  it('burns the party identity and squad readout into the map art', () => {
    const { container } = renderRoom()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('WOODS')
    expect(screen.getByText('8QEJ4C')).toBeInTheDocument()
    expect(screen.getByText('REGULAR')).toBeInTheDocument()
    expect(container.querySelector('.room-banner-readout')).toHaveTextContent('2 OPERATORS · 1 ONLINE · 2 QUESTS ON MAP')
  })

  it('paints the selected map as the banner background', () => {
    const { container } = renderRoom()
    const live = container.querySelector('.room-banner-layer-live')
    expect(live.style.backgroundImage).toContain('/map-banners/header/woods.webp')
    // A map with no wide banner yet falls through to the reference art below it.
    expect(live.style.backgroundImage).toContain('/map-banners/reference/woods.webp')
  })

  it('counts the live squad on START RAID for the leader only', () => {
    renderRoom()
    expect(screen.getByRole('button', { name: /START RAID/ })).toHaveTextContent('2 IN SQUAD')

    cleanup()
    renderRoom({ props: { myUserId: 'user-2', myName: 'BOOTS' } })
    expect(screen.queryByRole('button', { name: /START RAID/ })).not.toBeInTheDocument()
  })

  it('opens raid settings as an anchored popover and closes it on an outside click', () => {
    const { container } = renderRoom()
    const gear = screen.getByRole('button', { name: 'Raid settings' })
    expect(gear).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(gear)
    expect(gear).toHaveAttribute('aria-expanded', 'true')
    // Anchored to the gear, not injected into the page flow.
    expect(container.querySelector('.room-settings-anchor .raid-settings-popover')).toBeInTheDocument()

    fireEvent.mouseDown(document.body)
    expect(container.querySelector('.raid-settings-popover')).not.toBeInTheDocument()
  })

  it('provides accessible help for every raid setting', () => {
    renderRoom()
    fireEvent.click(screen.getByRole('button', { name: 'Raid settings' }))

    const helpButtons = screen.getAllByRole('button', { name: /^About / })
    expect(helpButtons).toHaveLength(6)

    const pingHelp = screen.getByRole('button', { name: 'About PING TTL' })
    const descriptionId = pingHelp.getAttribute('aria-describedby')
    expect(document.getElementById(descriptionId)).toHaveTextContent('How long a squad ping stays on the map')
  })
})

describe('Room map selector', () => {
  it('renders one art thumbnail per map and marks the active one', () => {
    const { container } = renderRoom()
    const thumbs = container.querySelectorAll('.room-map-thumb')
    expect(thumbs).toHaveLength(3)

    const woods = screen.getByRole('button', { name: 'WOODS' })
    expect(woods).toHaveAttribute('aria-pressed', 'true')
    expect(woods.querySelector('.room-map-thumb-art').style.backgroundImage).toContain('/map-banners/reference/woods.webp')
    expect(screen.getByRole('button', { name: 'CUSTOMS' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('uses the compact Streets label in the selector and recommendations only', () => {
    const { container } = renderRoom({
      party: {
        members: [
          { user_id: 'user-1', callsign: 'SHRIKE', quests: [], quests_all: [{ id: 'task-streets' }] },
        ],
      },
    })

    expect(screen.getByRole('button', { name: 'STREETS' })).toBeInTheDocument()
    expect([...container.querySelectorAll('.room-map-thumb-name')].map(node => node.textContent)).toContain('STREETS')
    expect(screen.getAllByText('STREETS')).toHaveLength(2)
    expect(screen.queryByText('STREETS OF TARKOV')).not.toBeInTheDocument()
  })

  it('switches maps directly when the party has no plan to lose', () => {
    const { props } = renderRoom()
    fireEvent.click(screen.getByRole('button', { name: 'CUSTOMS' }))
    expect(props.onSelectMap).toHaveBeenCalledWith(expect.objectContaining({ id: 'map-customs' }))
  })

  it('confirms before a map change wipes the squad plan', () => {
    const { props } = renderRoom({ party: { markers: [{ id: 'm1' }] } })

    fireEvent.click(screen.getByRole('button', { name: 'CUSTOMS' }))
    expect(props.onSelectMap).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'CHANGE MAP?' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'CHANGE MAP' }))
    expect(props.onSelectMap).toHaveBeenCalledWith(expect.objectContaining({ id: 'map-customs' }))
  })

  it('leaves the selector alone for a member who cannot change the map', () => {
    renderRoom({ props: { myUserId: 'user-2', myName: 'BOOTS' } })
    expect(screen.getByRole('button', { name: 'CUSTOMS' })).toBeDisabled()
    expect(screen.getByText('MAP — SET BY LEADER')).toBeInTheDocument()
  })
})

describe('Room squad objectives', () => {
  it('rails each objective row in its quest colour and stripes the list', () => {
    const { container } = renderRoom()
    const rows = container.querySelectorAll('.obj-row')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].getAttribute('data-stripe')).toBe('odd')
    expect(rows[0].style.borderLeftColor).not.toBe('')

    // Rows from the same quest share a rail; different quests do not.
    const swatches = [...container.querySelectorAll('.obj-pill-swatch')].map(node => node.style.background)
    expect(new Set(swatches).size).toBeGreaterThan(1)
  })

  it('badges an objective more than one member needs', () => {
    const { container } = renderRoom()
    const shared = container.querySelector('.obj-pill-shared')
    expect(shared).toHaveTextContent('×2 SHARED')

    const sharedRow = shared.closest('.obj-row')
    expect(within(sharedRow).getAllByText(/SHRIKE|BOOTS/)).toHaveLength(2)
  })
})
