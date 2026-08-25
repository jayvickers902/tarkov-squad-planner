import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'
import { normalizeGameMode } from './gameMode'

export function useUserQuests(userId, gameMode = 'regular') {
  const mode = normalizeGameMode(gameMode)
  const [quests, setQuests]   = useState([])
  const [loading, setLoading] = useState(false)
  const [loadedUserId, setLoadedUserId] = useState(null)
  const [loadedGameMode, setLoadedGameMode] = useState(null)
  const activeModeRef = useRef(mode)
  activeModeRef.current = mode

  useEffect(() => {
    let cancelled = false
    if (!userId) {
      setQuests([])
      setLoadedUserId(null)
      setLoadedGameMode(null)
      setLoading(false)
      return () => { cancelled = true }
    }
    setQuests([])
    setLoadedUserId(null)
    setLoadedGameMode(null)
    setLoading(true)
    supabase.from('user_quests').select().eq('user_id', userId).eq('game_mode', mode).eq('completed', false).order('created_at')
      .then(({ data }) => {
        if (cancelled) return
        setQuests(data || [])
        setLoadedUserId(userId)
        setLoadedGameMode(mode)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [userId, mode])

  // Add a quest to the user's saved list
  const addQuest = useCallback(async (quest, mapNorm = null) => {
    if (!userId) return
    const row = {
      user_id:    userId,
      game_mode:  mode,
      quest_id:   quest.id,
      quest_name: quest.name,
      map_norm:   mapNorm || null,
      important:  false,
      completed:  false,
    }
    const { data, error } = await supabase.from('user_quests').upsert(row, { onConflict: 'user_id,game_mode,quest_id' }).select().single()
    if (!error && data && activeModeRef.current === mode) {
      setQuests(prev => prev.find(q => q.quest_id === quest.id) ? prev : [...prev, data])
    }
  }, [userId, mode])

  // Add a catch-up batch with one request per 200 rows at most.
  const bulkAddQuests = useCallback(async (entries) => {
    if (!userId || !Array.isArray(entries) || entries.length === 0) return

    const seenIds = new Set(quests.map(q => q.quest_id))
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
          important:  false,
          completed:  false,
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
      if (!error && Array.isArray(data)) inserted.push(...data)
    }

    if (inserted.length && activeModeRef.current === mode) {
      setQuests(prev => {
        const byId = new Map(prev.map(q => [q.quest_id, q]))
        for (const quest of inserted) {
          if (!byId.has(quest.quest_id)) byId.set(quest.quest_id, quest)
        }
        return [...byId.values()]
      })
    }
  }, [userId, mode, quests])

  // Remove a quest from saved list
  const removeQuest = useCallback(async (questId) => {
    if (!userId) return
    await supabase.from('user_quests').delete().eq('user_id', userId).eq('game_mode', mode).eq('quest_id', questId)
    if (activeModeRef.current === mode) setQuests(prev => prev.filter(q => q.quest_id !== questId))
  }, [userId, mode])

  // Toggle skipped flag
  const toggleSkipped = useCallback(async (questId) => {
    if (!userId) return
    const existing = quests.find(q => q.quest_id === questId)
    if (!existing) return
    const newVal = !existing.skipped
    await supabase.from('user_quests').update({ skipped: newVal }).eq('user_id', userId).eq('game_mode', mode).eq('quest_id', questId)
    if (activeModeRef.current === mode) setQuests(prev => prev.map(q => q.quest_id === questId ? { ...q, skipped: newVal } : q))
  }, [userId, mode, quests])

  // Toggle important flag
  const toggleImportant = useCallback(async (questId) => {
    if (!userId) return
    const existing = quests.find(q => q.quest_id === questId)
    if (!existing) return
    const newVal = !existing.important
    await supabase.from('user_quests').update({ important: newVal }).eq('user_id', userId).eq('game_mode', mode).eq('quest_id', questId)
    if (activeModeRef.current === mode) setQuests(prev => prev.map(q => q.quest_id === questId ? { ...q, important: newVal } : q))
  }, [userId, mode, quests])

  // Save objective completion states for a quest (persists across parties)
  const saveObjectiveProgress = useCallback(async (questId, objProgress) => {
    if (!userId) return
    await supabase.from('user_quests').update({ obj_progress: objProgress }).eq('user_id', userId).eq('game_mode', mode).eq('quest_id', questId)
    if (activeModeRef.current === mode) setQuests(prev => prev.map(q => q.quest_id === questId ? { ...q, obj_progress: objProgress } : q))
  }, [userId, mode])

  // Mark a quest as completed — removes it from the active list so it won't be re-imported
  const markCompleted = useCallback(async (questId) => {
    if (!userId) return
    await supabase.from('user_quests').update({ completed: true }).eq('user_id', userId).eq('game_mode', mode).eq('quest_id', questId)
    if (activeModeRef.current === mode) setQuests(prev => prev.filter(q => q.quest_id !== questId))
  }, [userId, mode])

  // Delete all quests for this user
  const clearAllQuests = useCallback(async () => {
    if (!userId) return
    await supabase.from('user_quests').delete().eq('user_id', userId).eq('game_mode', mode)
    if (activeModeRef.current === mode) setQuests([])
  }, [userId, mode])

  // Restore quests from a snapshot — clears existing and re-inserts all
  const restoreSnapshot = useCallback(async (snapshotQuests) => {
    if (!userId || !Array.isArray(snapshotQuests)) return
    await supabase.from('user_quests').delete().eq('user_id', userId).eq('game_mode', mode)
    const rows = snapshotQuests.map(q => ({
      user_id:    userId,
      game_mode:  mode,
      quest_id:   q.quest_id,
      quest_name: q.quest_name,
      map_norm:   q.map_norm || null,
      important:  q.important || false,
      skipped:    q.skipped || false,
    }))
    const { data } = rows.length
      ? await supabase.from('user_quests').insert(rows).select().order('created_at')
      : { data: [] }
    if (activeModeRef.current === mode) setQuests(data || [])
  }, [userId, mode])

  // Get quests relevant to a map (map-specific + any-map)
  const questsForMap = useCallback((mapNorm) => {
    return quests.filter(q => !q.map_norm || q.map_norm === mapNorm)
  }, [quests])

  return {
    quests,
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
  }
}
