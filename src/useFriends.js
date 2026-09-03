import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabase'

function otherUserId(row, userId) {
  return row.requester_id === userId ? row.addressee_id : row.requester_id
}

// A friendship has no canonical endpoint orientation: either user may have
// sent the request. Keep removal as one PostgREST DELETE statement so both
// rows (including a legacy duplicate orientation) are removed atomically.
export function friendshipPairFilter(userId, friendUserId) {
  return `and(requester_id.eq.${userId},addressee_id.eq.${friendUserId}),and(requester_id.eq.${friendUserId},addressee_id.eq.${userId})`
}

export function useFriends(userId, myCallsign) {
  const [friends, setFriends]       = useState([]) // [{ user_id, callsign, partyCode }]
  const [pendingIn, setPendingIn]   = useState([]) // [{ id, user_id, callsign }]
  const [pendingOut, setPendingOut] = useState([]) // [{ id, user_id, callsign }]
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const requestsInFlightRef         = useRef(new Set())

  const refresh = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError('')

    const { data: rows, error: rowsError } = await supabase
      .from('friendships')
      .select('id, requester_id, addressee_id, status, created_at')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .order('created_at', { ascending: true })

    if (rowsError || !rows) {
      setError(rowsError?.message || 'Could not refresh friends. Try again.')
      setLoading(false)
      return
    }

    const otherIds = [...new Set(rows.map(row => otherUserId(row, userId)).filter(Boolean))]
    const { data: profiles, error: profilesError } = otherIds.length
      ? await supabase.from('profiles').select('id, callsign').in('id', otherIds)
      : { data: [], error: null }
    if (profilesError) setError('Friend names could not be refreshed. Try again.')
    const callsignById = Object.fromEntries((profiles || []).map(profile => [profile.id, profile.callsign]))
    const displayName = id => callsignById[id] || id

    const acceptedIds = []
    const incoming = []
    const outgoing = []

    for (const row of rows) {
      const otherId = otherUserId(row, userId)
      const entry = { id: row.id, user_id: otherId, callsign: displayName(otherId) }
      if (row.status === 'accepted') acceptedIds.push(otherId)
      else if (row.requester_id === userId) outgoing.push(entry)
      else incoming.push(entry)
    }

    setPendingIn(incoming)
    setPendingOut(outgoing)

    if (!acceptedIds.length) {
      setFriends([])
      setLoading(false)
      return
    }

    const { data: partyData, error: partyError } = await supabase.rpc('get_friend_parties', { p_user_ids: acceptedIds })
    if (partyError) setError('Friend party status could not be refreshed. Try again.')
    setFriends(acceptedIds.map(friendId => {
      const party = partyData?.find(row => row.user_id === friendId)
      return {
        user_id: friendId,
        callsign: party?.callsign || displayName(friendId),
        partyCode: party?.code ?? null,
      }
    }))
    setLoading(false)
  }, [userId])

  useEffect(() => { refresh() }, [refresh])

  const sendRequest = useCallback(async (target, targetCallsign = '') => {
    const isMemberTarget = target && typeof target === 'object'
    const targetUserId = isMemberTarget ? target.userId : (targetCallsign ? target : null)
    const requestedCallsign = isMemberTarget ? target.callsign : (targetCallsign || target)
    const trimmed = (requestedCallsign || '').trim()
    if (!userId) return 'Not signed in'
    if (!targetUserId && !trimmed) return 'Enter a callsign'
    if (targetUserId && targetUserId === userId) return "That's you"
    if (!targetUserId && trimmed.toLowerCase() === myCallsign?.toLowerCase()) return "That's you"

    const matchesTarget = entry => targetUserId
      ? entry.user_id === targetUserId
      : entry.callsign.toLowerCase() === trimmed.toLowerCase()
    if (friends.find(matchesTarget)) return 'Already friends'
    if (pendingOut.find(matchesTarget)) return 'Request already sent'
    if (pendingIn.find(matchesTarget)) return 'They sent you a request - check incoming'

    const requestKey = targetUserId ? `user:${targetUserId}` : `callsign:${trimmed.toLowerCase()}`
    if (requestsInFlightRef.current.has(requestKey)) return 'Request already sent'
    requestsInFlightRef.current.add(requestKey)

    try {
      let addresseeId = targetUserId
      if (!addresseeId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .ilike('callsign', trimmed)
          .maybeSingle()
        if (!profile) return 'Callsign not found'
        addresseeId = profile.id
      }

      const { error } = await supabase
        .from('friendships')
        .insert({ requester_id: userId, addressee_id: addresseeId, status: 'pending' })
      if (error) return error.message
      await refresh()
      return null
    } finally {
      requestsInFlightRef.current.delete(requestKey)
    }
  }, [userId, myCallsign, friends, pendingIn, pendingOut, refresh])

  const acceptRequest = useCallback(async (id) => {
    const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id)
    if (error) { setError(error.message); return error.message }
    await refresh()
    return null
  }, [refresh])

  const removeRequest = useCallback(async (id) => {
    const { error } = await supabase.from('friendships').delete().eq('id', id)
    if (error) { setError(error.message); return error.message }
    await refresh()
    return null
  }, [refresh])

  const removeFriend = useCallback(async (friendUserId) => {
    const { error } = await supabase
      .from('friendships')
      .delete()
      .or(friendshipPairFilter(userId, friendUserId))
    if (error) {
      const message = error.message || 'Could not remove friend.'
      setError(message)
      return message
    }
    await refresh()
    return null
  }, [userId, refresh])

  return { friends, pendingIn, pendingOut, loading, error, sendRequest, acceptRequest, removeRequest, removeFriend, refresh }
}
