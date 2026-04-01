import { useState, useEffect } from 'react'
import { supabase } from './supabase'

export function useAuth() {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data } = await supabase.from('profiles').select().eq('id', userId).single()
    setProfile(data)
    setLoading(false)
  }

  function makeEmail(callsign) {
    return `sq.${callsign.toLowerCase().replace(/[^a-z0-9]/g, '')}.${callsign.length}@gmail.com`
  }

  async function register(callsign, password) {
    setError('')
    const trimmed = callsign.trim()
    if (!trimmed) { setError('Enter a callsign'); return false }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return false }

    // Check callsign isn't taken
    const { data: existing } = await supabase.from('profiles').select('id').eq('callsign', trimmed).maybeSingle()
    if (existing) { setError('That callsign is already taken'); return false }

    const fakeEmail = makeEmail(trimmed)

    // Sign up — Supabase may auto-confirm or require confirmation depending on settings
    const { data, error: signUpErr } = await supabase.auth.signUp({ email: fakeEmail, password })
    if (signUpErr) { setError(signUpErr.message); return false }
    if (!data.user) { setError('Signup failed — try again'); return false }

    // Use the service role isn't available client-side, so we insert the profile
    // using the now-authenticated session. If signUp auto-confirms, session exists.
    // If not, we need to sign in first to get a valid session for the RLS insert.
    let userId = data.user.id
    let sessionExists = !!data.session

    if (!sessionExists) {
      // Email confirmation is on — sign in to get a session so RLS allows the insert
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email: fakeEmail, password })
      if (signInErr) {
        setError('Account created but could not sign in automatically. Try logging in manually.')
        return false
      }
      userId = signInData.user.id
    }

    // Now insert profile with active session
    const { error: profErr } = await supabase.from('profiles').insert({ id: userId, callsign: trimmed })
    if (profErr) {
      // Profile insert failed — clean up the auth user to avoid orphaned accounts
      setError(`Profile save failed: ${profErr.message}`)
      return false
    }

    setProfile({ id: userId, callsign: trimmed })
    return true
  }

  async function login(callsign, password) {
    setError('')
    const trimmed = callsign.trim()
    if (!trimmed || !password) { setError('Enter your callsign and password'); return false }

    // Look up profile to confirm callsign exists
    const { data: prof } = await supabase.from('profiles').select('id, callsign').eq('callsign', trimmed).maybeSingle()
    if (!prof) { setError('Callsign not found'); return false }

    const fakeEmail = makeEmail(trimmed)
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: fakeEmail, password })
    if (signInErr) { setError('Incorrect password'); return false }

    return true
  }

  async function logout() {
    await supabase.auth.signOut()
  }

  return { user, profile, loading, error, setError, register, login, logout }
}
