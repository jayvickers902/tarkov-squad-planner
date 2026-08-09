import { useState, useEffect } from 'react'
import { supabase } from './supabase'

export function useAuth() {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    let cancelled = false

    async function fetchProfile(userId) {
      const { data } = await supabase
        .from('profiles')
        .select('id, callsign, is_admin')
        .eq('id', userId)
        .maybeSingle()
      if (cancelled) return
      setProfile(data || null)
      setLoading(false)
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  async function loginWithGoogle() {
    setError('')
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (err) { setError(err.message); return false }
    return true
  }

  // Called after Google sign-in when the user has no profile yet.
  async function createProfile(callsign) {
    setError('')
    const trimmed = callsign.trim()
    if (!trimmed) { setError('Enter a callsign'); return false }
    if (trimmed.length > 20) { setError('Callsign must be 20 characters or fewer'); return false }
    if (!/^[a-zA-Z0-9_\- ]+$/.test(trimmed)) { setError('Callsign can only contain letters, numbers, spaces, - and _'); return false }

    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('callsign', trimmed)
      .maybeSingle()
    if (existing) { setError('That callsign is already taken'); return false }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { setError('Not signed in'); return false }

    const { error: profErr } = await supabase
      .from('profiles')
      .insert({ id: session.user.id, callsign: trimmed })
    if (profErr) { setError(profErr.message); return false }

    setProfile({ id: session.user.id, callsign: trimmed, is_admin: false })
    return true
  }

  async function logout() {
    await supabase.auth.signOut()
  }

  return {
    user,
    profile,
    loading,
    error,
    setError,
    logout,
    loginWithGoogle,
    createProfile,
  }
}
