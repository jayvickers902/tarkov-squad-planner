import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

export function useFriends(userId, myCallsign) {
  const [friends, setFriends]       = useState([]) // [{ callsign, partyCode }]
  const [pendingIn, setPendingIn]   = useState([]) // [{ id, callsign }]
  const [pendingOut, setPendingOut] = useState([]) // [{ id, callsign }]
  const [loading, setLoading]       = useState(false)

  const refresh = useCallback(async () => {
    if (!userId || !myCallsign) return
    setLoading(true)

    const { data: rows } = await supabase
      .from('friendships')
      .select('id, requester_id, requester_callsign, addressee_callsign, status')
      .or(`requester_id.eq.${userId},addressee_callsign.eq.${myCallsign}`)
      .order('created_at', { ascending: true })

    if (!rows) { setLoading(false); return }

    const accepted = []
    const incoming = []
    const outgoing = []

    for (const row of rows) {
      if (row.status === 'accepted') {
        accepted.push(row.requester_id === userId ? row.addressee_callsign : row.requester_callsign)
      } else {
        if (row.requester_id === userId) outgoing.push({ id: row.id, callsign: row.addressee_callsign })
        else incoming.push({ id: row.id, callsign: row.requester_callsign })
      }
    }

    setPendingIn(incoming)
    setPendingOut(outgoing)

    if (!accepted.length) { setFriends([]); setLoading(false); return }

    const { data: partyData } = await supabase.rpc('get_friend_parties', { p_callsigns: accepted })

    setFriends(accepted.map(callsign => ({
      callsign,
      partyCode: partyData?.find(p => p.callsign === callsign)?.code ?? null,
    })))
    setLoading(false)
  }, [userId, myCallsign])

  useEffect(() => { refresh() }, [refresh])

  const sendRequest = useCallback(async (callsign) => {
    const trimmed = callsign.trim()
    if (!trimmed) return 'Enter a callsign'
    if (trimmed.toLowerCase() === myCallsign?.toLowerCase()) return "That's you"
    if (friends.find(f => f.callsign.toLowerCase() === trimmed.toLowerCase())) return 'Already friends'
    if (pendingOut.find(f => f.callsign.toLowerCase() === trimmed.toLowerCase())) return 'Request already sent'
    if (pendingIn.find(f => f.callsign.toLowerCase() === trimmed.toLowerCase())) return 'They sent you a request — check incoming'

    const { data: prof } = await supabase
      .from('profiles')
      .select('callsign')
      .ilike('callsign', trimmed)
      .maybeSingle()
    if (!prof) return 'Callsign not found'

    const { error } = await supabase
      .from('friendships')
      .insert({ requester_id: userId, requester_callsign: myCallsign, addressee_callsign: prof.callsign, status: 'pending' })
    if (error) return error.message
    await refresh()
    return null
  }, [userId, myCallsign, friends, pendingIn, pendingOut, refresh])

  const acceptRequest = useCallback(async (id) => {
    const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id)
    if (!error) await refresh()
  }, [refresh])

  // Decline incoming or withdraw outgoing — both are just deletes by id
  const removeRequest = useCallback(async (id) => {
    await supabase.from('friendships').delete().eq('id', id)
    await refresh()
  }, [refresh])

  const removeFriend = useCallback(async (callsign) => {
    // Friendship may exist in either direction — delete both (one will be a no-op)
    await supabase.from('friendships').delete().eq('requester_callsign', myCallsign).eq('addressee_callsign', callsign)
    await supabase.from('friendships').delete().eq('requester_callsign', callsign).eq('addressee_callsign', myCallsign)
    await refresh()
  }, [myCallsign, refresh])

  return { friends, pendingIn, pendingOut, loading, sendRequest, acceptRequest, removeRequest, removeFriend, refresh }
}
