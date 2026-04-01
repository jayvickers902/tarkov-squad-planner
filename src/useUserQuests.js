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
    const { data, error } = await supabase.from('user_quests').upsert(row, { onConflict: 'user_id,quest_id' }).select().single()
    if (!error && data) setQuests(prev => prev.find(q => q.quest_id === quest.id) ? prev : [...prev, data])
  }, [userId])

  // Remove a quest from saved list
  const removeQuest = useCallback(async (questId) => {
    if (!userId) return
    await supabase.from('user_quests').delete().eq('user_id', userId).eq('quest_id', questId)
    setQuests(prev => prev.filter(q => q.quest_id !== questId))
  }, [userId])

  // Toggle important flag
  const toggleImportant = useCallback(async (questId) => {
    if (!userId) return
    const existing = quests.find(q => q.quest_id === questId)
    if (!existing) return
    const newVal = !existing.important
    await supabase.from('user_quests').update({ important: newVal }).eq('user_id', userId).eq('quest_id', questId)
    setQuests(prev => prev.map(q => q.quest_id === questId ? { ...q, important: newVal } : q))
  }, [userId, quests])

  // Get quests relevant to a map (map-specific + any-map)
  const questsForMap = useCallback((mapNorm) => {
    return quests.filter(q => !q.map_norm || q.map_norm === mapNorm)
  }, [quests])

  return { quests, loading, addQuest, removeQuest, toggleImportant, questsForMap }
}
