import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import L from 'leaflet'
import { cadenceOf } from '../tarkovPings'

// The map half of CENTRE ON ME: resolving the reader's own ping and flying the
// camera to it. RaidView.test.jsx covers the control that bumps the nonce and
// mapPingPolicy.test.js covers the resolution rule on its own; only a mounted
// MapLeaflet proves the two meet and move the camera.
//
// Mounting it is affordable once the upstream data hooks are stubbed — each of
// them reaches for Supabase or tarkov.dev, and none of them feed this behavior.
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

// Shoreline, so the zoom assertions read against a real config: min 2, max 6.
const MAP = 'shoreline'

function card(id, ping, overrides = {}) {
  return {
    ping: { id, y: 0, at: Date.now(), map: MAP, taps: 1, ...ping },
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

const MY_PING = card('mine', { user_id: 'alpha', user: 'ALPHA', x: 120, z: -240 })
const THEIR_PING = card('theirs', { user_id: 'bravo', user: 'BRAVO', x: -300, z: 400 })

function sharedPingState(pingCards) {
  return {
    replay: null,
    setReplay: vi.fn(),
    replayData: null,
    canReplay: false,
    replayOn: false,
    pingList: pingCards.map(item => item.ping),
    replayTrails: [],
    pingCards,
    echoCards: [],
    pingAnnouncement: null,
    dismissPingAnnouncement: vi.fn(),
    pausePingAnnouncement: vi.fn(),
    pingSig: pingCards.map(item => item.ping.id).join(','),
  }
}

// pingCards arrives newest first, the order useMapPings builds it in.
function renderMap({ pingCards = [THEIR_PING, MY_PING], ...props } = {}) {
  const onFocusPing = vi.fn()
  const element = ({ pingCards: cards = pingCards, ...next } = {}) => (
    <MapLeaflet
      mapNorm={MAP}
      mode="pan"
      {...ME}
      memberNames={['ALPHA', 'BRAVO']}
      memberIds={['alpha', 'bravo']}
      sharedPingState={sharedPingState(cards)}
      onFocusPing={onFocusPing}
      {...props}
      {...next}
    />
  )
  const view = render(element())
  return {
    onFocusPing,
    unmount: view.unmount,
    rerenderWith: next => view.rerender(element(next)),
  }
}


// A squadFrame() result, reduced to what the follow camera reads.
function followFrame(x, z) {
  return {
    points: [{ memberKey: 'alpha', x, z }],
    bounds: { minX: x - 60, maxX: x + 60, minZ: z - 60, maxZ: z + 60 },
  }
}

let flyTo
let fitBounds

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ text: () => Promise.resolve('<svg></svg>') })))
  flyTo = vi.spyOn(L.Map.prototype, 'flyTo')
  fitBounds = vi.spyOn(L.Map.prototype, 'fitBounds')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MapLeaflet CENTRE ON ME', () => {
  it('flies the camera to the reader own ping when the nonce bumps', () => {
    const { onFocusPing, rerenderWith } = renderMap()
    flyTo.mockClear()

    act(() => { rerenderWith({ centreMeNonce: 1 }) })

    expect(flyTo).toHaveBeenCalledTimes(1)
    const [target, zoom] = flyTo.mock.calls[0]
    // latLng(z, x) — the map axes are the transpose of the game ones.
    expect(target.lat).toBe(MY_PING.ping.z)
    expect(target.lng).toBe(MY_PING.ping.x)
    expect(zoom).toBeGreaterThanOrEqual(4)  // minZoom + 2
    expect(zoom).toBeLessThanOrEqual(6)     // maxZoom
    expect(onFocusPing).toHaveBeenLastCalledWith('mine')
  })

  it('passes over a teammate newer ping', () => {
    // THEIR_PING heads the list, so a resolver that took the newest card
    // outright would centre the reader on somebody else.
    const { onFocusPing, rerenderWith } = renderMap()
    flyTo.mockClear()

    act(() => { rerenderWith({ centreMeNonce: 1 }) })

    expect(flyTo.mock.calls[0][0].lng).toBe(MY_PING.ping.x)
    expect(onFocusPing).toHaveBeenLastCalledWith('mine')
  })

  it('resolves by callsign when the reader own row carries no id', () => {
    const nameOnly = card('mine-name-only', { user: 'ALPHA', x: 60, z: -80 })
    const { onFocusPing, rerenderWith } = renderMap({ pingCards: [THEIR_PING, nameOnly] })
    flyTo.mockClear()

    act(() => { rerenderWith({ centreMeNonce: 1 }) })

    expect(flyTo).toHaveBeenCalledTimes(1)
    expect(flyTo.mock.calls[0][0].lng).toBe(60)
    expect(onFocusPing).toHaveBeenLastCalledWith('mine-name-only')
  })

  it('moves nothing when the reader has no ping on this map', () => {
    const { onFocusPing, rerenderWith } = renderMap({ pingCards: [THEIR_PING] })
    flyTo.mockClear()
    fitBounds.mockClear()

    act(() => { rerenderWith({ centreMeNonce: 1 }) })

    expect(flyTo).not.toHaveBeenCalled()
    expect(fitBounds).not.toHaveBeenCalled()
    expect(onFocusPing).not.toHaveBeenCalledWith('theirs')
  })

  it('re-centres on every bump, even with that ping already focused', () => {
    // The reader pans away and presses it again. Focus is already on the ping,
    // so nothing but the nonce can tell the map to fly back to it.
    const { rerenderWith } = renderMap()
    act(() => { rerenderWith({ centreMeNonce: 1 }) })
    flyTo.mockClear()

    act(() => { rerenderWith({ centreMeNonce: 2 }) })

    expect(flyTo).toHaveBeenCalledTimes(1)
    expect(flyTo.mock.calls[0][0].lng).toBe(MY_PING.ping.x)
  })

  it('stays still on a re-render that leaves the nonce alone', () => {
    // A realtime payload hands down a fresh pingCards array on every tick, so
    // the effect re-runs constantly. Only the nonce may move the camera —
    // otherwise the map yanks itself back every time a teammate pings.
    const { rerenderWith } = renderMap()
    act(() => { rerenderWith({ centreMeNonce: 1 }) })
    flyTo.mockClear()

    act(() => { rerenderWith({ centreMeNonce: 1, pingCards: [THEIR_PING, MY_PING], mapHeight: 640 }) })

    expect(flyTo).not.toHaveBeenCalled()
  })

  it('frames a close teammate with the reader rather than flying to one point', () => {
    // focusPing widens to the companion set, so CENTRE ON ME lands on a box
    // whenever somebody sits inside the same-floor proximity window.
    const closeMate = card('close', { user_id: 'bravo', user: 'BRAVO', x: 190, z: -260 })
    const { rerenderWith } = renderMap({ pingCards: [closeMate, MY_PING] })
    flyTo.mockClear()
    fitBounds.mockClear()

    act(() => { rerenderWith({ centreMeNonce: 1 }) })

    expect(flyTo).not.toHaveBeenCalled()
    expect(fitBounds).toHaveBeenCalledTimes(1)
    const bounds = fitBounds.mock.calls[0][0]
    expect(bounds.contains(L.latLng(MY_PING.ping.z, MY_PING.ping.x))).toBe(true)
    expect(bounds.contains(L.latLng(closeMate.ping.z, closeMate.ping.x))).toBe(true)
  })

  it('centres whatever the standing camera policy is', () => {
    // The point of the control: it is not a camera mode, and no policy — least
    // of all the one that never frames a solo ping — gets to veto it.
    for (const autofocusMode of ['off', 'alerts', 'all', 'follow']) {
      const { rerenderWith } = renderMap({ autofocusMode })
      flyTo.mockClear()

      act(() => { rerenderWith({ centreMeNonce: 1 }) })

      expect(flyTo, autofocusMode).toHaveBeenCalledWith(
        expect.objectContaining({ lng: MY_PING.ping.x }),
        expect.any(Number),
        expect.anything(),
      )
      cleanup()
    }
  })

  it('centres with the draw tool active, which suspends the follow camera', () => {
    const { rerenderWith } = renderMap({ mode: 'draw' })
    flyTo.mockClear()

    act(() => { rerenderWith({ centreMeNonce: 1 }) })

    expect(flyTo).toHaveBeenCalledTimes(1)
    expect(flyTo.mock.calls[0][0].lng).toBe(MY_PING.ping.x)
  })
})

