import { describe, expect, it, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { GAME_MODES, gameModeLabel, normalizeGameMode, resolvePartyMode } from './gameMode'
import { useUserQuests } from './useUserQuests'

const db = vi.hoisted(() => ({
  rows: [],
  from: vi.fn(),
}))

vi.mock('./supabase', () => ({ supabase: { from: db.from } }))

function createQueryBuilder() {
  const filters = {}
  const inFilters = []
  let operation = 'select'
  let payload = null
  const matches = row => Object.entries(filters).every(([key, value]) => row[key] === value)
    && inFilters.every(([key, values]) => values.has(row[key]))
  function applyMutation() {
    if (operation === 'upsert') {
      for (const row of payload) {
        const existing = db.rows.findIndex(entry => entry.user_id === row.user_id && entry.game_mode === row.game_mode && entry.quest_id === row.quest_id)
        if (existing === -1) db.rows.push({ ...row, id: `${row.game_mode}-${row.quest_id}` })
        else db.rows[existing] = { ...db.rows[existing], ...row }
      }
    } else if (operation === 'insert') {
      db.rows.push(...payload.map(row => ({ ...row, id: `${row.game_mode}-${row.quest_id}` })))
    } else if (operation === 'delete') {
      db.rows = db.rows.filter(row => !matches(row))
    } else if (operation === 'update') {
      db.rows = db.rows.map(row => matches(row) ? { ...row, ...payload } : row)
    }
  }
  const builder = {
    select() { return builder },
    eq(column, value) { filters[column] = value; return builder },
    in(column, values) { inFilters.push([column, new Set(values)]); return builder },
    order() { return builder },
    upsert(next) { operation = 'upsert'; payload = Array.isArray(next) ? next : [next]; return builder },
    insert(next) { operation = 'insert'; payload = next; return builder },
    update(next) { operation = 'update'; payload = next; return builder },
    delete() { operation = 'delete'; return builder },
    single() { applyMutation(); return Promise.resolve({ data: payload[0], error: null }) },
    then(resolve, reject) {
      try {
        applyMutation()
        return Promise.resolve({ data: db.rows.filter(matches), error: null }).then(resolve, reject)
      } catch (error) {
        return Promise.reject(error).then(resolve, reject)
      }
    },
  }
  return builder
}

db.from.mockImplementation(() => createQueryBuilder())

describe('game mode contract', () => {
  beforeEach(() => {
    db.rows = [{ user_id: 'user-1', game_mode: 'regular', quest_id: 'regular-1', quest_name: 'Regular quest', state: 'active' }]
  })

  it('round-trips every mode through its display label', () => {
    expect(GAME_MODES.map(mode => [mode, gameModeLabel(mode)])).toEqual([
      ['regular', 'REGULAR'],
      ['pve', 'PVE'],
      ['pvp-season', 'SEASON'],
    ])
  })

  it('normalizes garbage and null safely to regular', () => {
    for (const value of [null, undefined, '', 'garbage', {}, 42]) {
      expect(() => normalizeGameMode(value)).not.toThrow()
      expect(normalizeGameMode(value)).toBe('regular')
    }
  })

  it("lets a party's mode beat the user's setting", () => {
    expect(resolvePartyMode({ game_mode: 'pve' }, { game_mode: 'pvp-season' })).toBe('pve')
  })

  it("uses the user's setting when there is no party", () => {
    expect(resolvePartyMode(null, { game_mode: 'pvp-season' })).toBe('pvp-season')
  })

  it("falls back to regular when neither source has a mode", () => {
    expect(resolvePartyMode(null, null)).toBe('regular')
  })

  it('switches lists without carrying quests across modes', async () => {
    const { result, rerender } = renderHook(({ mode }) => useUserQuests('user-1', mode), {
      initialProps: { mode: 'regular' },
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.addQuest({ id: 'regular-2', name: 'Another regular quest' }) })
    expect(result.current.quests.map(quest => quest.quest_id)).toEqual(['regular-1', 'regular-2'])

    rerender({ mode: 'pve' })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.quests).toEqual([])

    rerender({ mode: 'regular' })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.quests.map(quest => quest.quest_id)).toEqual(['regular-1', 'regular-2'])
  })

  it('clears active quests only in the active mode and preserves terminal history', async () => {
    db.rows.push(
      { user_id: 'user-1', game_mode: 'pve', quest_id: 'pve-1', quest_name: 'PVE quest', state: 'active' },
      { user_id: 'user-1', game_mode: 'pve', quest_id: 'pve-complete', quest_name: 'Completed PVE quest', state: 'completed' },
      { user_id: 'user-1', game_mode: 'pve', quest_id: 'pve-failed', quest_name: 'Failed PVE quest', state: 'failed' },
    )
    const { result } = renderHook(() => useUserQuests('user-1', 'pve'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.clearAllQuests() })

    expect(db.rows.filter(row => row.game_mode === 'pve').map(row => [row.quest_id, row.state])).toEqual([
      ['pve-complete', 'completed'],
      ['pve-failed', 'failed'],
    ])
    expect(db.rows.filter(row => row.game_mode === 'regular').map(row => row.quest_id)).toEqual(['regular-1'])
    expect(result.current.quests).toEqual([])
  })

  it('restores an import undo point without flattening terminal history to active', async () => {
    db.rows.push({ user_id: 'user-1', game_mode: 'pve', quest_id: 'post-import', quest_name: 'Post import', state: 'active' })
    const { result } = renderHook(() => useUserQuests('user-1', 'pve'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const stateAt = '2026-08-27T12:00:00.000Z'

    await act(async () => {
      await result.current.restoreSnapshot([
        { quest_id: 'before-active', quest_name: 'Before active', state: 'active', state_at: stateAt, state_source: 'manual' },
        { quest_id: 'before-complete', quest_name: 'Before complete', state: 'completed', state_at: stateAt, state_source: 'log_import', source_event_key: 'event-1' },
      ])
    })

    expect(db.rows.filter(row => row.game_mode === 'pve').map(row => ({
      id: row.quest_id,
      state: row.state,
      source: row.state_source,
      eventKey: row.source_event_key,
    }))).toEqual([
      { id: 'before-active', state: 'active', source: 'manual', eventKey: null },
      { id: 'before-complete', state: 'completed', source: 'log_import', eventKey: 'event-1' },
    ])
  })

  it('keeps terminal history a snapshot never described and prunes only what it claims', async () => {
    db.rows.push(
      { user_id: 'user-1', game_mode: 'pve', quest_id: 'stale-active', quest_name: 'Stale active', state: 'active' },
      { user_id: 'user-1', game_mode: 'pve', quest_id: 'handed-in', quest_name: 'Handed in', state: 'completed' },
    )
    const { result } = renderHook(() => useUserQuests('user-1', 'pve'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    // The default 'active' scope is what a localStorage snapshot gets: it holds
    // the active list only, so it has no authority to delete the completed row
    // that stops an older "started" event resurrecting a handed-in quest.
    await act(async () => {
      await result.current.restoreSnapshot([
        { quest_id: 'kept', quest_name: 'Kept', state: 'active' },
      ])
    })

    expect(db.rows.filter(row => row.game_mode === 'pve').map(row => [row.quest_id, row.state])).toEqual([
      ['handed-in', 'completed'],
      ['kept', 'active'],
    ])

    // 'all' is the import-undo scope, where the snapshot is the whole history.
    await act(async () => {
      await result.current.restoreSnapshot([
        { quest_id: 'kept', quest_name: 'Kept', state: 'active' },
      ], { scope: 'all' })
    })

    expect(db.rows.filter(row => row.game_mode === 'pve').map(row => row.quest_id)).toEqual(['kept'])
    expect(db.rows.filter(row => row.game_mode === 'regular').map(row => row.quest_id)).toEqual(['regular-1'])
  })

  it('repairs eligible hex names and recomputes every map scope', async () => {
    const hexId = '59c9392986f7742f6923add2'
    const mappedId = '5ae449d986f774453a54a7e1'
    const absentId = '5b4795fb86f7745876267770'
    db.rows = [
      { user_id: 'user-1', game_mode: 'regular', quest_id: hexId, quest_name: hexId, map_norm: null, state: 'active' },
      { user_id: 'user-1', game_mode: 'regular', quest_id: mappedId, quest_name: mappedId, map_norm: 'woods', state: 'active' },
      { user_id: 'user-1', game_mode: 'regular', quest_id: absentId, quest_name: absentId, map_norm: null, state: 'active' },
      { user_id: 'user-1', game_mode: 'regular', quest_id: 'normal-quest', quest_name: 'Already named', map_norm: null, state: 'active' },
    ]
    const { result } = renderHook(() => useUserQuests('user-1', 'regular'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let repaired
    await act(async () => {
      repaired = await result.current.repairQuestRows([
        { id: hexId, name: 'Aid Stations', map: { normalizedName: 'customs' } },
        { id: mappedId, name: 'Supervisor', map: { normalizedName: 'interchange' } },
        { id: 'normal-quest', name: 'Would not overwrite', map: { normalizedName: 'factory' } },
      ])
    })

    // Three, not two: the map scope is recomputed from the task rather than
    // only backfilled when absent, so a stale stamp is corrected (mappedId,
    // woods -> interchange) and a correctly-named row is no longer exempt
    // ('normal-quest', null -> factory). A row with no task is left alone.
    expect(repaired).toBe(3)
    expect(db.rows.map(row => [row.quest_id, row.quest_name, row.map_norm])).toEqual([
      [hexId, 'Aid Stations', 'customs'],
      [mappedId, 'Supervisor', 'interchange'],
      [absentId, absentId, null],
      ['normal-quest', 'Already named', 'factory'],
    ])
    expect(result.current.quests.find(row => row.quest_id === hexId)).toMatchObject({ quest_name: 'Aid Stations', map_norm: 'customs' })
  })

  it('clears a stamp the task no longer supports and is idempotent', async () => {
    // The reported defect: a multi-map quest stamped with whichever map the
    // party was on is filtered off every other map by questsForMap.
    const butcher = '67a09673972c11a3f507731d'
    const woodsOnly = '5ae449d986f774453a54a7e2'
    db.rows = [
      { user_id: 'user-1', game_mode: 'regular', quest_id: butcher, quest_name: 'The Tarkov Butcher', map_norm: 'streets-of-tarkov', state: 'active' },
      { user_id: 'user-1', game_mode: 'regular', quest_id: woodsOnly, quest_name: 'Woods Only', map_norm: 'woods', state: 'active' },
    ]
    // A task whose objectives disagree infers null; one with an explicit map keeps it.
    const tasks = [
      { id: butcher, name: 'The Tarkov Butcher', objectives: [
        { type: 'findQuestItem', optional: false, maps: [{ normalizedName: 'ground-zero' }] },
        { type: 'plantQuestItem', optional: false, maps: [{ normalizedName: 'streets-of-tarkov' }] },
      ] },
      { id: woodsOnly, name: 'Woods Only', map: { normalizedName: 'woods' } },
    ]

    const { result } = renderHook(() => useUserQuests('user-1', 'regular'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let repaired
    await act(async () => { repaired = await result.current.repairQuestRows(tasks) })

    expect(repaired).toBe(1)
    expect(db.rows.map(row => [row.quest_id, row.map_norm])).toEqual([
      [butcher, null],
      [woodsOnly, 'woods'],
    ])

    // A second pass must write nothing.
    await act(async () => { repaired = await result.current.repairQuestRows(tasks) })
    expect(repaired).toBe(0)
  })

  it('drops a non-featured map to null rather than storing it', async () => {
    const questId = '5b4795fb86f7745876267771'
    db.rows = [
      { user_id: 'user-1', game_mode: 'regular', quest_id: questId, quest_name: 'Labyrinth Run', map_norm: 'customs', state: 'active' },
    ]
    const { result } = renderHook(() => useUserQuests('user-1', 'regular'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      // the-labyrinth is in tarkovMapConfigs but deliberately not in FEATURED.
      await result.current.repairQuestRows([{ id: questId, name: 'Labyrinth Run', map: { normalizedName: 'the-labyrinth' } }])
    })

    expect(db.rows[0].map_norm).toBeNull()
  })

  it('caps quest name repair at 200 rows', async () => {
    const rows = Array.from({ length: 205 }, (_, index) => {
      const questId = (index + 1).toString(16).padStart(24, '0')
      return { user_id: 'user-1', game_mode: 'regular', quest_id: questId, quest_name: questId, map_norm: null, state: 'active' }
    })
    db.rows = rows
    const { result } = renderHook(() => useUserQuests('user-1', 'regular'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let repaired
    await act(async () => {
      repaired = await result.current.repairQuestRows(rows.map(row => ({ id: row.quest_id, name: `Quest ${row.quest_id}` })))
    })

    expect(repaired).toBe(200)
    expect(db.rows.filter(row => row.quest_name !== row.quest_id)).toHaveLength(200)
    expect(db.rows.slice(200).every(row => row.quest_name === row.quest_id)).toBe(true)
  })
})
