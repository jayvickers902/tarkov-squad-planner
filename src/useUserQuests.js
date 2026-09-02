import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'
import { normalizeGameMode } from './gameMode'
import { FEATURED } from './constants'
import { activeQuestRows, manualQuestStatePatch, toQuestLogEventPayload } from './questLogState'
import { inferredTaskMapNorm } from './tarkovObjectives'

const LOG_IMPORT_MODES = new Set(['regular', 'pve'])
export const QUEST_LOG_CHUNK_SIZE = 200
export const QUEST_PRUNE_CHUNK_SIZE = 100
const QUEST_NAME_REPAIR_CAP = 200
const QUEST_SCOPE_REPAIR_CHUNK = 100
const FEATURED_MAPS = new Set(FEATURED)

function throwIfError(error) {
  if (error) throw error
}

// Distinct target values are bounded by the featured map list, so grouping
// turns an unbounded row count into a handful of writes. The null bucket is
// keyed separately because a Map key of null is not the string 'null'.
export function groupByMapNorm(repairs) {
  const buckets = new Map()
  for (const { questId, mapNorm } of repairs) {
    const key = mapNorm == null ? null : mapNorm
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(questId)
  }
  return [...buckets.entries()]
}

function activeRows(data) {
  return activeQuestRows(Array.isArray(data) ? data : [])
}

