import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'
import { AUTH_PROVIDERS } from '../shared/authProviders.js'

const PROFILE_SCHEMA_MESSAGE = 'Database schema is out of date. Apply Supabase migrations 10_01 through 10_10, then reload.'

function profileLoadMessage(error) {
  if (error?.code === 'PGRST204' || error?.code === 'PGRST205' || error?.code === '42703' || error?.code === '42P01') {
    return PROFILE_SCHEMA_MESSAGE
  }
  return 'Could not load your profile. Check your connection and reload.'
}

export function useAuth() {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [profileError, setProfileError] = useState('')
  const [isNewProfile, setIsNewProfile] = useState(false)
  const createInFlight = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function fetchProfile() {
      const { data, error: profileErr } = await supabase.rpc('current_profile')
      if (cancelled) return
      if (profileErr) {
        setProfile(null)
        setProfileError(profileLoadMessage(profileErr))
        setLoading(false)
        return
      }
      setProfileError('')
      const currentProfile = Array.isArray(data) ? data[0] || null : data || null
      setProfile(currentProfile)
      setLoading(false)
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile()
      else {
        setProfile(null)
        setProfileError('')
        setIsNewProfile(false)
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile()
      else {
        setProfile(null)
        setProfileError('')
        setIsNewProfile(false)
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  async function loginWithProvider(provider) {
    setError('')
    if (!AUTH_PROVIDERS.includes(provider)) {
      setError('That sign-in option is not available')
      return false
    }
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    })
    if (err) { setError(err.message); return false }
    return true
  }

  // Called after OAuth sign-in when the user has no profile yet.
  async function createProfile(callsign) {
    if (createInFlight.current) return false
    createInFlight.current = true
    setError('')
    try {
      if (profileError) { setError(profileError); return false }

      const trimmed = callsign.trim()
      if (!trimmed) { setError('Enter a callsign'); return false }
      if (trimmed.length > 20) { setError('Callsign must be 20 characters or fewer'); return false }
      if (!/^[a-zA-Z0-9_\- ]+$/.test(trimmed)) { setError('Callsign can only contain letters, numbers, spaces, - and _'); return false }

      const { data: existing, error: existingErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('callsign', trimmed)
        .maybeSingle()
      if (existingErr) { setError(profileLoadMessage(existingErr)); return false }
      if (existing) { setError('That callsign is already taken'); return false }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { setError('Not signed in'); return false }

      const { error: profErr } = await supabase
        .from('profiles')
        .insert({ id: session.user.id, callsign: trimmed })
      if (profErr) {
        if (profErr.code === '23505' && profErr.message?.includes('profiles_pkey')) {
          setError('This account already has a profile. Reload to continue.')
        } else {
          setError(profErr.message)
        }
        return false
      }

      setProfile({ id: session.user.id, callsign: trimmed, is_admin: false })
      setProfileError('')
      setIsNewProfile(true)
      return true
    } finally {
      createInFlight.current = false
    }
  }

  async function logout() {
    await supabase.auth.signOut()
  }

  return {
    user,
    profile,
    profileError,
    isNewProfile,
    loading,
    error,
    setError,
    logout,
    loginWithProvider,
    createProfile,
  }
}