// `focusPing({ fromUser: true })` is what makes CENTRE ON ME survive contact
// with the standing camera: it stamps the same interaction guard a drag does,
// so FOLLOW waits six seconds before re-framing over the top of the jump.
describe('MapLeaflet CENTRE ON ME and the follow camera', () => {
  const followProps = { autofocusMode: 'follow', followFrame: followFrame(0, 0) }

  it('leaves the follow camera free to re-frame when nobody centred', () => {
    // The control case. Without it the deferral test below would pass against
    // a follow camera that simply never fires under jsdom.
    const { rerenderWith } = renderMap(followProps)
    flyTo.mockClear()

    act(() => { rerenderWith({ followFrame: followFrame(900, 900) }) })

    expect(flyTo).toHaveBeenCalledTimes(1)
  })

  it('makes the follow camera wait six seconds before re-framing', () => {
    vi.useFakeTimers()
    try {
      const { rerenderWith } = renderMap(followProps)
      act(() => { rerenderWith({ ...followProps, centreMeNonce: 1 }) })
      flyTo.mockClear()

      // The squad moves. Follow would normally re-frame at once and drag the
      // camera off the position the reader just asked to see.
      act(() => { rerenderWith({ ...followProps, centreMeNonce: 1, followFrame: followFrame(900, 900) }) })
      expect(flyTo).not.toHaveBeenCalled()

      act(() => { vi.advanceTimersByTime(6100) })
      expect(flyTo).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

// Mounting the map for the tests above is what surfaced this: the map image
// fetch outlives the map, and Leaflet throws when a layer is added to one that
// has been removed. Real readers hit it by switching maps or closing the raid
// view while the SVG is still in flight.
describe('MapLeaflet map image teardown', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="Ground_Level"/></svg>'

  function deferredSvgFetch() {
    let land
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { land = resolve })))
    return () => land({ text: () => Promise.resolve(SVG) })
  }

  it('adds the map image when it lands while the map is still up', async () => {
    const land = deferredSvgFetch()
    const addTo = vi.spyOn(L.SVGOverlay.prototype, 'addTo')
    renderMap()

    await act(async () => { land() })

    expect(addTo).toHaveBeenCalledTimes(1)
  })

  it('drops a map image that lands after the view closed', async () => {
    const land = deferredSvgFetch()
    const addTo = vi.spyOn(L.SVGOverlay.prototype, 'addTo')
    const { unmount } = renderMap()
    unmount()

    await act(async () => { land() })

    expect(addTo).not.toHaveBeenCalled()
  })
})