export function useUserQuests(userId, gameMode = 'regular') {
  const mode = normalizeGameMode(gameMode)
  const [quests, setQuests]   = useState([])
  const [loading, setLoading] = useState(false)
  const [loadedUserId, setLoadedUserId] = useState(null)
  const [loadedGameMode, setLoadedGameMode] = useState(null)
  const [error, setError] = useState(null)
  const activeModeRef = useRef(mode)
  const activeUserIdRef = useRef(userId)
  const questsRef = useRef(quests)
  const loadRequestRef = useRef(0)
  activeModeRef.current = mode
  activeUserIdRef.current = userId
  questsRef.current = quests

  const loadMode = useCallback(async (requestedUserId, requestedMode) => {
    const result = await supabase.from('user_quests').select().eq('user_id', requestedUserId).eq('game_mode', requestedMode).order('created_at')
    throwIfError(result.error)
    return activeRows(result.data)
  }, [])

  // Public refresh used at party boundaries and by the manual sync control.
  // Re-reading the whole mode is intentional: another client may have moved
  // several quests into terminal states while this tab was asleep.
  const refresh = useCallback(async () => {
    if (!userId) return []
    const requestedUserId = userId
    const requestedMode = mode
    const requestId = ++loadRequestRef.current
    try {
      const data = await loadMode(requestedUserId, requestedMode)
      if (requestId !== loadRequestRef.current) return data
      if (activeUserIdRef.current !== requestedUserId || activeModeRef.current !== requestedMode) return data
      setQuests(data)
      setLoadedUserId(requestedUserId)
      setLoadedGameMode(requestedMode)
      setError(null)
      return data
    } catch (refreshError) {
      if (requestId === loadRequestRef.current) setError(refreshError)
      throw refreshError
    }
  }, [userId, mode, loadMode])

  useEffect(() => {
    let cancelled = false
    if (!userId) {
      loadRequestRef.current += 1
      setQuests([])
      setLoadedUserId(null)
      setLoadedGameMode(null)
      setError(null)
      setLoading(false)
      return () => { cancelled = true }
    }
    setQuests([])
    setLoadedUserId(null)
    setLoadedGameMode(null)
    setLoading(true)
    setError(null)
    const requestId = ++loadRequestRef.current
    loadMode(userId, mode)
      .then(data => {
        if (cancelled || requestId !== loadRequestRef.current) return
        setQuests(data)
        setLoadedUserId(userId)
        setLoadedGameMode(mode)
      })
      .catch(loadError => {
        if (!cancelled && requestId === loadRequestRef.current) {
          setError(loadError)
          setLoadedUserId(userId)
          setLoadedGameMode(mode)
        }
      })
      .finally(() => {
        if (!cancelled && requestId === loadRequestRef.current) setLoading(false)
      })
    return () => {
      cancelled = true
      if (requestId === loadRequestRef.current) loadRequestRef.current += 1
    }
  }, [userId, mode, loadMode])

  // The desktop scanner is a separate Supabase client. Its reconciliation RPC
  // updates user_quests without passing through this hook, so an already-open
  // planner needs the row change to refresh its active list. Re-read the whole
  // mode instead of trying to interpret the payload: completed and failed rows
  // must disappear, active rows may be inserted, and DELETE payloads do not
  // reliably include every identifying column unless replica identity is FULL.
  // A visibility refresh repairs a missed or temporarily disconnected channel.
  useEffect(() => {
    if (!userId) return undefined
    let cancelled = false
    let refreshInFlight = false
    let refreshQueued = false

    async function refreshFromDatabase() {
      if (refreshInFlight) {
        refreshQueued = true
        return
      }
      refreshInFlight = true
      const requestId = ++loadRequestRef.current
      try {
        const data = await loadMode(userId, mode)
        if (cancelled || requestId !== loadRequestRef.current) return
        if (activeUserIdRef.current !== userId || activeModeRef.current !== mode) return
        setQuests(data)
        setLoadedUserId(userId)
        setLoadedGameMode(mode)
        setError(null)
      } catch (refreshError) {
        if (!cancelled && requestId === loadRequestRef.current) setError(refreshError)
      } finally {
        if (!cancelled && requestId === loadRequestRef.current) setLoading(false)
        refreshInFlight = false
        if (refreshQueued && !cancelled) {
          refreshQueued = false
          void refreshFromDatabase()
        }
      }
    }

    const channel = supabase
      .channel(`user-quests-${userId}-${mode}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'user_quests', filter: `user_id=eq.${userId}`,
      }, () => { void refreshFromDatabase() })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') void refreshFromDatabase()
      })

    const hasDocument = typeof document !== 'undefined'
    const hasWindow = typeof window !== 'undefined'
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshFromDatabase()
    }
    const handlePageShow = () => { void refreshFromDatabase() }
    if (hasDocument) document.addEventListener('visibilitychange', handleVisibilityChange)
    if (hasWindow) window.addEventListener('pageshow', handlePageShow)

    return () => {
      cancelled = true
      refreshQueued = false
      if (hasDocument) document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (hasWindow) window.removeEventListener('pageshow', handlePageShow)
      supabase.removeChannel(channel)
    }
  }, [userId, mode, loadMode])

  // Add a quest to the user's saved list
  const addQuest = useCallback(async (quest, mapNorm = null) => {
    if (!userId) return
    const row = {
      user_id:    userId,
      game_mode:  mode,
      quest_id:   quest.id,
      quest_name: quest.name,
      map_norm:   mapNorm || null,
      ...manualQuestStatePatch('active'),
    }
    const { data, error } = await supabase.from('user_quests').upsert(row, { onConflict: 'user_id,game_mode,quest_id' }).select().single()
    throwIfError(error)
    if (data && activeModeRef.current === mode) {
      setQuests(prev => prev.find(q => q.quest_id === quest.id) ? prev : [...prev, data])
    }
  }, [userId, mode])

  // Add a catch-up batch with one request per 200 rows at most.
  const bulkAddQuests = useCallback(async (entries) => {
    if (!userId || !Array.isArray(entries) || entries.length === 0) return

    const seenIds = new Set(questsRef.current.map(q => q.quest_id))
    const rows = entries
      .filter(entry => entry?.id && !seenIds.has(entry.id))
      .map(entry => {
        seenIds.add(entry.id)
        return {
          user_id:    userId,
          game_mode:  mode,
          quest_id:   entry.id,
          quest_name: entry.name,
          map_norm:   entry.mapNorm || null,
        }
      })

    if (rows.length === 0) return

    const inserted = []
    for (let offset = 0; offset < rows.length; offset += 200) {
      const chunk = rows.slice(offset, offset + 200)
      const { data, error } = await supabase
        .from('user_quests')
        .upsert(chunk, { onConflict: 'user_id,game_mode,quest_id' })
        .select()
      throwIfError(error)
      if (Array.isArray(data)) inserted.push(...data)
    }

    if (inserted.length && activeModeRef.current === mode) {
      setQuests(prev => {
        const byId = new Map(prev.map(q => [q.quest_id, q]))
        for (const quest of activeRows(inserted)) {
          if (!byId.has(quest.quest_id)) byId.set(quest.quest_id, quest)
        }
        return [...byId.values()]
      })
    }
  }, [userId, mode])

  // Remove a quest from saved list
  const removeQuest = useCallback(async (questId) => {
    if (!userId) return
    const { error } = await supabase.from('user_quests').delete().eq('user_id', userId).eq('game_mode', mode).eq('quest_id', questId)
    throwIfError(error)
    if (activeModeRef.current === mode) setQuests(prev => prev.filter(q => q.quest_id !== questId))
  }, [userId, mode])

  // Toggle skipped flag
  const toggleSkipped = useCallback(async (questId) => {
    if (!userId) return
    const existing = quests.find(q => q.quest_id === questId)
    if (!existing) return
    const newVal = !existing.skipped
    const { error } = await supabase.from('user_quests').update({ skipped: newVal }).eq('user_id', userId).eq('game_mode', mode).eq('quest_id', questId)
    throwIfError(error)
    if (activeModeRef.current === mode) setQuests(prev => prev.map(q => q.quest_id === questId ? { ...q, skipped: newVal } : q))
  }, [userId, mode, quests])

  // Toggle important flag
  const toggleImportant = useCallback(async (questId) => {
    if (!userId) return
    const existing = quests.find(q => q.quest_id === questId)
    if (!existing) return
    const newVal = !existing.important
    const { error } = await supabase.from('user_quests').update({ important: newVal }).eq('user_id', userId).eq('game_mode', mode).eq('quest_id', questId)
    throwIfError(error)
    if (activeModeRef.current === mode) setQuests(prev => prev.map(q => q.quest_id === questId ? { ...q, important: newVal } : q))
  }, [userId, mode, quests])

  // Save objective completion states for a quest (persists across parties)
  const saveObjectiveProgress = useCallback(async (questId, objProgress) => {
    if (!userId) return
    const { error } = await supabase.from('user_quests').update({ obj_progress: objProgress }).eq('user_id', userId).eq('game_mode', mode).eq('quest_id', questId)
    throwIfError(error)
    if (activeModeRef.current === mode) setQuests(prev => prev.map(q => q.quest_id === questId ? { ...q, obj_progress: objProgress } : q))
  }, [userId, mode])

  // Repair rows against live task data: names left unresolved by an unenriched
  // log import, and map scopes that no longer match what the task itself says.
  //
  // `map_norm` is one scalar for a quest whose steps can span maps, so its only
  // defensible value is the one the task derives -- `inferredTaskMapNorm`, which
  // returns null the moment two objectives disagree. Every writer now agrees on
  // that, but rows predating it were stamped with whichever map the party
  // happened to be on when the quest was added, and `questsForMap` filters the
  // party row on this column: a wrong stamp makes the quest vanish from every
  // other map silently, with no empty card and no error. Recompute rather than
  // clear, or the 279 genuinely single-map stamps go too.
  //
  // The task list is already in memory, so keep this bounded and update rows
  // independently rather than using an upsert that could overwrite protected
  // quest state.
  const repairQuestRows = useCallback(async (taskIndex) => {
    if (!userId) return 0

    const tasks = taskIndex instanceof Map
      ? [...taskIndex.values()]
      : Array.isArray(taskIndex)
        ? taskIndex
        : Object.values(taskIndex || {})
    const byId = new Map()
    for (const task of tasks) {
      if (!task || typeof task === 'string' || !task.id) continue
      const name = String(task.name || '').trim()
      if (!name) continue
      const mapNorm = inferredTaskMapNorm(task)
      byId.set(task.id, {
        name,
        mapNorm: FEATURED_MAPS.has(mapNorm) ? mapNorm : null,
      })
    }

    const repairs = []
    for (const row of questsRef.current) {
      if (repairs.length >= QUEST_NAME_REPAIR_CAP) break
      const questId = row?.quest_id
      if (row?.quest_name !== questId || typeof questId !== 'string' || !/^[a-f0-9]{24}$/i.test(questId)) continue
      const task = byId.get(questId)
      if (!task) continue
      repairs.push({
        questId,
        questName: task.name,
        mapNorm: task.mapNorm,
      })
    }

    // Everything the name pass did not claim, checked for a stale map scope.
    // Only rows whose stored value actually differs are written, so a second
    // run of this pass is a no-op.
    const named = new Set(repairs.map(item => item.questId))
    const scopeRepairs = []
    for (const row of questsRef.current) {
      const questId = row?.quest_id
      if (!questId || named.has(questId)) continue
      const task = byId.get(questId)
      if (!task) continue
      const current = row.map_norm == null ? null : row.map_norm
      if (current === task.mapNorm) continue
      scopeRepairs.push({ questId, mapNorm: task.mapNorm })
    }

    if (repairs.length === 0 && scopeRepairs.length === 0) return 0

    await Promise.all(repairs.map(async ({ questId, questName, mapNorm }) => {
      const result = await supabase
        .from('user_quests')
        .update({ quest_name: questName, map_norm: mapNorm })
        .eq('user_id', userId)
        .eq('game_mode', mode)
        .eq('quest_id', questId)
      throwIfError(result.error)
    }))

    // Grouped by target value: a scope pass touches far more rows than a name
    // pass, and there are at most as many distinct targets as there are
    // featured maps plus null -- so this stays a handful of requests whether it
    // repairs ten rows or five hundred.
    await Promise.all(groupByMapNorm(scopeRepairs).map(async ([mapNorm, questIds]) => {
      for (let offset = 0; offset < questIds.length; offset += QUEST_SCOPE_REPAIR_CHUNK) {
        const result = await supabase
          .from('user_quests')
          .update({ map_norm: mapNorm })
          .eq('user_id', userId)
          .eq('game_mode', mode)
          .in('quest_id', questIds.slice(offset, offset + QUEST_SCOPE_REPAIR_CHUNK))
        throwIfError(result.error)
      }
    }))

    if (activeModeRef.current === mode) {
      const repaired = new Map(repairs.map(item => [item.questId, item]))
      const rescoped = new Map(scopeRepairs.map(item => [item.questId, item.mapNorm]))
      setQuests(prev => prev.map(row => {
        const repair = repaired.get(row.quest_id)
        if (repair) return { ...row, quest_name: repair.questName, map_norm: repair.mapNorm }
        if (rescoped.has(row.quest_id)) return { ...row, map_norm: rescoped.get(row.quest_id) }
        return row
      }))
    }
    return repairs.length + scopeRepairs.length
  }, [userId, mode])

  // Mark a quest as completed while retaining terminal history in the database.
  const markCompleted = useCallback(async (questId) => {
    if (!userId) return
    const { error } = await supabase.from('user_quests').update(manualQuestStatePatch('completed')).eq('user_id', userId).eq('game_mode', mode).eq('quest_id', questId)
    throwIfError(error)
    if (activeModeRef.current === mode) setQuests(prev => prev.filter(q => q.quest_id !== questId))
  }, [userId, mode])

  // Clear the visible planner without deleting terminal history. Imported log
  // events are monotonic only while completed/failed rows remain available as
  // guards; deleting those rows lets an older "started" event resurrect a
  // quest the player has already handed in.
  const clearAllQuests = useCallback(async () => {
    if (!userId) return
    const { error } = await supabase
      .from('user_quests')
      .delete()
      .eq('user_id', userId)
      .eq('game_mode', mode)
      .eq('state', 'active')
    throwIfError(error)
    if (activeModeRef.current === mode) setQuests([])
  }, [userId, mode])

  // Restore quests from a snapshot.
  //
  // `scope` says how much of the mode the snapshot actually describes. An
  // import-undo snapshot comes from getQuestHistory and covers every row, so
  // anything missing from it can be pruned ('all'). A localStorage snapshot
  // holds the active list only, so pruning terminal rows on its word would
  // delete the completed/failed guards that stop an older "started" event
  // resurrecting a quest the player has already handed in ('active').
  const restoreSnapshot = useCallback(async (snapshotQuests, { scope = 'active' } = {}) => {
    if (!userId || !Array.isArray(snapshotQuests)) return
    const rows = snapshotQuests.map(q => {
      const preservedState = ['active', 'failed', 'completed'].includes(q.state) ? q.state : null
      const statePatch = preservedState
        ? {
            state: preservedState,
            state_at: q.state_at || new Date().toISOString(),
            state_source: ['manual', 'log_import', 'live', 'system'].includes(q.state_source) ? q.state_source : 'manual',
            source_event_key: q.source_event_key || null,
          }
        : manualQuestStatePatch('active')
      return {
        user_id:    userId,
        game_mode:  mode,
        quest_id:   q.quest_id,
        quest_name: q.quest_name,
        map_norm:   q.map_norm || null,
        important:  q.important || false,
        skipped:    q.skipped || false,
        obj_progress: q.obj_progress || {},
        ...statePatch,
      }
    })
    // Write first, prune second. Deleting the mode up front and then failing
    // the insert left the character with no quests at all and no way back; a
    // failed prune only leaves extra rows behind, which the user can clear.
    for (let offset = 0; offset < rows.length; offset += QUEST_LOG_CHUNK_SIZE) {
      const { error } = await supabase
        .from('user_quests')
        .upsert(rows.slice(offset, offset + QUEST_LOG_CHUNK_SIZE), { onConflict: 'user_id,game_mode,quest_id' })
      throwIfError(error)
    }

    const keep = new Set(rows.map(row => row.quest_id))
    const existing = await supabase.from('user_quests').select('quest_id, state').eq('user_id', userId).eq('game_mode', mode)
    throwIfError(existing.error)
    const stale = (Array.isArray(existing.data) ? existing.data : [])
      .filter(row => !keep.has(row.quest_id) && (scope === 'all' || row.state === 'active'))
      .map(row => row.quest_id)
    // Chunked so the delete filter never outgrows a request URL.
    for (let offset = 0; offset < stale.length; offset += QUEST_PRUNE_CHUNK_SIZE) {
      const { error } = await supabase
        .from('user_quests')
        .delete()
        .eq('user_id', userId)
        .eq('game_mode', mode)
        .in('quest_id', stale.slice(offset, offset + QUEST_PRUNE_CHUNK_SIZE))
      throwIfError(error)
    }

    const refreshed = await loadMode(userId, mode)
    if (activeModeRef.current === mode) setQuests(refreshed)
  }, [userId, mode, loadMode])

  // History is bounded and deliberately scoped to one mode. It is used by the
  // local import preview, never sent back to the browser for another user.
  const getQuestHistory = useCallback(async (limit = 1000) => {
    if (!userId) return []
    // The upstream task vocabulary is ~700 entries, so this window covers a
    // complete profile. Terminal history always carries a state timestamp, and
    // descending order puts NULLs first in Postgres, which would otherwise
    // spend the whole window on unstamped rows the active list already knows.
    const boundedLimit = Math.max(1, Math.min(1000, Number(limit) || 1000))
    const result = await supabase.from('user_quests').select().eq('user_id', userId).eq('game_mode', mode).order('state_at', { ascending: false, nullsFirst: false }).limit(boundedLimit)
    throwIfError(result.error)
    return Array.isArray(result.data) ? result.data : []
  }, [userId, mode])

  const reconcileLogEvents = useCallback(async (targetGameMode, events, options = {}) => {
    if (!userId) throw new Error('You must be signed in to import quest logs')
    const targetMode = normalizeGameMode(targetGameMode)
    if (!LOG_IMPORT_MODES.has(targetMode)) throw new Error('Quest log import supports Regular and PvE only')
    if (!Array.isArray(events) || events.length === 0) return { inserted: 0, updated: 0, ignored: 0, affected_task_ids: [] }

    const safeEvents = toQuestLogEventPayload(events)
    const results = []
    const chunkCount = Math.ceil(safeEvents.length / QUEST_LOG_CHUNK_SIZE)
    const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null
    for (let offset = 0; offset < safeEvents.length; offset += QUEST_LOG_CHUNK_SIZE) {
      const { data, error } = await supabase.rpc('reconcile_user_quest_log_events', {
        p_game_mode: targetMode,
        p_events: safeEvents.slice(offset, offset + QUEST_LOG_CHUNK_SIZE),
      })
      throwIfError(error)
      results.push(data || {})
      if (onProgress) {
        const summary = results.reduce((total, item) => ({
          inserted: total.inserted + Number(item.inserted || 0),
          updated: total.updated + Number(item.updated || 0),
          ignored: total.ignored + Number(item.ignored || 0),
          affected_task_ids: [...new Set([...total.affected_task_ids, ...(Array.isArray(item.affected_task_ids) ? item.affected_task_ids : [])])].slice(0, 1000),
        }), { inserted: 0, updated: 0, ignored: 0, affected_task_ids: [] })
        onProgress({
          chunkIndex: Math.floor(offset / QUEST_LOG_CHUNK_SIZE) + 1,
          chunkCount,
          applied: Math.min(offset + QUEST_LOG_CHUNK_SIZE, safeEvents.length),
          total: safeEvents.length,
          summary,
        })
      }
    }
    const summary = results.reduce((total, item) => ({
      inserted: total.inserted + Number(item.inserted || 0),
      updated: total.updated + Number(item.updated || 0),
      ignored: total.ignored + Number(item.ignored || 0),
      affected_task_ids: [...new Set([...total.affected_task_ids, ...(Array.isArray(item.affected_task_ids) ? item.affected_task_ids : [])])].slice(0, 1000),
    }), { inserted: 0, updated: 0, ignored: 0, affected_task_ids: [] })

    if (activeModeRef.current === targetMode) {
      const refreshed = await loadMode(userId, targetMode)
      if (activeModeRef.current === targetMode) setQuests(refreshed)
    }
    return summary
  }, [userId, loadMode])

  // Get quests relevant to a map (map-specific + any-map)
  const questsForMap = useCallback((mapNorm) => {
    return quests.filter(q => !q.map_norm || q.map_norm === mapNorm)
  }, [quests])

  return {
    quests,
    error,
    loading: Boolean(userId) && (loading || loadedUserId !== userId || loadedGameMode !== mode),
    gameMode: mode,
    addQuest,
    bulkAddQuests,
    removeQuest,
    toggleImportant,
    toggleSkipped,
    questsForMap,
    clearAllQuests,
    restoreSnapshot,
    markCompleted,
    saveObjectiveProgress,
    repairQuestRows,
    reconcileLogEvents,
    getQuestHistory,
    refresh,
  }
}
