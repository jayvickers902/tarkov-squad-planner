import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'
import { prunePings, appendLog } from './tarkovPings'
import { resolveSetting } from './settings'
import {
  normalizeMembers,
  findMember,
  questDoneKey,
  progressOwnerId,
  progressQuestId,
} from './partyMembers'

let pingLogWritable = true

function saveLastPartyCode(code) {
  try {
    if (code) localStorage.setItem('lastPartyCode', code)
    else localStorage.removeItem('lastPartyCode')
  } catch { /* local storage is optional */ }
}

function normalizeParty(data, fallbackMembers = []) {
  if (!data) return null
  return {
    ...data,
    members: normalizeMembers(Array.isArray(data.members) ? data.members : fallbackMembers),
  }
}

async function fetchPartyById(partyId) {
  if (!partyId) return null
  const [partyResult, membersResult] = await Promise.all([
    supabase.from('parties').select().eq('id', partyId).maybeSingle(),
    supabase.from('party_members').select().eq('party_id', partyId).order('joined_at', { ascending: true }),
  ])
  if (partyResult.error || !partyResult.data || membersResult.error) return null
  return normalizeParty(partyResult.data, membersResult.data || [])
}

function savedQuestEntry(quest) {
  return { id: quest.quest_id, name: quest.quest_name }
}

function questsForMap(savedQuests, mapNorm) {
  return savedQuests
    .filter(quest => !quest.map_norm || quest.map_norm === mapNorm)
    .map(savedQuestEntry)
}

function allQuestEntries(savedQuests) {
  return savedQuests.map(savedQuestEntry)
}

function starredFor(savedQuests) {
  const starred = {}
  savedQuests.filter(quest => quest.important).forEach(quest => { starred[quest.quest_id] = true })
  return starred
}

function completedQuestIds(progress, userId) {
  return new Set(
    Object.entries(progress || {})
      .filter(([key, value]) => value && key.startsWith('__done__:') && progressOwnerId(key) === userId)
      .map(([key]) => progressQuestId(key))
      .filter(Boolean),
  )
}

function mergeQuestsForMap(currentQuests, savedQuests, mapNorm, progress, userId) {
  const completedIds = completedQuestIds(progress, userId)
  const kept = (currentQuests || []).filter(quest => !completedIds.has(quest.id))
  const incoming = questsForMap(savedQuests, mapNorm).filter(quest => !completedIds.has(quest.id))
  const merged = [...kept]
  incoming.forEach(quest => {
    if (!merged.find(existing => existing.id === quest.id)) merged.push(quest)
  })
  return merged
}

