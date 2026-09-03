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
import { nextDelay, recordFailure, recordSuccess } from './supabaseHealth'

function saveLastPartyCode(code) {
  try {
    if (code) localStorage.setItem('lastPartyCode', code)
    else localStorage.removeItem('lastPartyCode')
  } catch { /* local storage is optional */ }
}

export function settleOptimisticPing(pings, storedPing, now = Date.now(), ttl) {
  const current = Array.isArray(pings) ? pings : []
  if (!storedPing || !current.some(existing => existing.id === storedPing.id)) return null
  return prunePings([...current.filter(existing => existing.id !== storedPing.id), storedPing], now, ttl)
}

function upsertPingLog(log, ping) {
  return appendLog((Array.isArray(log) ? log : []).filter(existing => existing.id !== ping.id), ping)
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

export function partySignature(data) {
  if (!data) return ''
  return [
    data.raid_id ?? 0,
    data.map_norm ?? '',
    data.spawn ?? '',
    (data.drawings || []).length,
    (data.markers || []).length,
    (data.pings || []).length,
    (data.ping_log || []).length,
    Object.keys(data.progress || {}).length,
    Object.keys(data.starred || {}).length,
    (data.members || []).length,
  ].join('|')
}

function sameMemberExceptLastSeen(cached, incoming) {
  if (!cached || !incoming) return false
  return cached.callsign === incoming.callsign
    && cached.role === incoming.role
    // joined_at is deliberately not compared. It is set once at insert and never
    // updated -- join_party_secure's on-conflict branch writes only callsign,
    // quests, quests_all and last_seen -- so it cannot change on an UPDATE. It is
    // also the one field whose text form differs between the two paths that feed
    // this comparison: the cached row comes from PostgREST, payload.new from the
    // realtime WAL decoder. Comparing it risks always-false, which would silently
    // turn this whole guard back into an unconditional refetch.
    && JSON.stringify(cached.quests) === JSON.stringify(incoming.quests)
    && JSON.stringify(cached.quests_all) === JSON.stringify(incoming.quests_all)
}

// Recovery paths want the old contract: a failed read degrades to null rather
// than throwing. Only the poll loop needs to tell "query failed" apart from "no
// such party", because only it feeds the backoff breaker. Everything else is
// already handling a failure and must not raise a second one on the way out.
async function fetchPartyByIdSafe(partyId) {
  try {
    const fresh = await fetchPartyById(partyId)
    recordSuccess()
    return fresh
  } catch (fetchError) {
    recordFailure(fetchError)
    return null
  }
}

async function fetchPartyById(partyId) {
  if (!partyId) return null
  const [partyResult, membersResult] = await Promise.all([
    supabase.from('parties').select().eq('id', partyId).maybeSingle(),
    supabase.from('party_members').select().eq('party_id', partyId).order('joined_at', { ascending: true }),
  ])
  if (partyResult.error) throw partyResult.error
  if (membersResult.error) throw membersResult.error
  if (!partyResult.data) return null
  const party = normalizeParty(partyResult.data, membersResult.data || [])

  // Position events are the source of truth for the current raid. Keep this
  // read best-effort so a transient event-query failure does not hide the room.
  try {
    const { data: eventRows, error: eventError } = await supabase
      .from('party_ping_events')
      .select('id, party_id, raid_id, user_id, callsign, source_event_id, map_norm, x, y, z, yaw, taps, client_at, server_at')
      .eq('party_id', party.id)
      .eq('raid_id', party.raid_id ?? 0)
      .order('server_at', { ascending: true })
    if (!eventError && Array.isArray(eventRows)) {
      const events = eventRows.map(pingFromEvent).filter(Boolean)
      const byId = new Map()
      ;[...(party.pings || []), ...events].forEach(ping => {
        if (ping?.id && !byId.has(ping.id)) byId.set(ping.id, ping)
      })
      party.pings = prunePings([...byId.values()])
      party.ping_log = [...(Array.isArray(party.ping_log) ? party.ping_log : []), ...events]
        .reduce((log, ping) => appendLog(log, ping), [])
    }
  } catch {
    // Keep the last snapshot; the next poll can recover.
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

/**
 * A member's party row is *derived* from their own `user_quests`, never merged
 * into. Nothing else can repair it: `party_members.quests` is written only by
 * that member's own client, so an entry that survives a sync survives forever
 * and shows every teammate an owner chip for a quest its owner does not have.
 *
 * There is deliberately no "keep what is already in the row" branch. The one
 * thing such a branch would protect -- a quest added ad-hoc inside the party --
 * does not need it: the only path that adds one (`handleAddPartyQuest`) also
 * writes it to `user_quests`, so it comes back through `savedQuests` on its own.
 */
export function derivePartyQuestRow(savedQuests, mapNorm, progress, userId) {
  const completedIds = completedQuestIds(progress, userId)
  return {
    quests: questsForMap(savedQuests, mapNorm).filter(quest => !completedIds.has(quest.id)),
    questsAll: allQuestEntries(savedQuests),
  }
}

/**
 * The quest payload an auto-rejoin may seed a member row with.
 *
 * On load the party is not known yet, so the quest list belongs to whichever
 * character the *user-level* `game_mode` selected. Seeding a party row with
 * another character's quests is silent and permanent -- `autoRejoinAttemptedRef`
 * allows exactly one attempt -- so a mode we cannot vouch for contributes
 * nothing and the mode-matched sync fills the row instead.
 */
export function autoRejoinQuestPayload(partyGameMode, savedQuestsMode, savedQuests = []) {
  if (partyGameMode && partyGameMode !== savedQuestsMode) return []
  return savedQuests
}

function isPartyFullMessage(message) {
  return /party is full|full \(max/i.test(message || '')
}

export function useParty(userId, userSettings = {}, {
  callsign = '',
  savedQuests = [],
  savedQuestsMode = null,
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
    let refreshInFlight = false

    async function refreshFromDatabase() {
      if (refreshInFlight) return
      refreshInFlight = true
      try {
        const fresh = await fetchPartyById(partyId)
        recordSuccess()
        if (cancelled || !fresh) return
        const pending = pendingFieldsRef.current
        const merged = { ...(partyRef.current || {}), ...fresh }
        for (const key of pending) {
          if (partyRef.current && Object.prototype.hasOwnProperty.call(partyRef.current, key)) {
            merged[key] = partyRef.current[key]
          }
        }
        if (partySignature(merged) !== partySignature(partyRef.current)) {
          applyParty(merged)
          return
        }
        if (JSON.stringify(comparableParty(merged)) === JSON.stringify(comparableParty(partyRef.current))) return
        applyParty(merged)
      } catch (refreshError) {
        recordFailure(refreshError)
      } finally {
        refreshInFlight = false
      }
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
        if (partyRef.current) {
          merged.pings = partyRef.current.pings
          merged.ping_log = partyRef.current.ping_log
        }
        applyParty(merged)
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'party_members', filter: `party_id=eq.${partyId}`,
      }, payload => {
        if (payload?.eventType === 'UPDATE') {
          const incoming = payload.new
          const cachedMember = incoming?.user_id
            ? partyRef.current?.members?.find(member => member.user_id === incoming.user_id)
            : null
          if (cachedMember && sameMemberExceptLastSeen(cachedMember, incoming)) {
            cachedMember.last_seen = incoming.last_seen ?? null
            return
          }
        }
        refreshFromDatabase()
      })
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
    const receivePingEvent = payload => {
      const event = payload?.new
      const current = partyRef.current
      if (!event || !current || Number(event.raid_id) !== Number(current.raid_id ?? 0)) return
      const ping = pingFromEvent(event)
      if (!ping) return
      const ttl = Number(resolveSetting('ping_ttl_ms', {
        raid: current.settings || {}, unit: null, user: userSettingsRef.current,
      }))
      const pings = prunePings(
        [...(current.pings || []).filter(existing => existing.id !== ping.id), ping],
        Date.now(),
        Number.isFinite(ttl) ? ttl : undefined,
      )
      applyParty({ ...current, pings, ping_log: upsertPingLog(current.ping_log, ping) })
    }
    const pingChannel = supabase
      .channel(`party-pings-${partyId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'party_ping_events', filter: `party_id=eq.${partyId}`,
      }, receivePingEvent)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'party_ping_events', filter: `party_id=eq.${partyId}`,
      }, receivePingEvent)
      .subscribe()

    let poll = null
    let heartbeat = null

    function stopTimers() {
      if (poll) clearTimeout(poll)
      if (heartbeat) clearTimeout(heartbeat)
      poll = null
      heartbeat = null
    }

    function schedulePoll() {
      if (document.hidden || cancelled) return
      poll = setTimeout(async () => {
        poll = null
        await refreshFromDatabase()
        schedulePoll()
      }, nextDelay(15000))
    }

    async function runHeartbeat() {
      try {
        const result = await supabase.rpc('heartbeat', { p_code: code })
        if (result?.error) throw result.error
        recordSuccess()
      } catch (heartbeatError) {
        recordFailure(heartbeatError)
      }
    }

    function scheduleHeartbeat() {
      if (document.hidden || cancelled) return
      heartbeat = setTimeout(async () => {
        heartbeat = null
        await runHeartbeat()
        scheduleHeartbeat()
      }, nextDelay(30000))
    }

    function startTimers() {
      if (document.hidden || cancelled) return
      stopTimers()
      schedulePoll()
      scheduleHeartbeat()
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
    const { quests: merged } = derivePartyQuestRow(savedQuestsRef.current, current.map_norm, current.progress, currentUserId)
    const changed = JSON.stringify(merged) !== JSON.stringify(mine.quests)
    if (changed) updateMemberDB({ quests: merged })
  }, [party?.map_norm, userId]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const runAtomicPartyWrite = useCallback(async (rpcName, params, fields) => {
    const fieldNames = Array.isArray(fields) ? fields : [fields]
    fieldNames.forEach(field => pendingFieldsRef.current.add(field))

    try {
      const result = await supabase.rpc(rpcName, params)
      if (!result.error) {
        if (result.data) {
          const current = partyRef.current
          applyParty(!fieldNames.includes('pings') && current
            ? { ...result.data, pings: current.pings, ping_log: current.ping_log }
            : result.data)
        }
        setError('')
        return result
      }
      setError(result.error.message || 'Party sync failed. Refresh and try again.')
      const fresh = await fetchPartyByIdSafe(partyIdRef.current)
      if (fresh) applyParty(fresh)
      return result
    } catch (writeError) {
      setError('Party sync failed. Check your connection and try again.')
      const fresh = await fetchPartyByIdSafe(partyIdRef.current)
      if (fresh) applyParty(fresh)
      return { data: null, error: writeError }
    } finally {
      fieldNames.forEach(field => pendingFieldsRef.current.delete(field))
    }
  }, [])

  const createParty = useCallback(async (name, gameMode, savedQuests = []) => {
    autoRejoinBlockedRef.current = true
    setLoading(true); setError('')
    savedQuestsRef.current = savedQuests
    const { data, error: rpcError } = await supabase.rpc('create_party', {
      p_game_mode: gameMode,
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
          .select('code, game_mode')
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

        const payload = autoRejoinQuestPayload(partyRow.game_mode, savedQuestsMode, savedQuests)
        await forceJoinParty(partyRow.code, callsign, payload, { autoRejoin: true })
        settle()
      } catch {
        // A failed lookup or join still resolves the route bootstrap.
        settle()
      }
    }

    autoRejoin()
    return undefined
  }, [userId, callsign, savedQuests, savedQuestsMode, questsLoading, settingsLoading, pendingJoinCode, userSettings, forceJoinParty])

  const selectMap = useCallback(async map => {
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    if (current.leader_id !== currentUserId && resolveSetting('members_can_change_map', {
      raid: current.settings || {}, unit: null, user: userSettingsRef.current,
    }) !== true) return

    const { quests: merged } = derivePartyQuestRow(savedQuestsRef.current, map.normalizedName, current.progress, currentUserId)
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
    const current = partyRef.current
    applyParty({ ...current, spawn: spawnId })
    runAtomicPartyWrite('set_party_spawn', {
      p_code: codeRef.current,
      p_spawn: spawnId,
    }, 'spawn')
  }, [runAtomicPartyWrite])

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
    )
  }, [runAtomicPartyWrite])

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
    )
  }, [runAtomicPartyWrite])

  const reorderQuests = useCallback(orderedIds => {
    const current = partyRef.current
    if (!current) return
    applyParty({ ...current, quest_order: orderedIds })
    runAtomicPartyWrite('set_party_quest_order', {
      p_code: codeRef.current,
      p_order: orderedIds,
    }, 'quest_order')
  }, [runAtomicPartyWrite])

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
    )
  }, [runAtomicPartyWrite])

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
    )
  }, [runAtomicPartyWrite])

  const setRaidSettings = useCallback(changes => {
    const current = partyRef.current
    if (!current || current.leader_id !== userIdRef.current) return
    const settings = { ...(current.settings || {}), ...(changes || {}) }
    applyParty({ ...current, settings })
    runAtomicPartyWrite('set_party_settings', {
      p_code: codeRef.current,
      p_changes: changes,
    }, 'settings')
  }, [runAtomicPartyWrite])

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
    )
  }, [runAtomicPartyWrite])

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
    )
  }, [runAtomicPartyWrite])

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
    )
  }, [runAtomicPartyWrite])

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
    )
  }, [runAtomicPartyWrite])

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
      [...(current.pings || []).filter(existing => existing.id !== enriched.id), enriched],
      Date.now(),
      Number.isFinite(ttl) ? ttl : undefined,
    )
    applyParty({ ...current, pings })

    const { data: stored, error: eventError } = await supabase.rpc('append_party_ping', {
      p_code: current.code,
      p_raid_id: Number(current.raid_id) || 0,
      p_ping: enriched,
    })
    const storedPing = pingFromEvent(stored)
    if (eventError || !storedPing) {
      setError(eventError?.message || 'Position sync failed. Try again.')
      const fresh = await fetchPartyByIdSafe(partyIdRef.current)
      if (fresh) applyParty(fresh)
      return { data: null, error: eventError }
    }
    const latest = partyRef.current
    if (latest?.id === current.id && Number(latest.raid_id || 0) === Number(current.raid_id || 0)) {
      const latestTtl = Number(resolveSetting('ping_ttl_ms', {
        raid: latest.settings || {}, unit: null, user: userSettingsRef.current,
      }))
      // The optimistic ping is also the in-flight clear guard: if CLEAR removed
      // it while the RPC was pending, the response must not resurrect it.
      const mergedPings = settleOptimisticPing(
        latest.pings,
        storedPing,
        Date.now(),
        Number.isFinite(latestTtl) ? latestTtl : undefined,
      )
      if (!mergedPings) {
        setError('')
        return { data: stored, error: null }
      }
      // source_event_id round-trips as the ping id, so the optimistic entry is
      // already authoritative for this list. Keep it instead of stacking the
      // stored event at the same coordinates.
      const mergedLog = upsertPingLog(latest.ping_log, storedPing)
      applyParty({ ...latest, pings: mergedPings, ping_log: mergedLog })
    }
    setError('')
    return { data: stored, error: null }
  }, [])

  const clearPings = useCallback(async () => {
    const current = partyRef.current
    if (!current) return
    const currentUserId = userIdRef.current
    const pings = current.leader_id === currentUserId
      ? []
      : (current.pings || []).filter(ping => ping.user_id !== currentUserId)
    applyParty({ ...current, pings })
    return runAtomicPartyWrite(
      'clear_pings',
      { p_code: codeRef.current },
      'pings',
    )
  }, [runAtomicPartyWrite])

  const startRaid = useCallback(() => {
    const current = partyRef.current
    if (!current || current.leader_id !== userIdRef.current) return
    const raidId = (Number.isInteger(current.raid_id) ? current.raid_id : 0) + 1
    const progress = { ...(current.progress || {}), __raid_start__: Date.now() }
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
    runAtomicPartyWrite('start_party_raid', { p_code: codeRef.current }, Object.keys(changes))
  }, [runAtomicPartyWrite])

  const sweepEphemeral = useCallback(changes => {
    const current = partyRef.current
    if (!current || current.leader_id !== userIdRef.current || !changes) return
    applyParty({ ...current, ...changes })
    return runAtomicPartyWrite('sweep_party_ephemeral', {
      p_code: codeRef.current,
      p_raid_id: Number(current.raid_id) || 0,
    }, ['markers', 'drawings'])
  }, [runAtomicPartyWrite])

  const refreshParty = useCallback(async () => {
    const fresh = await fetchPartyByIdSafe(partyIdRef.current)
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
    savedQuestsRef.current = quests
    const current = partyRef.current
    const currentUserId = userIdRef.current
    if (!current || !currentUserId) return
    const mine = findMember(current.members, currentUserId)
    if (!mine) return

    const { quests: merged, questsAll } = derivePartyQuestRow(quests, current.map_norm, current.progress, currentUserId)
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
