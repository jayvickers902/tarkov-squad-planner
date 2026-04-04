import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

function mkCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I to avoid confusion
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, b => chars[b % chars.length]).join('')
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
  const codeRef       = useRef(null)
  const partyRef      = useRef(null)   // always mirrors party state — safe to read in callbacks
  const savedQuestsRef = useRef([])
  const prevMapNormRef = useRef(null)
  const myNameRef     = useRef('')

  // Keep refs in sync
  function applyParty(data) {
    partyRef.current = data
    setParty(data)
  }

  useEffect(() => { myNameRef.current = myName }, [myName])

  useEffect(() => {
    if (!codeRef.current) return
    const code = codeRef.current

    const poll = setInterval(async () => {
      const fresh = await fetchParty(code)
      if (fresh) applyParty(fresh)
    }, 3000)

    const channel = supabase
      .channel(`party-${code}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'parties', filter: `code=eq.${code}` },
        payload => { if (payload.new) applyParty(payload.new) })
      .subscribe()

    return () => { clearInterval(poll); supabase.removeChannel(channel) }
  }, [codeRef.current]) // eslint-disable-line

  // When the leader switches maps, non-leaders refresh their own quest list for the new map
  useEffect(() => {
    if (!party || !myName || !party.map_norm) return
    if (party.map_norm === prevMapNormRef.current) return
    prevMapNormRef.current = party.map_norm
    if (party.leader === myName) return  // leader already handled this in selectMap

    const members = { ...party.members }
    const mine = members[myName] || []

    const kept = mine.filter(q => {
      const saved = savedQuestsRef.current.find(sq => sq.quest_id === q.id)
      if (!saved) return true
      return !saved.map_norm
    })

    const newMapQuests = savedQuestsRef.current
      .filter(q => q.map_norm === party.map_norm)
      .map(q => ({ id: q.quest_id, name: q.quest_name }))
    const merged = [...kept]
    newMapQuests.forEach(sq => { if (!merged.find(q => q.id === sq.id)) merged.push(sq) })
    members[myName] = merged

    const updated = { ...party, members }
    applyParty(updated)
    updatePartyDB({ members })
  }, [party?.map_norm, myName]) // eslint-disable-line

  const updatePartyDB = useCallback(async (changes) => {
    if (!codeRef.current) return
    const { data, error: err } = await supabase.from('parties').update(changes).eq('code', codeRef.current).select().single()
    if (!err && data) applyParty(data)
  }, [])

  const createParty = useCallback(async (name, savedQuests = []) => {
    setLoading(true); setError('')
    savedQuestsRef.current = savedQuests
    const code = mkCode()

    const myQuests = savedQuests
      .filter(q => !q.map_norm)
      .map(q => ({ id: q.quest_id, name: q.quest_name }))

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
    myNameRef.current = name
    localStorage.setItem('lastPartyCode', data.code)
    applyParty(data); setMyName(name); setLoading(false)
    return true
  }, [])

  const joinParty = useCallback(async (code, name, savedQuests = []) => {
    setLoading(true); setError('')
    savedQuestsRef.current = savedQuests

    // Fetch the party first so we know the current map for quest filtering
    const { data: existing, error: fetchErr } = await supabase.from('parties').select().eq('code', code).single()
    if (fetchErr || !existing) { setError('Party not found — check the code.'); setLoading(false); return false }

    // Compute only this user's quests — server function will set just this key
    const existingMine = existing.members?.[name] || []
    const saved = savedQuests
      .filter(q => !q.map_norm || q.map_norm === existing.map_norm)
      .map(q => ({ id: q.quest_id, name: q.quest_name }))
    const merged = [...existingMine]
    saved.forEach(sq => { if (!merged.find(q => q.id === sq.id)) merged.push(sq) })

    // Only pass this user's new starred entries
    const myStarred = {}
    savedQuests.filter(q => q.important).forEach(q => { myStarred[q.quest_id] = true })

    const { data: result, error: rpcErr } = await supabase.rpc('join_party_secure', {
      p_code:       code,
      p_my_quests:  merged,
      p_starred:    myStarred,
    })
    if (rpcErr) {
      const msg = rpcErr.message?.includes('already in another party')
        ? 'You are already in another party — leave it first.'
        : rpcErr.message?.includes('party not found')
        ? 'Party not found — check the code.'
        : 'Failed to join party.'
      setError(msg); setLoading(false); return false
    }

    codeRef.current = code
    myNameRef.current = name
    localStorage.setItem('lastPartyCode', code)
    applyParty(result); setMyName(name); setLoading(false)
    return true
  }, [])

  const selectMap = useCallback((map) => {
    const prev = partyRef.current
    if (!prev) return
    const name = myNameRef.current
    const members = { ...prev.members }
    const mine = members[name] || []

    const kept = mine.filter(q => {
      const saved = savedQuestsRef.current.find(sq => sq.quest_id === q.id)
      if (!saved) return true
      return !saved.map_norm
    })

    const newMapQuests = savedQuestsRef.current
      .filter(q => q.map_norm === map.normalizedName)
      .map(q => ({ id: q.quest_id, name: q.quest_name }))
    const merged = [...kept]
    newMapQuests.forEach(sq => { if (!merged.find(q => q.id === sq.id)) merged.push(sq) })
    members[name] = merged

    const changes = { map_id: map.id, map_name: map.name, map_norm: map.normalizedName, spawn: null, progress: {}, starred: {}, drawings: [], markers: [], members }
    const updated = { ...prev, ...changes }
    applyParty(updated)
    updatePartyDB(changes)
  }, [updatePartyDB])

  const addQuest = useCallback((quest) => {
    const prev = partyRef.current
    if (!prev) return
    const name = myNameRef.current
    const members = { ...prev.members }
    const mine = members[name] || []
    if (mine.find(q => q.id === quest.id)) return
    members[name] = [...mine, { id: quest.id, name: quest.name }]
    applyParty({ ...prev, members })
    updatePartyDB({ members })
  }, [updatePartyDB])

  const removeQuest = useCallback((questId) => {
    const prev = partyRef.current
    if (!prev) return
    const name = myNameRef.current
    const members = { ...prev.members }
    members[name] = (members[name] || []).filter(q => q.id !== questId)
    applyParty({ ...prev, members })
    updatePartyDB({ members })
  }, [updatePartyDB])

  const setSpawn = useCallback((spawnId) => {
    updatePartyDB({ spawn: spawnId })
  }, [updatePartyDB])

  const toggleObjective = useCallback((key) => {
    const prev = partyRef.current
    if (!prev) return
    const progress = { ...(prev.progress || {}), [key]: !prev.progress?.[key] }
    applyParty({ ...prev, progress })
    updatePartyDB({ progress })
  }, [updatePartyDB])

  const toggleStar = useCallback((taskId) => {
    const prev = partyRef.current
    if (!prev) return
    const starred = { ...(prev.starred || {}), [taskId]: !prev.starred?.[taskId] }
    applyParty({ ...prev, starred })
    updatePartyDB({ starred })
  }, [updatePartyDB])

  const toggleComplete = useCallback((questId) => {
    const prev = partyRef.current
    if (!prev) return
    const key = `__done__:${questId}`
    const progress = { ...(prev.progress || {}), [key]: !prev.progress?.[key] }
    applyParty({ ...prev, progress })
    updatePartyDB({ progress })
  }, [updatePartyDB])

  const addStroke = useCallback((stroke) => {
    const prev = partyRef.current
    if (!prev) return
    const drawings = [...(prev.drawings || []), stroke]
    applyParty({ ...prev, drawings })
    updatePartyDB({ drawings })
  }, [updatePartyDB])

  const clearMyStrokes = useCallback(() => {
    const prev = partyRef.current
    if (!prev) return
    const name = myNameRef.current
    const drawings = (prev.drawings || []).filter(s => s.user !== name)
    applyParty({ ...prev, drawings })
    updatePartyDB({ drawings })
  }, [updatePartyDB])

  const addMarker = useCallback((marker) => {
    const prev = partyRef.current
    if (!prev) return
    const markers = [...(prev.markers || []), marker]
    applyParty({ ...prev, markers })
    updatePartyDB({ markers })
  }, [updatePartyDB])

  const clearMyMarkers = useCallback(() => {
    const prev = partyRef.current
    if (!prev) return
    const name = myNameRef.current
    const markers = (prev.markers || []).filter(m => m.user !== name)
    applyParty({ ...prev, markers })
    updatePartyDB({ markers })
  }, [updatePartyDB])

  const leaveParty = useCallback(() => {
    codeRef.current = null
    partyRef.current = null
    myNameRef.current = ''
    localStorage.removeItem('lastPartyCode')
    setParty(null); setMyName(''); setError('')
  }, [])

  const syncSavedQuests = useCallback((quests) => {
    savedQuestsRef.current = quests

    const prev = partyRef.current
    const name = myNameRef.current
    if (!prev || !name) return

    const mine = prev.members?.[name] || []
    const mapNorm = prev.map_norm

    // Keep manually-added quests (not in saved quests list at all)
    const kept = mine.filter(q => !quests.find(sq => sq.quest_id === q.id))

    // Add saved quests that match the current map (or are any-map)
    const applicable = quests
      .filter(q => !q.map_norm || q.map_norm === mapNorm)
      .map(q => ({ id: q.quest_id, name: q.quest_name }))

    const merged = [...kept]
    applicable.forEach(sq => { if (!merged.find(q => q.id === sq.id)) merged.push(sq) })

    // Only update if something actually changed
    const changed = merged.length !== mine.length || merged.some(q => !mine.find(m => m.id === q.id))
    if (!changed) return

    const members = { ...prev.members, [name]: merged }
    applyParty({ ...prev, members })
    updatePartyDB({ members })
  }, [updatePartyDB])

  return {
    party, myName, error, loading,
    createParty, joinParty,
    selectMap, addQuest, removeQuest, setSpawn,
    toggleObjective, toggleStar, toggleComplete,
    addStroke, clearMyStrokes,
    addMarker, clearMyMarkers,
    leaveParty, setError,
    syncSavedQuests,
  }
}
