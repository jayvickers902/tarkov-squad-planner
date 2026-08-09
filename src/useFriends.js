import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

function otherUserId(row, userId) {
  return row.requester_id === userId ? row.addressee_id : row.requester_id
}

export function useFriends(userId, myCallsign) {
  const [friends, setFriends]       = useState([]) // [{ user_id, callsign, partyCode }]
  const [pendingIn, setPendingIn]   = useState([]) // [{ id, user_id, callsign }]
  const [pendingOut, setPendingOut] = useState([]) // [{ id, user_id, callsign }]
  const [loading, setLoading]       = useState(false)

  const refresh = useCallback(async () => {
    if (!userId) return
    setLoading(true)

    const { data: rows, error: rowsError } = await supabase
      .from('friendships')
      .select('id, requester_id, addressee_id, status, created_at')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .order('created_at', { ascending: true })

    if (rowsError || !rows) { setLoading(false); return }

    const otherIds = [...new Set(rows.map(row => otherUserId(row, userId)).filter(Boolean))]
    const { data: profiles } = otherIds.length
      ? await supabase.from('profiles').select('id, callsign').in('id', otherIds)
      : { data: [] }
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

    const { data: partyData } = await supabase.rpc('get_friend_parties', { p_user_ids: acceptedIds })
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

  const sendRequest = useCallback(async (callsign) => {
    const trimmed = callsign.trim()
    if (!userId) return 'Not signed in'
    if (!trimmed) return 'Enter a callsign'
    if (trimmed.toLowerCase() === myCallsign?.toLowerCase()) return "That's you"
    if (friends.find(friend => friend.callsign.toLowerCase() === trimmed.toLowerCase())) return 'Already friends'
    if (pendingOut.find(friend => friend.callsign.toLowerCase() === trimmed.toLowerCase())) return 'Request already sent'
    if (pendingIn.find(friend => friend.callsign.toLowerCase() === trimmed.toLowerCase())) return 'They sent you a request - check incoming'

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, callsign')
      .ilike('callsign', trimmed)
      .maybeSingle()
    if (!profile) return 'Callsign not found'

    const { error } = await supabase
      .from('friendships')
      .insert({ requester_id: userId, addressee_id: profile.id, status: 'pending' })
    if (error) return error.message
    await refresh()
    return null
  }, [userId, myCallsign, friends, pendingIn, pendingOut, refresh])

  const acceptRequest = useCallback(async (id) => {
    const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id)
    if (!error) await refresh()
  }, [refresh])

  const removeRequest = useCallback(async (id) => {
    await supabase.from('friendships').delete().eq('id', id)
    await refresh()
  }, [refresh])

  const removeFriend = useCallback(async (friendUserId) => {
    await supabase
      .from('friendships')
      .delete()
      .eq('requester_id', userId)
      .eq('addressee_id', friendUserId)
    await supabase
      .from('friendships')
      .delete()
      .eq('requester_id', friendUserId)
      .eq('addressee_id', userId)
    await refresh()
  }, [userId, refresh])

  return { friends, pendingIn, pendingOut, loading, sendRequest, acceptRequest, removeRequest, removeFriend, refresh }
}
