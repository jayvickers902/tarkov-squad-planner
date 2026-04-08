import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

export function useUserQuests(userId) {
  const [quests, setQuests]   = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!userId) { setQuests([]); return }
    setLoading(true)
    supabase.from('user_quests').select().eq('user_id', userId).order('created_at')
      .then(({ data }) => { setQuests(data || []) })
      .finally(() => setLoading(false))
  }, [userId])

  // Add a quest to the user's saved list
  const addQuest = useCallback(async (quest, mapNorm = null) => {
    if (!userId) return
    const row = {
      user_id:    userId,
      quest_id:   quest.id,
      quest_name: quest.name,
      map_norm:   mapNorm || null,
      important:  false,
    }
    const { data, error } = await supabase.from('user_quests').insert(row).select().single()
    if (!error && data) setQuests(prev => prev.find(q => q.quest_id === quest.id) ? prev : [...prev, data])
  }, [userId])

  // Remove a quest from saved list
  const removeQuest = useCallback(async (questId) => {
    if (!userId) return
    await supabase.from('user_quests').delete().eq('user_id', userId).eq('quest_id', questId)
    setQuests(prev => prev.filter(q => q.quest_id !== questId))
  }, [userId])

  // Toggle skipped flag
  const toggleSkipped = useCallback(async (questId) => {
    if (!userId) return
    const existing = quests.find(q => q.quest_id === questId)
    if (!existing) return
    const newVal = !existing.skipped
    await supabase.from('user_quests').update({ skipped: newVal }).eq('user_id', userId).eq('quest_id', questId)
    setQuests(prev => prev.map(q => q.quest_id === questId ? { ...q, skipped: newVal } : q))
  }, [userId, quests])

  // Toggle important flag
  const toggleImportant = useCallback(async (questId) => {
    if (!userId) return
    const existing = quests.find(q => q.quest_id === questId)
    if (!existing) return
    const newVal = !existing.important
    await supabase.from('user_quests').update({ important: newVal }).eq('user_id', userId).eq('quest_id', questId)
    setQuests(prev => prev.map(q => q.quest_id === questId ? { ...q, important: newVal } : q))
  }, [userId, quests])

  // Delete all quests for this user
  const clearAllQuests = useCallback(async () => {
    if (!userId) return
    await supabase.from('user_quests').delete().eq('user_id', userId)
    setQuests([])
  }, [userId])

  // Restore quests from a snapshot — clears existing and re-inserts all
  const restoreSnapshot = useCallback(async (snapshotQuests) => {
    if (!userId || !snapshotQuests?.length) return
    await supabase.from('user_quests').delete().eq('user_id', userId)
    const rows = snapshotQuests.map(q => ({
      user_id:    userId,
      quest_id:   q.quest_id,
      quest_name: q.quest_name,
      map_norm:   q.map_norm || null,
      important:  q.important || false,
      skipped:    q.skipped || false,
    }))
    const { data } = await supabase.from('user_quests').insert(rows).select().order('created_at')
    setQuests(data || [])
  }, [userId])

  // Get quests relevant to a map (map-specific + any-map)
  const questsForMap = useCallback((mapNorm) => {
    return quests.filter(q => !q.map_norm || q.map_norm === mapNorm)
  }, [quests])

  return { quests, loading, addQuest, removeQuest, toggleImportant, toggleSkipped, questsForMap, clearAllQuests, restoreSnapshot }
}
