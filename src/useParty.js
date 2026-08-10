import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'
import { prunePings, appendLog, pingFromEvent } from './tarkovPings'
import { resolveSetting } from './settings'
import {
  normalizeMembers,
  findMember,
  questDoneKey,
  progressOwnerId,
  progressQuestId,
} from './partyMembers'

let pingLogWritable = true
// Older Supabase projects can run the app before 10_08 is applied. Disable the
// child-table path after the first schema/function error and retain the JSONB
// fallback until the migration is deployed.
let pingEventsWritable = true
// The atomic-write migration is applied by hand. Latch a missing RPC after
// PostgREST's one capability probe so older deployments use the legacy path
// without probing again for every click.
const atomicRpcWritable = {
  append_drawing: true,
  append_marker: true,
  append_ping: true,
  merge_progress: true,
  merge_starred: true,
  clear_my_drawings: true,
  clear_my_markers: true,
  clear_pings: true,
}

function isMissingAtomicRpcError(error) {
  if (!error || error.code !== 'PGRST202') return false
  const status = error.status ?? error.statusCode
  return status == null || Number(status) === 404
}

function ignoreAsyncError(value) {
  Promise.resolve(value).catch(() => {})
}

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

function comparableParty(data) {
  if (!data) return data
  const { last_active_at, members, ...rest } = data
  return {
    ...rest,
    members: Array.isArray(members)
      ? members.map(({ last_seen, ...member }) => member)
      : members,
  }
}

