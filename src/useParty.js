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

  // Real-time subscription + polling fallback
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

  const createParty = useCallback(async (name) => {
    setLoading(true); setError('')
    const code = mkCode()
    const newParty = {
      code, leader: name,
      map_id: null, map_name: null, map_norm: null,
      members: { [name]: [] },
      spawn: null,
      progress: {},    // { "taskId::objId": true }
      starred: {},     // { "taskId": true }
    }
    const { data, error: err } = await supabase.from('parties').insert(newParty).select().single()
    if (err) { setError('Failed to create party. Check your Supabase setup.'); setLoading(false); return false }
    codeRef.current = data.code
    setParty(data); setMyName(name); setLoading(false)
    return true
  }, [])

  const joinParty = useCallback(async (code, name) => {
    setLoading(true); setError('')
    const { data, error: err } = await supabase.from('parties').select().eq('code', code).single()
    if (err || !data) { setError('Party not found — check the code.'); setLoading(false); return false }

    const members = { ...data.members }
    if (!members[name]) members[name] = []

    const { data: updated, error: err2 } = await supabase.from('parties').update({ members }).eq('code', code).select().single()
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
    updateParty({ map_id: map.id, map_name: map.name, map_norm: map.normalizedName, spawn: null, progress: {}, starred: {} })
  }, [updateParty])

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

  // Toggle a single objective done/undone — optimistic update + sync
  const toggleObjective = useCallback((key) => {
    setParty(prev => {
      if (!prev) return prev
      const progress = { ...(prev.progress || {}), [key]: !prev.progress?.[key] }
      updateParty({ progress })
      return { ...prev, progress }
    })
  }, [updateParty])

  // Toggle a quest starred — optimistic update + sync
  const toggleStar = useCallback((taskId) => {
    setParty(prev => {
      if (!prev) return prev
      const starred = { ...(prev.starred || {}), [taskId]: !prev.starred?.[taskId] }
      updateParty({ starred })
      return { ...prev, starred }
    })
  }, [updateParty])

  const leaveParty = useCallback(() => {
    codeRef.current = null
    setParty(null); setMyName(''); setError('')
  }, [])

  return {
    party, myName, error, loading,
    createParty, joinParty,
    selectMap, addQuest, removeQuest, setSpawn,
    toggleObjective, toggleStar,
    leaveParty,
  }
}
