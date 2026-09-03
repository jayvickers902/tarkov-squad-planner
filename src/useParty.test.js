import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
  channels: [],
}))

vi.mock('./supabase', () => ({ supabase: {
  from: db.from,
  rpc: db.rpc,
  channel: db.channel,
  removeChannel: db.removeChannel,
} }))

import { settleOptimisticPing, derivePartyQuestRow, autoRejoinQuestPayload, useParty } from './useParty'

function makeQuery(result) {
  const query = {
    select: vi.fn(() => query),
    update: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  return query
}

function makeChannel() {
  const channel = {
    handlers: [],
    statusCallback: null,
    on: vi.fn((topic, config, callback) => {
      if (topic === 'postgres_changes') channel.handlers.push({ config, callback })
      return channel
    }),
    presenceState: vi.fn(() => ({})),
    track: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn(callback => {
      channel.statusCallback = callback
      if (callback) callback('SUBSCRIBED')
      return channel
    }),
    emitStatus: status => channel.statusCallback?.(status),
  }
  db.channels.push(channel)
  return channel
}

function makeParty() {
  return {
    id: 41,
    code: 'ABC123',
    leader_id: 'u1',
    map_norm: 'customs',
    map_name: 'Customs',
    progress: { 'obj-1::u1': false },
    starred: {},
    drawings: [],
    markers: [],
    pings: [],
    ping_log: [],
    last_active_at: '2026-09-01T12:00:00.000Z',
    members: [{
      user_id: 'u1', callsign: 'Raven', role: 'leader',
      quests: [{ id: 'q1', name: 'Quest' }], quests_all: [{ id: 'q1', name: 'Quest' }],
      joined_at: '2026-09-01T11:00:00.000Z', last_seen: '2026-09-01T12:00:00.000Z',
    }],
  }
}

async function renderPartyHook({ onSyncMetric } = {}) {
  const party = makeParty()
  const partyRow = { ...party }
  delete partyRow.members
  let freshPartyRow = partyRow
  let freshMembers = party.members
  db.rpc.mockImplementation(name => name === 'create_party'
    ? Promise.resolve({ data: party, error: null })
    : Promise.resolve({ data: null, error: null }))
  db.from.mockImplementation(table => makeQuery(
    table === 'parties'
      ? { data: freshPartyRow, error: null }
      : table === 'party_members'
        ? { data: freshMembers, error: null }
        : { data: [], error: null },
  ))
  db.channel.mockImplementation(makeChannel)

  let renderCount = 0
  const hook = renderHook(() => {
    renderCount += 1
    return useParty('u1', { auto_rejoin: false }, {
      callsign: 'Raven', questsLoading: true, onSyncMetric,
    })
  })
  await act(async () => {
    await hook.result.current.createParty('Raven', 'regular', [])
  })
  expect(db.channels.length).toBeGreaterThan(0)
  const memberHandler = db.channels[0].handlers.find(({ config }) => config.table === 'party_members')
  const partyHandler = db.channels[0].handlers.find(({ config }) => config.table === 'parties')
  return {
    ...hook,
    channel: db.channels[0],
    party,
    setFreshPartyRow: value => { freshPartyRow = value },
    setFreshMembers: value => { freshMembers = value },
    getRenderCount: () => renderCount,
    memberHandler: memberHandler.callback,
    partyHandler: partyHandler.callback,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.channels.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('settleOptimisticPing', () => {
  it('settles a matching optimistic ping to the amended stored row', () => {
    const optimistic = {
      id: 'shot-1', user: 'PMC', user_id: 'user-1', map: 'customs', at: 1000, x: 1, y: 0, z: 2,
    }
    const stored = { ...optimistic, at: 1001, taps: 2 }
    expect(settleOptimisticPing([optimistic], stored, 1001, 10_000)).toEqual([stored])
  })

  it('does not resurrect a ping cleared while its write was in flight', () => {
    expect(settleOptimisticPing([], { id: 'shot-1', at: 1001 }, 1001, 10_000)).toBeNull()
  })
})


describe('derivePartyQuestRow', () => {
  const saved = (questId, name, mapNorm = null) => ({ quest_id: questId, quest_name: name, map_norm: mapNorm })

  it('drops a row entry the saved list no longer carries', () => {
    // The reported defect: the EFT log sync marks a quest completed, it leaves
    // `user_quests`, and the old merge re-blessed it from the row on every load.
    const { quests } = derivePartyQuestRow([saved('q1', 'Needle and a Haystack')], 'woods', {}, 'user-1')
    expect(quests).toEqual([{ id: 'q1', name: 'Needle and a Haystack' }])
  })

  it('does not depend on what is already in the party row', () => {
    // Two loads of the same saved list must agree regardless of history, which
    // is what makes the derivation authoritative rather than accumulative.
    const savedQuests = [saved('q1', 'Needle and a Haystack')]
    const first = derivePartyQuestRow(savedQuests, 'woods', {}, 'user-1')
    const second = derivePartyQuestRow(savedQuests, 'woods', {}, 'user-1')
    expect(first).toEqual(second)
  })

  it('keeps an unscoped quest on every map', () => {
    // A quest whose steps span maps carries no map_norm, so it must survive the
    // map filter -- this is the row half of the Tarkov Butcher report.
    const savedQuests = [saved('butcher', 'The Tarkov Butcher')]
    expect(derivePartyQuestRow(savedQuests, 'ground-zero', {}, 'user-1').quests)
      .toEqual([{ id: 'butcher', name: 'The Tarkov Butcher' }])
    expect(derivePartyQuestRow(savedQuests, 'streets-of-tarkov', {}, 'user-1').quests)
      .toEqual([{ id: 'butcher', name: 'The Tarkov Butcher' }])
  })

  it('scopes a map-stamped quest to its own map', () => {
    const savedQuests = [saved('q1', 'Woods only', 'woods')]
    expect(derivePartyQuestRow(savedQuests, 'woods', {}, 'user-1').quests).toHaveLength(1)
    expect(derivePartyQuestRow(savedQuests, 'customs', {}, 'user-1').quests).toEqual([])
  })

  it('drops a map change without carrying the previous map forward', () => {
    const savedQuests = [saved('woods-q', 'Woods only', 'woods'), saved('any-q', 'Any map')]
    const { quests } = derivePartyQuestRow(savedQuests, 'customs', {}, 'user-1')
    expect(quests.map(quest => quest.id)).toEqual(['any-q'])
  })

  it('honours a legacy __done__ progress key for the reader only', () => {
    const savedQuests = [saved('q1', 'Done by me'), saved('q2', 'Done by them')]
    const progress = { '__done__:q1::user-1': true, '__done__:q2::user-2': true }
    const { quests } = derivePartyQuestRow(savedQuests, 'woods', progress, 'user-1')
    expect(quests.map(quest => quest.id)).toEqual(['q2'])
  })

  it('reports every saved quest in quests_all regardless of map', () => {
    const savedQuests = [saved('woods-q', 'Woods only', 'woods'), saved('any-q', 'Any map')]
    const { questsAll } = derivePartyQuestRow(savedQuests, 'customs', {}, 'user-1')
    expect(questsAll.map(quest => quest.id)).toEqual(['woods-q', 'any-q'])
  })
})


describe('autoRejoinQuestPayload', () => {
  const quests = [{ quest_id: 'q1', quest_name: 'Needle and a Haystack', map_norm: null }]

  it('seeds the row when the loaded character matches the party', () => {
    expect(autoRejoinQuestPayload('pve', 'pve', quests)).toEqual(quests)
  })

  it('seeds nothing when the loaded character is a different mode', () => {
    // The wrong-mode path: user-level game_mode is PvE, the party is Regular,
    // and there is no second auto-rejoin attempt to correct a bad seed.
    expect(autoRejoinQuestPayload('regular', 'pve', quests)).toEqual([])
  })

  it('seeds the row when the party declares no mode', () => {
    expect(autoRejoinQuestPayload(null, 'pve', quests)).toEqual(quests)
  })
})

describe('party realtime refresh guards', () => {
  it('emits privacy-safe sync lifecycle metrics when requested', async () => {
    const metrics = []
    const hook = await renderPartyHook({ onSyncMetric: event => metrics.push(event) })

    expect(metrics.some(event => event.type === 'realtime_status' && event.status === 'SUBSCRIBED')).toBe(true)
    expect(metrics.every(event => !('user_id' in event) && !('payload' in event) && !('error' in event))).toBe(true)
    hook.unmount()
  })

  it('does not periodically refetch while the party channel is healthy', async () => {
    vi.useFakeTimers()
    const hook = await renderPartyHook()
    const before = db.from.mock.calls.length

    await act(async () => {
      vi.advanceTimersByTime(15_000)
      await Promise.resolve()
    })

    expect(db.from).toHaveBeenCalledTimes(before)
    hook.unmount()
  })

  it('uses jittered repair polling while Realtime is unhealthy and reconciles on reconnect', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const hook = await renderPartyHook()
    const before = db.from.mock.calls.length

    await act(async () => {
      await hook.channel.emitStatus('CHANNEL_ERROR')
    })
    await act(async () => {
      vi.advanceTimersByTime(14_999)
      await Promise.resolve()
    })
    expect(db.from).toHaveBeenCalledTimes(before)

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(db.from).toHaveBeenCalledTimes(before + 3)

    const afterRepair = db.from.mock.calls.length
    await act(async () => {
      await hook.channel.emitStatus('SUBSCRIBED')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(db.from).toHaveBeenCalledTimes(afterRepair + 3)

    hook.unmount()
  })

  it('does not refetch for a heartbeat-only member update, but does for quest changes', async () => {
    const hook = await renderPartyHook()
    const before = db.from.mock.calls.length
    const member = hook.party.members[0]

    await act(async () => {
      hook.memberHandler({
        eventType: 'UPDATE',
        // Postgres wire format, as the realtime WAL decoder delivers it, rather
        // than the ISO-8601 PostgREST form the cached row holds. The guard must
        // survive that difference or it degrades to an unconditional refetch.
        new: { ...member, joined_at: '2026-09-01 11:00:00+00', last_seen: '2026-09-01T12:00:30.000Z' },
      })
    })
    expect(db.from).toHaveBeenCalledTimes(before)
    expect(hook.result.current.party.members[0].last_seen).toBe('2026-09-01T12:00:30.000Z')

    hook.setFreshMembers([{ ...member, quests: [{ id: 'q2', name: 'Changed' }] }])
    await act(async () => {
      hook.memberHandler({
        eventType: 'UPDATE',
        new: { ...member, quests: [{ id: 'q2', name: 'Changed' }] },
      })
    })
    await waitFor(() => expect(db.from).toHaveBeenCalledTimes(before + 3))
    hook.unmount()
  })

  it('keeps last-active-only refreshes quiet and catches same-length progress edits', async () => {
    const hook = await renderPartyHook()
    const before = db.from.mock.calls.length
    const rendersBeforeRefresh = hook.getRenderCount()

    hook.setFreshPartyRow({ ...hook.party, members: undefined, last_active_at: '2026-09-01T12:01:00.000Z' })
    await act(async () => {
      hook.memberHandler({ eventType: 'INSERT', new: { user_id: 'u2' } })
    })
    await waitFor(() => expect(db.from).toHaveBeenCalledTimes(before + 3))
    expect(hook.getRenderCount()).toBe(rendersBeforeRefresh)

    hook.setFreshPartyRow({
      ...hook.party, members: undefined, progress: { 'obj-1::u1': true },
    })
    await act(async () => {
      hook.memberHandler({ eventType: 'INSERT', new: { user_id: 'u2' } })
    })
    await waitFor(() => expect(db.from).toHaveBeenCalledTimes(before + 6))
    expect(hook.result.current.party.progress['obj-1::u1']).toBe(true)
    hook.unmount()
  })
})