async function fetchPartyById(partyId) {
  if (!partyId) return null
  const [partyResult, membersResult] = await Promise.all([
    supabase.from('parties').select().eq('id', partyId).maybeSingle(),
    supabase.from('party_members').select().eq('party_id', partyId).order('joined_at', { ascending: true }),
  ])
  if (partyResult.error || !partyResult.data || membersResult.error) return null
  const party = normalizeParty(partyResult.data, membersResult.data || [])

  // This query is intentionally best-effort for the migration window. Once
  // present, the child table becomes the source of truth for the current raid;
  // a missing table simply leaves the legacy columns untouched.
  try {
    const { data: eventRows, error: eventError } = await supabase
      .from('party_ping_events')
      .select('id, party_id, raid_id, user_id, callsign, source_event_id, map_norm, x, y, z, yaw, taps, client_at, server_at')
      .eq('party_id', party.id)
      .eq('raid_id', party.raid_id ?? 0)
      .order('server_at', { ascending: true })
    if (!eventError && Array.isArray(eventRows)) {
      const events = eventRows.map(pingFromEvent).filter(Boolean)
      // Keep rows written by an older client during the migration window. The
      // source id is stable, so the merge is cheap and does not duplicate a
      // child-table event that was also mirrored into the legacy column.
      const byId = new Map()
      ;[...(party.pings || []), ...events].forEach(ping => {
        if (ping?.id && !byId.has(ping.id)) byId.set(ping.id, ping)
      })
      party.pings = prunePings([...byId.values()])
      party.ping_log = [...(Array.isArray(party.ping_log) ? party.ping_log : []), ...events]
        .reduce((log, ping) => appendLog(log, ping), [])
      pingEventsWritable = true
    } else if (eventError && /does not exist|relation|schema cache/i.test(eventError.message || '')) {
      pingEventsWritable = false
    }
  } catch {
    // Keep the legacy snapshot when the child table is not deployed yet.
  }
  return party
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

export function useParty(userId, userSettings = {}, {
  callsign = '',
  savedQuests = [],
  questsLoading = true,
  settingsLoading = false,
  pendingJoinCode = null,
} = {}) {
  const [party, setParty] = useState(null)
  const [myName, setMyName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoRejoinSettled, setAutoRejoinSettled] = useState(false)
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
  const autoRejoinAttemptedRef = useRef(null)
  const autoRejoinBlockedRef = useRef(false)

  useEffect(() => {
    const previousUserId = userIdRef.current
    if (previousUserId !== userId) {
      autoRejoinAttemptedRef.current = null
      autoRejoinBlockedRef.current = false
      setAutoRejoinSettled(false)
      if (previousUserId && previousUserId !== userId) clearPartyState(false)
    }
    userIdRef.current = userId
  }, [userId])
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
      const merged = { ...(partyRef.current || {}), ...fresh }
      for (const key of pending) {
        if (partyRef.current && Object.prototype.hasOwnProperty.call(partyRef.current, key)) {
          merged[key] = partyRef.current[key]
        }
      }
      if (JSON.stringify(comparableParty(merged)) === JSON.stringify(comparableParty(partyRef.current))) return
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
        // A raw parties row is not authoritative about pings once the child table
        // is in use: nothing writes parties.pings any more, so the broadcast
        // carries empty legacy arrays. append_party_ping bumps last_active_at
        // itself, so without this every screenshot ping wiped itself the moment
        // its own write echoed back. Same guard as runAtomicPartyWrite.
        if (pingEventsWritable && partyRef.current) {
          merged.pings = partyRef.current.pings
          merged.ping_log = partyRef.current.ping_log
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

    // Keep the optional child-table subscription isolated from the presence and
    // party-row channel. During rollout an older project may not have the table
    // in its realtime publication; that must not take the core party channel
    // down with it.
    const pingChannel = supabase
      .channel(`party-pings-${partyId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'party_ping_events', filter: `party_id=eq.${partyId}`,
      }, payload => {
        const event = payload?.new
        const current = partyRef.current
        if (!event || !current || Number(event.raid_id) !== Number(current.raid_id ?? 0)) return
        const ping = pingFromEvent(event)
        if (!ping || current.pings?.some(existing => existing.id === ping.id)) return
        const ttl = Number(resolveSetting('ping_ttl_ms', {
          raid: current.settings || {}, unit: null, user: userSettingsRef.current,
        }))
        const pings = prunePings([...(current.pings || []), ping], Date.now(), Number.isFinite(ttl) ? ttl : undefined)
        const pingLog = current.ping_log?.some(existing => existing.id === ping.id)
          ? current.ping_log
          : appendLog(current.ping_log, ping)
        applyParty({ ...current, pings, ping_log: pingLog })
      })
      .subscribe()

    let poll = null
    let heartbeat = null

    function stopTimers() {
      if (poll) clearInterval(poll)
      if (heartbeat) clearInterval(heartbeat)
      poll = null
      heartbeat = null
    }

    function startTimers() {
      if (document.hidden || cancelled) return
      stopTimers()
      poll = setInterval(refreshFromDatabase, 15000)
      heartbeat = setInterval(() => {
        ignoreAsyncError(supabase.rpc('heartbeat', { p_code: code }))
      }, 30000)
    }

    function onVisibilityChange() {
      if (document.hidden) {
        stopTimers()
        return
      }
      refreshFromDatabase()
      startTimers()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    startTimers()

    return () => {
      cancelled = true
      stopTimers()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      presenceReadyRef.current = false
      onlineMemberIdsRef.current = []
      setPresenceReady(false)
      setOnlineMemberIds([])
      supabase.removeChannel(channel)
      supabase.removeChannel(pingChannel)
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

  const runAtomicPartyWrite = useCallback(async (rpcName, params, fields, fallback) => {
    const fieldNames = Array.isArray(fields) ? fields : [fields]
    fieldNames.forEach(field => pendingFieldsRef.current.add(field))

    try {
      if (atomicRpcWritable[rpcName]) {
        const result = await supabase.rpc(rpcName, params)
        if (!result.error) {
          if (result.data) {
            const current = partyRef.current
            const preservesChildPings = pingEventsWritable && !fieldNames.includes('pings')
            applyParty(preservesChildPings && current
              ? { ...result.data, pings: current.pings, ping_log: current.ping_log }
              : result.data)
          }
          else console.warn(`${rpcName} returned no authoritative party snapshot`)
          return result
        }

        if (!isMissingAtomicRpcError(result.error)) {
          console.warn(`${rpcName} failed; optimistic party state will reconcile on the next refresh`, result.error)
          return result
        }

        atomicRpcWritable[rpcName] = false
        console.warn(`${rpcName} is unavailable; using the legacy party write path`, result.error)
      }

      const fallbackResult = fallback ? await fallback() : null
      if (fallbackResult?.error) {
        console.warn(`${rpcName} legacy party write failed; optimistic state will reconcile on the next refresh`, fallbackResult.error)
      }
      return fallbackResult
    } catch (writeError) {
      console.warn(`${rpcName} failed; optimistic party state will reconcile on the next refresh`, writeError)
      return { data: null, error: writeError }
    } finally {
      fieldNames.forEach(field => pendingFieldsRef.current.delete(field))
    }
  }, [])

  const createParty = useCallback(async (name, savedQuests = []) => {
    autoRejoinBlockedRef.current = true
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
    return data
  }, [])

  const forceJoinParty = useCallback(async (code, name, savedQuests = [], { autoRejoin = false } = {}) => {
    if (!autoRejoin) autoRejoinBlockedRef.current = true
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
    return data
  }, [patchOwnMember, updateMemberDB])

  const joinParty = useCallback(async (code, name, savedQuests = []) => {
    autoRejoinBlockedRef.current = true
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
    return data
  }, [forceJoinParty, patchOwnMember, updateMemberDB])

  useEffect(() => {
    if (!userId || !callsign || questsLoading || settingsLoading) return undefined

    const settle = () => {
      if (userIdRef.current === userId) setAutoRejoinSettled(true)
    }

    if (
      pendingJoinCode
      || partyRef.current
      || autoRejoinBlockedRef.current
      || resolveSetting('auto_rejoin', { user: userSettings }) !== true
    ) {
      settle()
      return undefined
    }
    if (autoRejoinAttemptedRef.current === userId) return undefined

    autoRejoinAttemptedRef.current = userId
    setAutoRejoinSettled(false)

    async function autoRejoin() {
      try {
        const { data: membership, error: membershipError } = await supabase
          .from('party_members')
          .select('party_id, joined_at')
          .eq('user_id', userId)
          .order('joined_at', { ascending: false })
          .limit(1)

        if (userIdRef.current !== userId) return
        if (membershipError) {
          settle()
          return
        }
        const partyId = membership?.[0]?.party_id
        if (!partyId) {
          settle()
          return
        }

        const { data: partyRow, error: partyError } = await supabase
          .from('parties')
          .select('code')
          .eq('id', partyId)
          .maybeSingle()

        if (userIdRef.current !== userId) return
        if (partyError || !partyRow?.code) {
          settle()
          return
        }
        if (partyRef.current || autoRejoinBlockedRef.current) {
          settle()
          return
        }

        await forceJoinParty(partyRow.code, callsign, savedQuests, { autoRejoin: true })
        settle()
      } catch {
        // A failed lookup or join still resolves the route bootstrap.
        settle()
      }
    }

    autoRejoin()
    return undefined
  }, [userId, callsign, savedQuests, questsLoading, settingsLoading, pendingJoinCode, userSettings, forceJoinParty])

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
    if (pingEventsWritable) {
      ignoreAsyncError(supabase.rpc('clear_party_ping_events', {
        p_code: codeRef.current,
        p_raid_id: Number(current.raid_id) || 0,
      }))
    }
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
    const changes = { [key]: !current.progress?.[key] }
    const progress = { ...(current.progress || {}), ...changes }
    applyParty({ ...current, progress })
    runAtomicPartyWrite(
      'merge_progress',
      { p_code: codeRef.current, p_changes: changes },
      'progress',
      () => updatePartyDB({ progress }),
    )
  }, [runAtomicPartyWrite, updatePartyDB])

  const toggleStar = useCallback(taskId => {
    const current = partyRef.current
    if (!current) return
    const changes = { [taskId]: !current.starred?.[taskId] }
    const starred = { ...(current.starred || {}), ...changes }
    applyParty({ ...current, starred })
    runAtomicPartyWrite(
      'merge_starred',
      { p_code: codeRef.current, p_changes: changes },
      'starred',
      () => updatePartyDB({ starred }),
    )
  }, [runAtomicPartyWrite, updatePartyDB])

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
    const changes = { [key]: !current.progress?.[key] }
    const progress = { ...(current.progress || {}), ...changes }
    applyParty({ ...current, progress })
    runAtomicPartyWrite(
      'merge_progress',
      { p_code: codeRef.current, p_changes: changes },
      'progress',
      () => updatePartyDB({ progress }),
    )
  }, [runAtomicPartyWrite, updatePartyDB])

  const submitMyProgress = useCallback(changes => {
    const current = partyRef.current
    if (!current) return
    const progressChanges = { ...(changes || {}) }
    const progress = { ...(current.progress || {}), ...progressChanges }
    applyParty({ ...current, progress })
    runAtomicPartyWrite(
      'merge_progress',
      { p_code: codeRef.current, p_changes: progressChanges },
      'progress',
      () => updatePartyDB({ progress }),
    )
  }, [runAtomicPartyWrite, updatePartyDB])

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
    const optimisticStroke = {
      ...stroke,
      user_id: currentUserId,
      user: stroke?.user || myNameRef.current,
      created_at: stroke?.created_at ?? Date.now(),
      raid_id: stroke?.raid_id ?? current.raid_id,
    }
    const drawings = [...(current.drawings || []), optimisticStroke]
    applyParty({ ...current, drawings })
    runAtomicPartyWrite(
      'append_drawing',
      { p_code: codeRef.current, p_stroke: optimisticStroke },
      'drawings',
      () => updatePartyDB({ drawings }),
    )
  }, [runAtomicPartyWrite, updatePartyDB])

  const clearMyStrokes = useCallback(() => {
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    const drawings = (current.drawings || []).filter(stroke => stroke.user_id
      ? stroke.user_id !== currentUserId
      : stroke.user !== myNameRef.current)
    applyParty({ ...current, drawings })
    runAtomicPartyWrite(
      'clear_my_drawings',
      { p_code: codeRef.current },
      'drawings',
      () => updatePartyDB({ drawings }),
    )
  }, [runAtomicPartyWrite, updatePartyDB])

  const addMarker = useCallback(marker => {
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    const optimisticMarker = {
      ...marker,
      user_id: currentUserId,
      user: marker?.user || myNameRef.current,
      created_at: marker?.created_at ?? Date.now(),
      raid_id: marker?.raid_id ?? current.raid_id,
    }
    const markers = [...(current.markers || []), optimisticMarker]
    applyParty({ ...current, markers })
    runAtomicPartyWrite(
      'append_marker',
      { p_code: codeRef.current, p_marker: optimisticMarker },
      'markers',
      () => updatePartyDB({ markers }),
    )
  }, [runAtomicPartyWrite, updatePartyDB])

  const clearMyMarkers = useCallback(() => {
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    const markers = (current.markers || []).filter(marker => marker.user_id
      ? marker.user_id !== currentUserId
      : marker.user !== myNameRef.current)
    applyParty({ ...current, markers })
    runAtomicPartyWrite(
      'clear_my_markers',
      { p_code: codeRef.current },
      'markers',
      () => updatePartyDB({ markers }),
    )
  }, [runAtomicPartyWrite, updatePartyDB])

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

  const addPing = useCallback(async ping => {
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    const enriched = {
      ...ping,
      user_id: currentUserId,
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

    // Prefer the normalized child-table path from 10_08_party_ping_events: it
    // deduplicates monitor events and avoids broadcasting the whole JSON array.
    // The JSON atomic RPC remains the compatibility path when that migration is
    // unavailable, and its own legacy fallback covers either deploy order.
    if (pingEventsWritable) {
      const { data: stored, error: eventError } = await supabase.rpc('append_party_ping', {
        p_code: current.code,
        p_raid_id: Number(current.raid_id) || 0,
        p_ping: enriched,
      })
      const storedPing = pingFromEvent(stored)
      if (!eventError && storedPing) {
        const latest = partyRef.current
        if (latest?.id === current.id && Number(latest.raid_id || 0) === Number(current.raid_id || 0)) {
          const latestTtl = Number(resolveSetting('ping_ttl_ms', {
            raid: latest.settings || {}, unit: null, user: userSettingsRef.current,
          }))
          const mergedPings = prunePings(
            [...(latest.pings || []), storedPing],
            Date.now(),
            Number.isFinite(latestTtl) ? latestTtl : undefined,
          )
          const mergedLog = latest.ping_log?.some(existing => existing.id === storedPing.id)
            ? latest.ping_log
            : appendLog(latest.ping_log, storedPing)
          applyParty({ ...latest, pings: mergedPings, ping_log: mergedLog })
        }
        return
      }
      pingEventsWritable = false
      if (eventError) console.warn('party_ping_events unavailable; using atomic JSON ping storage', eventError)
    }

    const pingLog = appendLog(current.ping_log, enriched)
    return runAtomicPartyWrite(
      'append_ping',
      { p_code: codeRef.current, p_ping: enriched },
      ['pings', 'ping_log'],
      async () => {
        const [pingsResult] = await Promise.all([
          updatePartyDB({ pings }),
          setPingLog(pingLog),
        ])
        return pingsResult
      },
    )
  }, [runAtomicPartyWrite, setPingLog, updatePartyDB])

  const clearPings = useCallback(async () => {
    const current = partyRef.current
    if (!current) return
    applyParty({ ...current, pings: [] })
    if (pingEventsWritable) {
      const { error: clearError } = await supabase.rpc('clear_party_ping_events', {
        p_code: current.code,
        p_raid_id: Number(current.raid_id) || 0,
      })
      if (clearError) {
        pingEventsWritable = false
        console.warn('party_ping_events clear unavailable; using legacy JSON ping storage', clearError)
      }
    }
    return runAtomicPartyWrite(
      'clear_pings',
      { p_code: codeRef.current },
      'pings',
      () => updatePartyDB({ pings: [] }),
    )
  }, [runAtomicPartyWrite, updatePartyDB])

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
    autoRejoinBlockedRef.current = true
    clearPartyState()
    setError('')
    if (code) {
      const { error: rpcError } = await supabase.rpc('leave_party', { p_code: code })
      return !rpcError
    }
    return true
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
    autoRejoinSettled,
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
