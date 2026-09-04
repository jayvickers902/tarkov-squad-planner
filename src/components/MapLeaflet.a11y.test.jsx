import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cadenceOf } from '../tarkovPings'

// Real-render accessibility contract for the toolbar/layer/ping-card controls.
//
// Supersedes mapControlsA11y.test.js, which asserted these attributes by
// slicing the component's SOURCE TEXT around a label string. That proved an
// attribute sat somewhere within 500 characters of the label in the FILE, not
// that it landed on the rendered element — move a control further from its
// label and the old test fails though nothing regressed; leave the attribute
// name anywhere in that window and it passes though the control never got it.
//
// Mounting the component instead (as MapLeaflet.centreOnMe.test.jsx already
// does — ~320ms for its thirteen cases once the same eight upstream data
// hooks are stubbed) lets these assert against the actual DOM.
vi.mock('../useMapKeys', () => ({ useMapKeys: () => ({ mapKeys: [] }) }))
vi.mock('../useIntel', () => ({ useIntel: () => ({ intelPoints: [] }) }))
vi.mock('../useMapLoot', () => ({ useMapLoot: () => ({ lootRows: [] }) }))
vi.mock('../useIntelChecklist', () => ({
  useIntelChecklist: () => ({
    isChecked: () => false, toggle: vi.fn(), clear: vi.fn(), checkedCount: 0, foundToday: 0,
  }),
}))
vi.mock('../usePmcSpawns', () => ({ usePmcSpawns: () => ({}) }))
vi.mock('../useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../useTarkov', () => ({ useKeys: () => ({ allKeys: [] }) }))
vi.mock('../useMapZones', () => ({
  useMapZones: () => ({
    extracts: [], transits: [], btrStops: [], switches: [], hazards: [], locks: [],
    lootPoints: [], lootItems: [], loading: false, lootLoading: false, lootLoaded: true,
  }),
}))

import MapLeaflet from './MapLeaflet'

const ME = { myUserId: 'alpha', myName: 'ALPHA' }

// Shoreline, so the mounted map gets a real config (min/max zoom) like the
// CENTRE ON ME suite uses.
const MAP = 'shoreline'

// Shape the ping-strip render loop and focusPing() both read — same fields
// MapLeaflet.centreOnMe.test.jsx's card() builds, trimmed to what an a11y
// assertion needs.
function pingEntry(id, user, overrides = {}) {
  return {
    ping: { id, x: 0, y: 0, z: 0, at: Date.now(), map: MAP, taps: 1, user, user_id: user.toLowerCase() },
    age: 1000,
    cadence: cadenceOf(1),
    color: '#ffffff',
    floor: 'ground',
    elev: null,
    motion: null,
    fromMe: null,
    nearObj: null,
    nearKey: null,
    nearArea: null,
    nearExtract: null,
    nearIntel: null,
    likelySpawn: null,
    nearby: [],
    ...overrides,
  }
}

// echoCards feeds the rendered strip; pingCards is what focusPing() searches
// to resolve a click/keypress. Real usage keeps them in sync, so the test
// double does too.
function sharedPingState(entries) {
  return {
    replay: null,
    setReplay: vi.fn(),
    replayData: null,
    canReplay: false,
    replayOn: false,
    pingList: entries.map(item => item.ping),
    replayTrails: [],
    pingCards: entries,
    echoCards: entries,
    pingAnnouncement: null,
    dismissPingAnnouncement: vi.fn(),
    pausePingAnnouncement: vi.fn(),
    pingSig: entries.map(item => item.ping.id).join(','),
  }
}

function renderMap({ pingEntries = [], ...props } = {}) {
  const onFocusPing = vi.fn()
  render(
    <MapLeaflet
      mapNorm={MAP}
      defaultMode="pan"
      {...ME}
      memberNames={['ALPHA', 'BRAVO']}
      memberIds={['alpha', 'bravo']}
      sharedPingState={sharedPingState(pingEntries)}
      onFocusPing={onFocusPing}
      {...props}
    />,
  )
  return { onFocusPing }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ text: () => Promise.resolve('<svg></svg>') })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MapLeaflet mode and layer toggle buttons', () => {
  // The glyph in front of each label lives in <span aria-hidden="true">, so
  // the accessible name is exactly the label text — no icon, no extra space.
  it('DRAW is a real button and aria-pressed flips when mode changes', () => {
    renderMap()
    const button = screen.getByRole('button', { name: 'DRAW' })

    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button)

    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('QUEST MARKER is a real button and aria-pressed flips when mode changes', () => {
    renderMap()
    const button = screen.getByRole('button', { name: 'QUEST MARKER' })

    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button)

    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('PMC SPAWNS is a real button and aria-pressed flips when the layer toggles', () => {
    renderMap()
    const button = screen.getByRole('button', { name: 'PMC SPAWNS' })

    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-pressed', 'true') // layer defaults on

    fireEvent.click(button)

    expect(button).toHaveAttribute('aria-pressed', 'false')
  })

  it('QUEST PINS is a real button and aria-pressed flips when the layer toggles', () => {
    renderMap()
    const button = screen.getByRole('button', { name: 'QUEST PINS' })

    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(button)

    expect(button).toHaveAttribute('aria-pressed', 'false')
  })

  it('PINGS is a real button and aria-pressed flips when the layer toggles', () => {
    // The button only renders once there is at least one ping to show.
    const entries = [pingEntry('p1', 'RECON')]
    renderMap({ pingEntries: entries })
    const button = screen.getByRole('button', { name: `PINGS (${entries.length})` })

    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(button)

    expect(button).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('MapLeaflet layer popover trigger', () => {
  it('has aria-haspopup="dialog" and aria-controls pointing at the popover it actually opens', () => {
    renderMap()
    const trigger = screen.getByRole('button', { name: /LAYERS/ })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')

    fireEvent.click(trigger)

    // Read the popover's real id off the DOM and compare — never hardcode the
    // id string on both sides, or a rename of one but not the other would
    // still pass.
    const dialog = screen.getByRole('dialog', { name: 'Map layers' })
    expect(dialog.id).toBeTruthy()
    expect(trigger).toHaveAttribute('aria-controls', dialog.id)
  })
})

describe('MapLeaflet ping cards', () => {
  it('are keyboard-activatable: Enter and Space fire the same handler as a click, with the default prevented', () => {
    const entries = [pingEntry('echo-1', 'RECON')]
    const { onFocusPing } = renderMap({ pingEntries: entries })

    const card = screen.getByRole('button', { name: /RECON/ })
    expect(card).toHaveAttribute('tabindex', '0')

    fireEvent.click(card)
    expect(onFocusPing).toHaveBeenLastCalledWith('echo-1')

    onFocusPing.mockClear()
    const enterDispatched = fireEvent.keyDown(card, { key: 'Enter' })
    expect(onFocusPing).toHaveBeenLastCalledWith('echo-1')
    // fireEvent's dispatch return is false once preventDefault() ran.
    expect(enterDispatched).toBe(false)

    onFocusPing.mockClear()
    const spaceDispatched = fireEvent.keyDown(card, { key: ' ' })
    expect(onFocusPing).toHaveBeenLastCalledWith('echo-1')
    expect(spaceDispatched).toBe(false) // so Space does not also scroll the page

    onFocusPing.mockClear()
    fireEvent.keyDown(card, { key: 'a' })
    expect(onFocusPing).not.toHaveBeenCalled()
  })
})
