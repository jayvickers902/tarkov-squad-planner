import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

function mkCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

export function useParty() {
  const [party, setParty]   = useState(null)
  const [myName, setMyName] = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  // Subscribe to real-time changes for this party
  useEffect(() => {
    if (!party?.code) return

    const channel = supabase
      .channel(`party:${party.code}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'parties', filter: `code=eq.${party.code}` },
        payload => {
          if (payload.new) setParty(payload.new)
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [party?.code])

  const createParty = useCallback(async (name) => {
    setLoading(true)
    setError('')
    const code = mkCode()
    const newParty = {
      code,
      leader: name,
      map_id: null,
      map_name: null,
      map_norm: null,
      members: { [name]: [] },
      spawn: null,
    }
    const { data, error: err } = await supabase
      .from('parties')
      .insert(newParty)
      .select()
      .single()

    if (err) { setError('Failed to create party. Check your Supabase setup.'); setLoading(false); return false }
    setParty(data)
    setMyName(name)
    setLoading(false)
    return true
  }, [])

  const joinParty = useCallback(async (code, name) => {
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase
      .from('parties')
      .select()
      .eq('code', code)
      .single()

    if (err || !data) { setError('Party not found — check the code.'); setLoading(false); return false }

    // Add this member if not already present
    const members = { ...data.members }
    if (!members[name]) members[name] = []

    const { data: updated, error: err2 } = await supabase
      .from('parties')
      .update({ members })
      .eq('code', code)
      .select()
      .single()

    if (err2) { setError('Failed to join party.'); setLoading(false); return false }
    setParty(updated)
    setMyName(name)
    setLoading(false)
    return true
  }, [])

  const updateParty = useCallback(async (changes) => {
    if (!party?.code) return
    const { data, error: err } = await supabase
      .from('parties')
      .update(changes)
      .eq('code', party.code)
      .select()
      .single()
    if (!err && data) setParty(data)
  }, [party?.code])

  const selectMap = useCallback((map) => {
    updateParty({ map_id: map.id, map_name: map.name, map_norm: map.normalizedName, spawn: null })
  }, [updateParty])

  const addQuest = useCallback((quest) => {
    if (!party) return
    const members = { ...party.members }
    const mine = members[myName] || []
    if (mine.find(q => q.id === quest.id)) return
    members[myName] = [...mine, { id: quest.id, name: quest.name }]
    updateParty({ members })
  }, [party, myName, updateParty])

  const removeQuest = useCallback((questId) => {
    if (!party) return
    const members = { ...party.members }
    members[myName] = (members[myName] || []).filter(q => q.id !== questId)
    updateParty({ members })
  }, [party, myName, updateParty])

  const setSpawn = useCallback((spawnId) => {
    updateParty({ spawn: spawnId })
  }, [updateParty])

  const leaveParty = useCallback(() => {
    setParty(null)
    setMyName('')
    setError('')
  }, [])

  return {
    party, myName, error, loading,
    createParty, joinParty,
    selectMap, addQuest, removeQuest, setSpawn,
    leaveParty,
  }
}