function isPartyFullMessage(message) {
  return /party is full|full \(max/i.test(message || '')
}

export function useParty(userId, userSettings = {}) {
  const [party, setParty] = useState(null)
  const [myName, setMyName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [partyCode, setPartyCode] = useState(null)
  const [onlineMemberIds, setOnlineMemberIds] = useState([])
  const [presenceReady, setPresenceReady] = useState(false)

  const partyRef = useRef(null)
  const partyIdRef = useRef(null)
  const codeRef = useRef(null)
  const myNameRef = useRef('')
  const userIdRef = useRef(userId)
  const savedQuestsRef = useRef([])
  const prevMapNormRef = useRef(null)
  const userSettingsRef = useRef(userSettings)
  const pendingFieldsRef = useRef(new Set())
  const onlineMemberIdsRef = useRef([])
  const presenceReadyRef = useRef(false)

  useEffect(() => { userIdRef.current = userId }, [userId])
  useEffect(() => { userSettingsRef.current = userSettings || {} }, [userSettings])
  useEffect(() => { myNameRef.current = myName }, [myName])

  function applyParty(data) {
    if (!data) {
      partyRef.current = null
      setParty(null)
      return
    }
    const currentMembers = partyRef.current?.members || []
    const next = normalizeParty(data, currentMembers)
    partyRef.current = next
    partyIdRef.current = next.id
    codeRef.current = next.code
    setParty(next)
  }

  function enterParty(data, fallbackName) {
    const next = normalizeParty(data)
    if (!next) return false
    const mine = findMember(next.members, userIdRef.current)
    const name = mine?.callsign || fallbackName || ''
    partyRef.current = next
    partyIdRef.current = next.id
    codeRef.current = next.code
    myNameRef.current = name
    prevMapNormRef.current = null
    setParty(next)
    setPartyCode(next.code)
    setMyName(name)
    saveLastPartyCode(next.code)
    return true
  }

  function clearPartyState(clearHint = true) {
    partyRef.current = null
    partyIdRef.current = null
    codeRef.current = null
    myNameRef.current = ''
    prevMapNormRef.current = null
    setParty(null)
    setPartyCode(null)
    setMyName('')
    if (clearHint) saveLastPartyCode(null)
  }

  // The poll remains a reconnect/repair safety net for the row-based realtime
  // channel. Stage C may demote it once child-table writes land.
  useEffect(() => {
    if (!partyCode || !partyIdRef.current) return undefined
    const partyId = partyIdRef.current
    const code = partyCode
    let cancelled = false

    async function refreshFromDatabase() {
      const fresh = await fetchPartyById(partyId)
      if (cancelled || !fresh) return
      const pending = pendingFieldsRef.current
      if (pending.size === 0) {
        applyParty(fresh)
        return
      }
      const merged = { ...(partyRef.current || {}), ...fresh }
      for (const key of pending) {
        if (partyRef.current && Object.prototype.hasOwnProperty.call(partyRef.current, key)) {
          merged[key] = partyRef.current[key]
        }
      }
      applyParty(merged)
    }

    function updatePresence(channel) {
      const ids = new Set()
      const state = channel.presenceState() || {}
      Object.values(state).flat().forEach(meta => {
        if (meta?.user_id) ids.add(meta.user_id)
      })
      const next = [...ids]
      onlineMemberIdsRef.current = next
      setOnlineMemberIds(next)
      presenceReadyRef.current = true
      setPresenceReady(true)
    }

    const channel = supabase
      .channel(`party-${partyId}`, { config: { presence: { key: userIdRef.current || code } } })
      .on('presence', { event: 'sync' }, () => updatePresence(channel))
      .on('presence', { event: 'join' }, () => updatePresence(channel))
      .on('presence', { event: 'leave' }, () => updatePresence(channel))
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'parties', filter: `id=eq.${partyId}`,
      }, payload => {
        if (!payload.new) return
        const pending = pendingFieldsRef.current
        const merged = { ...(partyRef.current || {}), ...payload.new }
        for (const key of pending) {
          if (partyRef.current && Object.prototype.hasOwnProperty.call(partyRef.current, key)) {
            merged[key] = partyRef.current[key]
          }
        }
        applyParty(merged)
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'party_members', filter: `party_id=eq.${partyId}`,
      }, () => { refreshFromDatabase() })
      .subscribe(async status => {
        if (status !== 'SUBSCRIBED') return
        try {
          await channel.track({ user_id: userIdRef.current, callsign: myNameRef.current })
        } catch {
          // Presence is best-effort; party state remains usable.
        }
      })

    const poll = setInterval(refreshFromDatabase, 5000)
    const heartbeat = setInterval(() => {
      supabase.rpc('heartbeat', { p_code: code }).catch(() => {})
    }, 30000)

    return () => {
      cancelled = true
      clearInterval(poll)
      clearInterval(heartbeat)
      presenceReadyRef.current = false
      onlineMemberIdsRef.current = []
      setPresenceReady(false)
      setOnlineMemberIds([])
      supabase.removeChannel(channel)
    }
  }, [partyCode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Non-leaders import saved quests for the newly selected map after the
  // leader's select_map_party RPC has reset the leader's own row.
  useEffect(() => {
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId || !current.map_norm) return
    if (current.map_norm === prevMapNormRef.current) return
    prevMapNormRef.current = current.map_norm
    if (current.leader_id === currentUserId) return

    const mine = findMember(current.members, currentUserId)
    if (!mine) return
    const merged = mergeQuestsForMap(mine.quests, savedQuestsRef.current, current.map_norm, current.progress, currentUserId)
    const changed = JSON.stringify(merged) !== JSON.stringify(mine.quests)
    if (changed) updateMemberDB({ quests: merged })
  }, [party?.map_norm, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const updatePartyDB = useCallback(async changes => {
    const partyId = partyIdRef.current
    if (!partyId || !changes || Object.keys(changes).length === 0) return null
    const keys = Object.keys(changes)
    keys.forEach(key => pendingFieldsRef.current.add(key))
    const result = await supabase
      .from('parties')
      .update({ ...changes, last_active_at: new Date().toISOString() })
      .eq('id', partyId)
      .select()
      .single()
    keys.forEach(key => pendingFieldsRef.current.delete(key))
    if (!result.error && result.data) {
      const merged = { ...(partyRef.current || {}), ...result.data }
      if (partyRef.current?.members) merged.members = partyRef.current.members
      applyParty(merged)
    }
    return result
  }, [])

  const updateMemberDB = useCallback(async changes => {
    const partyId = partyIdRef.current
    const currentUserId = userIdRef.current
    if (!partyId || !currentUserId || !changes || Object.keys(changes).length === 0) return null
    const result = await supabase
      .from('party_members')
      .update(changes)
      .eq('party_id', partyId)
      .eq('user_id', currentUserId)
      .select()
      .single()
    if (!result.error && result.data && partyRef.current) {
      const members = normalizeMembers(partyRef.current.members).map(member =>
        member.user_id === currentUserId ? { ...member, ...result.data } : member,
      )
      applyParty({ ...partyRef.current, members })
    }
    return result
  }, [])

  const patchOwnMember = useCallback((changes, persist = true) => {
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    const members = normalizeMembers(current.members).map(member =>
      member.user_id === currentUserId ? { ...member, ...changes } : member,
    )
    applyParty({ ...current, members })
    if (persist) updateMemberDB(changes)
  }, [updateMemberDB])

  const createParty = useCallback(async (name, savedQuests = []) => {
    setLoading(true); setError('')
    savedQuestsRef.current = savedQuests
    const { data, error: rpcError } = await supabase.rpc('create_party', {
      p_quests: questsForMap(savedQuests, null),
      p_quests_all: allQuestEntries(savedQuests),
      p_starred: starredFor(savedQuests),
    })
    if (rpcError || !data) {
      setError('Failed to create party. Check your Supabase setup.')
      setLoading(false)
      return false
    }
    enterParty(data, name)
    setLoading(false)
    return true
  }, [])

  const forceJoinParty = useCallback(async (code, name, savedQuests = []) => {
    setLoading(true); setError('')
    savedQuestsRef.current = savedQuests
    const allQuests = allQuestEntries(savedQuests)
    const { data, error: rpcError } = await supabase.rpc('force_join_party', {
      p_code: code,
      p_quests: allQuests,
      p_quests_all: allQuests,
      p_starred: starredFor(savedQuests),
    })
    if (rpcError || !data) {
      setError(isPartyFullMessage(rpcError?.message) ? 'Party is full.' : 'Failed to join party.')
      setLoading(false)
      return false
    }
    enterParty(data, name)
    const joined = findMember(data.members, userIdRef.current)
    const filtered = questsForMap(savedQuests, data.map_norm)
    if (joined && JSON.stringify(joined.quests) !== JSON.stringify(filtered)) {
      patchOwnMember({ quests: filtered }, false)
      await updateMemberDB({ quests: filtered })
    }
    setLoading(false)
    return true
  }, [patchOwnMember, updateMemberDB])

  const joinParty = useCallback(async (code, name, savedQuests = []) => {
    setLoading(true); setError('')
    savedQuestsRef.current = savedQuests
    const allQuests = allQuestEntries(savedQuests)
    const { data, error: rpcError } = await supabase.rpc('join_party_secure', {
      p_code: code,
      p_quests: allQuests,
      p_quests_all: allQuests,
      p_starred: starredFor(savedQuests),
    })
    if (rpcError) {
      if (rpcError.message?.includes('already in another party')) {
        const previousCode = codeRef.current
        clearPartyState()
        if (previousCode) await supabase.rpc('leave_party', { p_code: previousCode })
        setLoading(false)
        return forceJoinParty(code, name, savedQuests)
      }
      setError(rpcError.message?.includes('party not found')
        ? 'Party not found - check the code.'
        : isPartyFullMessage(rpcError.message) ? 'Party is full.' : 'Failed to join party.')
      setLoading(false)
      return false
    }
    if (!data) {
      setError('Failed to join party.')
      setLoading(false)
      return false
    }
    enterParty(data, name)
    const joined = findMember(data.members, userIdRef.current)
    const filtered = questsForMap(savedQuests, data.map_norm)
    if (joined && JSON.stringify(joined.quests) !== JSON.stringify(filtered)) {
      patchOwnMember({ quests: filtered }, false)
      await updateMemberDB({ quests: filtered })
    }
    setLoading(false)
    return true
  }, [forceJoinParty, patchOwnMember, updateMemberDB])

  const selectMap = useCallback(async map => {
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    if (current.leader_id !== currentUserId && resolveSetting('members_can_change_map', {
      raid: current.settings || {}, unit: null, user: userSettingsRef.current,
    }) !== true) return

    const mine = findMember(current.members, currentUserId)
    const merged = mergeQuestsForMap(mine?.quests, savedQuestsRef.current, map.normalizedName, current.progress, currentUserId)
    const optimisticMembers = normalizeMembers(current.members).map(member =>
      member.user_id === currentUserId ? { ...member, quests: merged } : member,
    )
    applyParty({
      ...current,
      map_id: map.id,
      map_name: map.name,
      map_norm: map.normalizedName,
      spawn: null,
      progress: {},
      starred: {},
      drawings: [],
      markers: [],
      pings: [],
      ping_log: [],
      members: optimisticMembers,
    })

    const { data, error: rpcError } = await supabase.rpc('select_map_party', {
      p_code: codeRef.current,
      p_leader_quests: merged,
      p_map_id: map.id,
      p_map_name: map.name,
      p_map_norm: map.normalizedName,
    })
    if (rpcError) {
      setError(rpcError.message || 'Failed to select map.')
      return
    }
    if (data) applyParty(data)
  }, [])

  const addQuest = useCallback(quest => {
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    const mine = findMember(current.members, currentUserId)
    if (!mine || mine.quests.find(existing => existing.id === quest.id)) return
    const quests = [...mine.quests, { id: quest.id, name: quest.name }]
    const questsAll = mine.quests_all.find(existing => existing.id === quest.id)
      ? mine.quests_all
      : [...mine.quests_all, { id: quest.id, name: quest.name }]
    patchOwnMember({ quests, quests_all: questsAll })
    updateMemberDB({ quests, quests_all: questsAll })
  }, [patchOwnMember, updateMemberDB])

  const removeQuest = useCallback(questId => {
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    const mine = findMember(current.members, currentUserId)
    if (!mine) return
    const quests = mine.quests.filter(quest => quest.id !== questId)
    const questsAll = mine.quests_all.filter(quest => quest.id !== questId)
    savedQuestsRef.current = savedQuestsRef.current.filter(quest => quest.quest_id !== questId)
    patchOwnMember({ quests, quests_all: questsAll })
    updateMemberDB({ quests, quests_all: questsAll })
  }, [patchOwnMember, updateMemberDB])

  const setSpawn = useCallback(spawnId => {
    if (partyRef.current?.leader_id !== userIdRef.current) return
    updatePartyDB({ spawn: spawnId })
  }, [updatePartyDB])

  const toggleObjective = useCallback(key => {
    const current = partyRef.current
    if (!current) return
    const progress = { ...(current.progress || {}), [key]: !current.progress?.[key] }
    applyParty({ ...current, progress })
    updatePartyDB({ progress })
  }, [updatePartyDB])

  const toggleStar = useCallback(taskId => {
    const current = partyRef.current
    if (!current) return
    const starred = { ...(current.starred || {}), [taskId]: !current.starred?.[taskId] }
    applyParty({ ...current, starred })
    updatePartyDB({ starred })
  }, [updatePartyDB])

  const reorderQuests = useCallback(orderedIds => {
    const current = partyRef.current
    if (!current) return
    applyParty({ ...current, quest_order: orderedIds })
    updatePartyDB({ quest_order: orderedIds })
  }, [updatePartyDB])

  const toggleComplete = useCallback(questId => {
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    const key = questDoneKey(questId, currentUserId)
    const progress = { ...(current.progress || {}), [key]: !current.progress?.[key] }
    applyParty({ ...current, progress })
    updatePartyDB({ progress })
  }, [updatePartyDB])

  const submitMyProgress = useCallback(changes => {
    const current = partyRef.current
    if (!current) return
    const progress = { ...(current.progress || {}), ...changes }
    applyParty({ ...current, progress })
    updatePartyDB({ progress })
  }, [updatePartyDB])

  const setRaidSettings = useCallback(changes => {
    const current = partyRef.current
    if (!current || current.leader_id !== userIdRef.current) return
    const settings = { ...(current.settings || {}), ...(changes || {}) }
    applyParty({ ...current, settings })
    updatePartyDB({ settings })
  }, [updatePartyDB])

  const addStroke = useCallback(stroke => {
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    const drawings = [...(current.drawings || []), {
      ...stroke,
      user_id: currentUserId,
      user: stroke?.user || myNameRef.current,
      created_at: stroke?.created_at ?? Date.now(),
      raid_id: stroke?.raid_id ?? current.raid_id,
    }]
    applyParty({ ...current, drawings })
    updatePartyDB({ drawings })
  }, [updatePartyDB])

  const clearMyStrokes = useCallback(() => {
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    const drawings = (current.drawings || []).filter(stroke => stroke.user_id
      ? stroke.user_id !== currentUserId
      : stroke.user !== myNameRef.current)
    applyParty({ ...current, drawings })
    updatePartyDB({ drawings })
  }, [updatePartyDB])

  const addMarker = useCallback(marker => {
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    const markers = [...(current.markers || []), {
      ...marker,
      user_id: currentUserId,
      user: marker?.user || myNameRef.current,
      created_at: marker?.created_at ?? Date.now(),
      raid_id: marker?.raid_id ?? current.raid_id,
    }]
    applyParty({ ...current, markers })
    updatePartyDB({ markers })
  }, [updatePartyDB])

  const clearMyMarkers = useCallback(() => {
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    const markers = (current.markers || []).filter(marker => marker.user_id
      ? marker.user_id !== currentUserId
      : marker.user !== myNameRef.current)
    applyParty({ ...current, markers })
    updatePartyDB({ markers })
  }, [updatePartyDB])

  const setPingLog = useCallback(async pingLog => {
    const current = partyRef.current
    const partyId = partyIdRef.current
    if (!current || !partyId || !pingLogWritable) return
    applyParty({ ...current, ping_log: pingLog })
    pendingFieldsRef.current.add('ping_log')
    const { error: writeError } = await supabase
      .from('parties')
      .update({ ping_log, last_active_at: new Date().toISOString() })
      .eq('id', partyId)
    pendingFieldsRef.current.delete('ping_log')
    if (writeError) {
      pingLogWritable = false
      console.warn('parties.ping_log write failed; replay is unavailable for this session', writeError)
    }
  }, [])

  const addPing = useCallback(ping => {
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    const enriched = {
      ...ping,
      user_id: ping?.user_id || currentUserId,
      user: ping?.user || myNameRef.current,
    }
    const ttl = Number(resolveSetting('ping_ttl_ms', {
      raid: current.settings || {}, unit: null, user: userSettingsRef.current,
    }))
    const pings = prunePings(
      [...(current.pings || []), enriched],
      Date.now(),
      Number.isFinite(ttl) ? ttl : undefined,
    )
    applyParty({ ...current, pings })
    updatePartyDB({ pings })
    setPingLog(appendLog(current.ping_log, enriched))
  }, [setPingLog, updatePartyDB])

  const clearPings = useCallback(() => {
    const current = partyRef.current
    if (!current) return
    applyParty({ ...current, pings: [] })
    updatePartyDB({ pings: [] })
  }, [updatePartyDB])

  const startRaid = useCallback((timestamp = Date.now()) => {
    const current = partyRef.current
    if (!current || current.leader_id !== userIdRef.current) return
    const raidId = (Number.isInteger(current.raid_id) ? current.raid_id : 0) + 1
    const progress = { ...(current.progress || {}), __raid_start__: timestamp }
    const settings = current.settings || {}
    const markerScope = resolveSetting('marker_scope', { raid: settings, unit: null, user: userSettingsRef.current })
    const drawingScope = resolveSetting('drawing_scope', { raid: settings, unit: null, user: userSettingsRef.current })
    const changes = {
      raid_id: raidId,
      progress,
      pings: [],
      ping_log: [],
      ...(markerScope === 'raid' ? { markers: [] } : {}),
      ...(drawingScope === 'raid' ? { drawings: [] } : {}),
    }
    applyParty({ ...current, ...changes })
    updatePartyDB(changes)
  }, [updatePartyDB])

  const sweepEphemeral = useCallback(changes => {
    const current = partyRef.current
    if (!current || current.leader_id !== userIdRef.current || !changes) return
    applyParty({ ...current, ...changes })
    updatePartyDB(changes)
  }, [updatePartyDB])

  const refreshParty = useCallback(async () => {
    const fresh = await fetchPartyById(partyIdRef.current)
    if (fresh) applyParty(fresh)
  }, [])

  const leaveParty = useCallback(async () => {
    const code = codeRef.current
    clearPartyState()
    setError('')
    if (code) await supabase.rpc('leave_party', { p_code: code })
  }, [])

  const kickMember = useCallback(async memberUserId => {
    const code = codeRef.current
    if (!code || !memberUserId) return false
    const { error: rpcError } = await supabase.rpc('kick_member', {
      p_code: code,
      p_user_id: memberUserId,
    })
    if (rpcError) {
      setError(rpcError.message)
      return false
    }
    await refreshParty()
    return true
  }, [refreshParty])

  const syncSavedQuests = useCallback(quests => {
    const previousSaved = savedQuestsRef.current
    savedQuestsRef.current = quests
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    const mine = findMember(current.members, currentUserId)
    if (!mine) return

    const completedIds = completedQuestIds(current.progress, currentUserId)
    const kept = mine.quests.filter(quest =>
      !quests.find(saved => saved.quest_id === quest.id)
      && !previousSaved.find(saved => saved.quest_id === quest.id)
      && !completedIds.has(quest.id),
    )
    const applicable = questsForMap(quests, current.map_norm).filter(quest => !completedIds.has(quest.id))
    const merged = [...kept]
    applicable.forEach(quest => { if (!merged.find(existing => existing.id === quest.id)) merged.push(quest) })

    const savedIds = new Set(quests.map(quest => quest.quest_id))
    const questsAll = allQuestEntries(quests)
    kept.forEach(quest => { if (!savedIds.has(quest.id)) questsAll.push(quest) })
    const changed = JSON.stringify(merged) !== JSON.stringify(mine.quests)
    const allChanged = JSON.stringify(questsAll) !== JSON.stringify(mine.quests_all)
    if (changed || allChanged) patchOwnMember({
      ...(changed ? { quests: merged } : {}),
      ...(allChanged ? { quests_all: questsAll } : {}),
    })
  }, [patchOwnMember])

  return {
    party,
    myName,
    error,
    loading,
    onlineMemberIds,
    presenceReady,
    createParty,
    joinParty,
    forceJoinParty,
    selectMap,
    addQuest,
    removeQuest,
    setSpawn,
    toggleObjective,
    toggleStar,
    toggleComplete,
    submitMyProgress,
    reorderQuests,
    addStroke,
    clearMyStrokes,
    addMarker,
    clearMyMarkers,
    addPing,
    clearPings,
    leaveParty,
    kickMember,
    setError,
    syncSavedQuests,
    refreshParty,
    startRaid,
    setRaidSettings,
    sweepEphemeral,
  }
}
