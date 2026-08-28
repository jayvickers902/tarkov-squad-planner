import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RELEASE_VERSION, RELEASES } from './whatsNew'
import { WELCOME_SETTINGS_KEY } from './welcome'

// These tests drive App's welcome gating, not its data layer. Every hook that
// touches the network is stubbed through a mutable ref so each test can set the
// exact auth/settings shape the gate is supposed to react to.
const authState = { current: {} }
const settingsState = { current: {} }
const partyState = { current: {} }

vi.mock('./useAuth', () => ({ useAuth: () => authState.current }))
vi.mock('./useSettings', () => ({ useSettings: () => settingsState.current }))
vi.mock('./useParty', () => ({ useParty: () => partyState.current }))
vi.mock('./useRaidSession', () => ({ useRaidSession: () => null }))
vi.mock('./useUserQuests', () => ({
  useUserQuests: () => ({
    quests: [], loading: false,
    addQuest: vi.fn(), removeQuest: vi.fn(), bulkAddQuests: vi.fn(),
    toggleImportant: vi.fn(), toggleSkipped: vi.fn(), clearAllQuests: vi.fn(),
    restoreSnapshot: vi.fn(), markCompleted: vi.fn(), saveObjectiveProgress: vi.fn(),
    reconcileLogEvents: vi.fn(), getQuestHistory: vi.fn().mockResolvedValue([]),
  }),
}))
vi.mock('./useFriends', () => ({
  useFriends: () => ({
    friends: [], pendingIn: [], pendingOut: [], error: '',
    sendRequest: vi.fn(), acceptRequest: vi.fn(), removeRequest: vi.fn(),
    removeFriend: vi.fn(), refresh: vi.fn(),
  }),
}))

vi.mock('./components/AuthScreen', () => ({ default: () => <div>AUTH SCREEN</div> }))
vi.mock('./components/Room', () => ({ default: () => <div>ROOM</div> }))
vi.mock('./components/MyQuests', () => ({ default: () => <div>QUEST MANAGER</div> }))
vi.mock('./components/Lobby', () => ({
  default: ({ onOpenGuide }) => (
    <div>
      LOBBY
      <button onClick={onOpenGuide}>GUIDE</button>
    </div>
  ),
}))

const { default: App } = await import('./App')

const USER = { id: 'user-1' }
const PROFILE = { id: 'user-1', callsign: 'DUDGY', is_admin: false }

function setAuth(overrides = {}) {
  authState.current = {
    user: USER, profile: PROFILE, profileError: '', loading: false,
    error: '', setError: vi.fn(), logout: vi.fn(),
    loginWithGoogle: vi.fn(), createProfile: vi.fn(), isNewProfile: false,
    ...overrides,
  }
}

function setSettings(settings, { loading = false, setSetting } = {}) {
  settingsState.current = {
    settings,
    loading,
    setSetting: setSetting || vi.fn().mockResolvedValue(settings),
  }
  return settingsState.current.setSetting
}

function setParty(overrides = {}) {
  partyState.current = {
    party: null, myName: '', error: '', loading: false, autoRejoinSettled: true,
    createParty: vi.fn(), joinParty: vi.fn().mockResolvedValue(null), forceJoinParty: vi.fn(),
    selectMap: vi.fn(), addQuest: vi.fn(), removeQuest: vi.fn(), setSpawn: vi.fn(),
    toggleStar: vi.fn(), submitMyProgress: vi.fn(),
    addStroke: vi.fn(), clearMyStrokes: vi.fn(), addMarker: vi.fn(), clearMyMarkers: vi.fn(),
    addPing: vi.fn(), clearPings: vi.fn(), leaveParty: vi.fn(), setError: vi.fn(),
    syncSavedQuests: vi.fn(), refreshParty: vi.fn(), startRaid: vi.fn(),
    onlineMemberIds: [], presenceReady: true,
    setRaidSettings: vi.fn(), sweepEphemeral: vi.fn(), syncCharacterSnapshot: vi.fn(),
    ...overrides,
  }
  return partyState.current
}

const setupHeading = () => screen.queryByRole('heading', { name: 'WELCOME TO SQUAD PLANNER' })
// Derived from the newest entry rather than hardcoded, for the same reason the
// version above is: shipping a release must not break the gating tests.
const newsHeading = () => screen.queryByRole('heading', { name: RELEASES[0].title })

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  setAuth()
  setSettings({})
  setParty()
})

