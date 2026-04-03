import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

export function useFriends(userId) {
  const [friends, setFriends] = useState([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!userId) return
    setLoading(true)

    const { data: rows } = await supabase
      .from('friendships')
      .select('friend_callsign')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    const callsigns = (rows || []).map(r => r.friend_callsign)
    if (!callsigns.length) { setFriends([]); setLoading(false); return }

    const { data: partyData } = await supabase.rpc('get_friend_parties', {
      p_callsigns: callsigns,
    })

    setFriends(callsigns.map(callsign => ({
      callsign,
      partyCode: partyData?.find(p => p.callsign === callsign)?.code ?? null,
    })))
    setLoading(false)
  }, [userId])

  useEffect(() => { refresh() }, [refresh])

  const addFriend = useCallback(async (callsign, myCallsign) => {
    const trimmed = callsign.trim()
    if (!trimmed) return 'Enter a callsign'
    if (trimmed.toLowerCase() === myCallsign.toLowerCase()) return "That's you"
    if (friends.find(f => f.callsign.toLowerCase() === trimmed.toLowerCase())) return 'Already added'

    const { data: prof } = await supabase
      .from('profiles')
      .select('callsign')
      .ilike('callsign', trimmed)
      .maybeSingle()
    if (!prof) return 'Callsign not found'

    const { error } = await supabase
      .from('friendships')
      .insert({ user_id: userId, friend_callsign: prof.callsign })
    if (error) return error.message

    await refresh()
    return null
  }, [userId, friends, refresh])

  const removeFriend = useCallback(async (callsign) => {
    await supabase
      .from('friendships')
      .delete()
      .eq('user_id', userId)
      .eq('friend_callsign', callsign)
    await refresh()
  }, [userId, refresh])

  return { friends, loading, addFriend, removeFriend, refresh }
}
