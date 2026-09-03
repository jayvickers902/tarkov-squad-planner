import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  from: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
  pendingReads: [],
  channels: [],
}))

vi.mock('./supabase', () => ({ supabase: {
  from: db.from,
  channel: db.channel,
  removeChannel: db.removeChannel,
} }))

import { useRaidSession } from './useRaidSession'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function makeQuery(table) {
  const read = deferred()
  db.pendingReads.push({ table, read })
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    maybeSingle: vi.fn(() => read.promise),
    then: (resolve, reject) => read.promise.then(resolve, reject),
  }
  return query
}

function makeChannel() {
  const channel = {
    handlers: [],
    on: vi.fn((topic, config, callback) => {
      if (topic === 'postgres_changes') channel.handlers.push({ config, callback })
      return channel
    }),
    subscribe: vi.fn(() => channel),
  }
  db.channels.push(channel)
  return channel
}

function resolveReads() {
  const reads = db.pendingReads.splice(0)
  for (const { table, read } of reads) {
    read.resolve(table === 'raid_sessions'
      ? { data: { id: 'session-1', party_id: 42, status: 'planning', plan_revision: 1 }, error: null }
      : { data: [], error: null })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.pendingReads.length = 0
  db.channels.length = 0
  db.from.mockImplementation(table => makeQuery(table))
  db.channel.mockImplementation(makeChannel)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useRaidSession realtime repair scheduling', () => {
  it('coalesces a realtime burst into one trailing database refresh', async () => {
    const hook = renderHook(() => useRaidSession({ id: 42, active_session_id: 'session-1' }, 'user-1'))
    await waitFor(() => expect(db.channels).toHaveLength(1))
    expect(db.pendingReads).toHaveLength(2)

    const sessionHandler = db.channels[0].handlers.find(({ config }) => config.table === 'raid_sessions').callback
    await act(async () => {
      sessionHandler({ eventType: 'UPDATE', new: { id: 'session-1' } })
      sessionHandler({ eventType: 'UPDATE', new: { id: 'session-1' } })
    })
    expect(db.pendingReads).toHaveLength(2)

    await act(async () => { resolveReads() })
    await waitFor(() => expect(db.pendingReads).toHaveLength(2))
    expect(db.from).toHaveBeenCalledTimes(4)

    await act(async () => { resolveReads() })
    hook.unmount()
  })
})
