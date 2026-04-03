import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

function mkCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

async function fetchParty(code) {
  const { data } = await supabase.from('parties').select().eq('code', code).single()
  return data
}

export function useParty() {
  const [party, setParty]     = useState(null)
  const [myName, setMyName]   = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const codeRef = useRef(null)
  const savedQuestsRef = useRef([])
  const prevMapNormRef = useRef(null)

  useEffect(() => {
    if (!codeRef.current) return
    const code = codeRef.current

    const poll = setInterval(async () => {
      const fresh = await fetchParty(code)
      if (fresh) setParty(fresh)
    }, 3000)

    const channel = supabase
      .channel(`party-${code}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'parties', filter: `code=eq.${code}` },
        payload => { if (payload.new) setParty(payload.new) })
      .subscribe()

    return () => { clearInterval(poll); supabase.removeChannel(channel) }
  }, [codeRef.current]) // eslint-disable-line

  // When the leader switches maps, non-leaders must refresh their own quest list
  // for the new map (leader handles it in selectMap; others watch for map_norm changes)
  useEffect(() => {
    if (!party || !myName || !party.map_norm) return
    if (party.map_norm === prevMapNormRef.current) return
    prevMapNormRef.current = party.map_norm
    if (party.leader === myName) return  // leader already handled this in selectMap

    const members = { ...party.members }
    const mine = members[myName] || []

    const kept = mine.filter(q => {
      const saved = savedQuestsRef.current.find(sq => sq.quest_id === q.id)
      if (!saved) return true       // manually added — keep
      return !saved.map_norm        // any-map saved quest — keep; map-specific — drop
    })

    const newMapQuests = savedQuestsRef.current
      .filter(q => q.map_norm === party.map_norm)
      .map(q => ({ id: q.quest_id, name: q.quest_name }))
    const merged = [...kept]
    newMapQuests.forEach(sq => { if (!merged.find(q => q.id === sq.id)) merged.push(sq) })
    members[myName] = merged

    updateParty({ members })
    setParty(prev => prev ? { ...prev, members } : prev)
  }, [party?.map_norm, myName]) // eslint-disable-line

  // savedQuests = user's saved quests from useUserQuests
  const createParty = useCallback(async (name, savedQuests = []) => {
    setLoading(true); setError('')
    savedQuestsRef.current = savedQuests
    const code = mkCode()

    // Only pre-populate "any map" quests (map_norm is null); map-specific quests load on map select
    const myQuests = savedQuests
      .filter(q => !q.map_norm)
      .map(q => ({ id: q.quest_id, name: q.quest_name }))

    // Pre-star important quests
    const starred = {}
    savedQuests.filter(q => q.important).forEach(q => { starred[q.quest_id] = true })

    const newParty = {
      code, leader: name,
      map_id: null, map_name: null, map_norm: null,
      members: { [name]: myQuests },
      spawn: null,
      progress: {},
      starred,
      drawings: [],
    }
    const { data, error: err } = await supabase.from('parties').insert(newParty).select().single()
    if (err) { setError('Failed to create party. Check your Supabase setup.'); setLoading(false); return false }
    codeRef.current = data.code
    setParty(data); setMyName(name); setLoading(false)
    return true
  }, [])

  const joinParty = useCallback(async (code, name, savedQuests = []) => {
    setLoading(true); setError('')
    savedQuestsRef.current = savedQuests
    const { data, error: err } = await supabase.from('parties').select().eq('code', code).single()
    if (err || !data) { setError('Party not found — check the code.'); setLoading(false); return false }

    const members = { ...data.members }
    // Pre-populate "any map" quests + quests matching the party's current map
    const existing = members[name] || []
    const saved = savedQuests
      .filter(q => !q.map_norm || q.map_norm === data.map_norm)
      .map(q => ({ id: q.quest_id, name: q.quest_name }))
    const merged = [...existing]
    saved.forEach(sq => { if (!merged.find(q => q.id === sq.id)) merged.push(sq) })
    members[name] = merged

    // Merge important flags into starred without overwriting existing stars
    const starred = { ...(data.starred || {}) }
    savedQuests.filter(q => q.important).forEach(q => { starred[q.quest_id] = true })

    const { data: updated, error: err2 } = await supabase.from('parties').update({ members, starred }).eq('code', code).select().single()
    if (err2) { setError('Failed to join party.'); setLoading(false); return false }

    codeRef.current = code
    setParty(updated); setMyName(name); setLoading(false)
    return true
  }, [])

  const updateParty = useCallback(async (changes) => {
    if (!codeRef.current) return
    const { data, error: err } = await supabase.from('parties').update(changes).eq('code', codeRef.current).select().single()
    if (!err && data) setParty(data)
  }, [])

  const selectMap = useCallback((map) => {
    setParty(prev => {
      if (!prev) return prev
      const members = { ...prev.members }
      const mine = members[myName] || []

      // Drop map-specific saved quests (they belong to a different map).
      // Keep: manually-added quests (not in savedQuests) and any-map saved quests.
      const kept = mine.filter(q => {
        const saved = savedQuestsRef.current.find(sq => sq.quest_id === q.id)
        if (!saved) return true        // manually added during party — keep
        return !saved.map_norm         // any-map saved quest — keep; map-specific — drop
      })

      // Add saved quests for the new map
      const newMapQuests = savedQuestsRef.current
        .filter(q => q.map_norm === map.normalizedName)
        .map(q => ({ id: q.quest_id, name: q.quest_name }))
      const merged = [...kept]
      newMapQuests.forEach(sq => { if (!merged.find(q => q.id === sq.id)) merged.push(sq) })
      members[myName] = merged

      const changes = { map_id: map.id, map_name: map.name, map_norm: map.normalizedName, spawn: null, progress: {}, starred: {}, drawings: [], members }
      updateParty(changes)
      return { ...prev, ...changes }
    })
  }, [myName, updateParty])

  const addQuest = useCallback((quest) => {
    setParty(prev => {
      if (!prev) return prev
      const members = { ...prev.members }
      const mine = members[myName] || []
      if (mine.find(q => q.id === quest.id)) return prev
      members[myName] = [...mine, { id: quest.id, name: quest.name }]
      updateParty({ members })
      return { ...prev, members }
    })
  }, [myName, updateParty])

  const removeQuest = useCallback((questId) => {
    setParty(prev => {
      if (!prev) return prev
      const members = { ...prev.members }
      members[myName] = (members[myName] || []).filter(q => q.id !== questId)
      updateParty({ members })
      return { ...prev, members }
    })
  }, [myName, updateParty])

  const setSpawn = useCallback((spawnId) => {
    updateParty({ spawn: spawnId })
  }, [updateParty])

  const toggleObjective = useCallback((key) => {
    setParty(prev => {
      if (!prev) return prev
      const progress = { ...(prev.progress || {}), [key]: !prev.progress?.[key] }
      updateParty({ progress })
      return { ...prev, progress }
    })
  }, [updateParty])

  const toggleStar = useCallback((taskId) => {
    setParty(prev => {
      if (!prev) return prev
      const starred = { ...(prev.starred || {}), [taskId]: !prev.starred?.[taskId] }
      updateParty({ starred })
      return { ...prev, starred }
    })
  }, [updateParty])

  // Completed quests are stored inside `progress` with a __done__: prefix
  // so no extra DB column is needed.
  const toggleComplete = useCallback((questId) => {
    setParty(prev => {
      if (!prev) return prev
      const key = `__done__:${questId}`
      const progress = { ...(prev.progress || {}), [key]: !prev.progress?.[key] }
      updateParty({ progress })
      return { ...prev, progress }
    })
  }, [updateParty])

  const addStroke = useCallback((stroke) => {
    setParty(prev => {
      if (!prev) return prev
      const drawings = [...(prev.drawings || []), stroke]
      updateParty({ drawings })
      return { ...prev, drawings }
    })
  }, [updateParty])

  const clearMyStrokes = useCallback(() => {
    setParty(prev => {
      if (!prev) return prev
      const drawings = (prev.drawings || []).filter(s => s.user !== myName)
      updateParty({ drawings })
      return { ...prev, drawings }
    })
  }, [myName, updateParty])

  const leaveParty = useCallback(() => {
    codeRef.current = null
    setParty(null); setMyName(''); setError('')
  }, [])

  // Keep savedQuestsRef in sync — quests may finish loading after joinParty/createParty runs
  const syncSavedQuests = useCallback((quests) => {
    savedQuestsRef.current = quests
  }, [])

  return {
    party, myName, error, loading,
    createParty, joinParty,
    selectMap, addQuest, removeQuest, setSpawn,
    toggleObjective, toggleStar, toggleComplete,
    addStroke, clearMyStrokes,
    leaveParty, setError,
    syncSavedQuests,
  }
}