afterEach(cleanup)

describe('App welcome gating', () => {
  it('shows nothing on the auth screen', () => {
    setAuth({ user: null, profile: null })
    render(<App />)

    expect(screen.getByText('AUTH SCREEN')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows nothing on the callsign screen', () => {
    setAuth({ profile: null, isNewProfile: false })
    render(<App />)

    expect(screen.getByText('AUTH SCREEN')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows nothing while the auth splash is up', () => {
    setAuth({ loading: true })
    render(<App />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // The flash bug: an account that has already seen the notes must not see them
  // blink while its stored settings are still in flight.
  it('shows nothing while settings are still loading', () => {
    setSettings({}, { loading: true })
    render(<App />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the setup guide to a profile created in this session', () => {
    setAuth({ isNewProfile: true })
    render(<App />)

    expect(setupHeading()).toBeInTheDocument()
    expect(newsHeading()).not.toBeInTheDocument()
  })

  it('shows the release notes to an existing account with no welcome state', () => {
    render(<App />)

    expect(newsHeading()).toBeInTheDocument()
    expect(setupHeading()).not.toBeInTheDocument()
  })

  it('shows nothing once the stored version matches the release', () => {
    setSettings({ [WELCOME_SETTINGS_KEY]: { news_version: RELEASE_VERSION } })
    render(<App />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the notes again after a version bump', () => {
    setSettings({ [WELCOME_SETTINGS_KEY]: { news_version: 'not-the-current-release' } })
    render(<App />)

    expect(newsHeading()).toBeInTheDocument()
  })
})

describe('App welcome dismissal', () => {
  it('stamps the current release and closes', async () => {
    const setSetting = setSettings({}, { setSetting: vi.fn().mockResolvedValue({}) })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'GOT IT' }))

    await waitFor(() => expect(setSetting).toHaveBeenCalledTimes(1))
    const [key, stamped] = setSetting.mock.calls[0]
    expect(key).toBe(WELCOME_SETTINGS_KEY)
    expect(stamped.news_version).toBe(RELEASE_VERSION)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stamps both flags for a new profile, so it never sees the notes as well', async () => {
    setAuth({ isNewProfile: true })
    const setSetting = setSettings({}, { setSetting: vi.fn().mockResolvedValue({}) })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'SET UP QUESTS' }))

    await waitFor(() => expect(setSetting).toHaveBeenCalledTimes(1))
    const [, stamped] = setSetting.mock.calls[0]
    expect(stamped.news_version).toBe(RELEASE_VERSION)
    expect(stamped.setup_seen_at).toEqual(expect.any(String))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // isNewProfile stays true for the whole session, so only the local dismissal
  // flag stops the modal coming straight back when the write never lands.
  it('stays closed when the settings write is rejected', async () => {
    setAuth({ isNewProfile: true })
    const setSetting = setSettings({}, {
      setSetting: vi.fn().mockRejectedValue(new Error('offline')),
    })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'SET UP QUESTS' }))

    await waitFor(() => expect(setSetting).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('App welcome suppression during a deep-link join', () => {
  it('waits for the join to settle before showing anything', async () => {
    window.history.replaceState({}, '', '/join/ABC123')
    let resolveJoin
    const joinParty = vi.fn(() => new Promise(resolve => { resolveJoin = resolve }))
    setParty({ joinParty })

    render(<App />)

    await waitFor(() => expect(joinParty).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    resolveJoin(null)

    await waitFor(() => expect(newsHeading()).toBeInTheDocument())
  })
})

describe('App welcome guide button', () => {
  it('reopens the setup guide without writing to settings', async () => {
    const setSetting = setSettings(
      { [WELCOME_SETTINGS_KEY]: { news_version: RELEASE_VERSION } },
      { setSetting: vi.fn().mockResolvedValue({}) },
    )
    render(<App />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'GUIDE' }))

    expect(setupHeading()).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'SET UP QUESTS' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(setSetting).not.toHaveBeenCalled()
  })

  it('takes a new profile directly to Quest Manager', async () => {
    setAuth({ isNewProfile: true })
    setSettings({}, { setSetting: vi.fn().mockResolvedValue({}) })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'SET UP QUESTS' }))

    await waitFor(() => expect(screen.getByText('QUEST MANAGER')).toBeInTheDocument())
    expect(window.location.pathname).toBe('/quests')
  })
})
