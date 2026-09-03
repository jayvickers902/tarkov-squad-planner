import { useEffect, useRef, useState } from 'react'
import { FEATURED } from '../constants'
import AppFooter from './AppFooter'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }} aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>
    </svg>
  )
}

// The map count is the allowlist's length, not a hardcoded number, so it can
// never drift from what the picker actually offers. Build-time import - this
// screen must not depend on network state.
const MAP_COUNT = FEATURED.length

const CHIPS = [
  ['01', 'READ-ONLY LOG SYNC - NEVER TOUCHES THE GAME'],
  ['02', 'QUESTS ADD + CLEAR THEMSELVES'],
  ['03', 'BEST MAP FROM QUEST OVERLAP'],
  ['04', 'LIVE MAP FOLLOWS YOU IN RAID'],
]

export default function AuthScreen({ onGoogleLogin, onCreateProfile, needsCallsign, error, profileError, setError, onOpenChangelog }) {
  const [mode, setMode]         = useState(needsCallsign ? 'callsign' : 'home')
  const [callsign, setCallsign] = useState('')
  const [busy, setBusy]         = useState(false)
  const [local, setLocal]       = useState('')
  const submitInFlight = useRef(false)

  useEffect(() => {
    if (needsCallsign) setMode('callsign')
  }, [needsCallsign])

  const err = local || error || profileError
  const profileBlocked = Boolean(profileError)

  async function handleGoogle() {
    setBusy(true)
    const ok = await onGoogleLogin()
    if (ok === false) setBusy(false)
  }

  async function handleCallsign() {
    if (submitInFlight.current) return
    submitInFlight.current = true
    setBusy(true); setLocal('')
    try {
      const ok = await onCreateProfile(callsign)
      if (!ok) setBusy(false)
    } finally {
      submitInFlight.current = false
    }
  }

  function reset() {
    setCallsign('')
    setLocal('')
    setError('')
    setMode('home')
  }

  return (
    <div className="auth-screen">
      <div className="auth-art">
        <div className="auth-art-layer" />
        <div className="auth-art-scrim" />
        <div className="auth-art-vignette" />
        <div className="auth-art-inner">
          <div className="auth-mark">
            <div className="auth-mark-rail" />
            <div className="auth-mark-copy">
              <h1>SQUAD PLANNER</h1>
              <p className="mono auth-mark-sub">ESCAPE FROM TARKOV // RAID COORDINATOR</p>
            </div>
          </div>

          <div className="auth-pitch">
            <h2>ONE CODE.<br />ONE MAP.<br />WHOLE SQUAD.</h2>
            <div className="auth-chips">
              {CHIPS.map(([num, copy]) => (
                <div className="mono auth-chip" key={num}>
                  <span className="auth-chip-num">{num}</span>
                  <span>{copy}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="auth-panel">
        <div className="auth-head">
          <p className="mono auth-eyebrow">{mode === 'callsign' ? 'ONE MORE STEP' : 'SIGN IN'}</p>
          <h2>{mode === 'callsign' ? 'CHOOSE YOUR CALLSIGN' : 'JOIN YOUR SQUAD'}</h2>
          <p>
            {mode === 'callsign'
              ? 'This is the name your squad sees on the map, on every ping and beside every objective. Use your in-game name.'
              : "Sign in once, then drop into a raid with a live map that follows you, your team's positions and only the objectives that matter."}
          </p>
        </div>

        {mode === 'home' && (
          <div className="card auth-card fade-in">
            <button className="auth-google-primary" onClick={handleGoogle} disabled={busy}>
              <GoogleIcon />
              CONTINUE WITH GOOGLE
            </button>
            <p className="mono auth-step"><span className="auth-step-dot" />NEXT STEP · CHOOSE YOUR CALLSIGN</p>
            {err && <p className="mono auth-error" role="alert">! {err}</p>}
          </div>
        )}

        {mode === 'callsign' && (
          <div className="card auth-card fade-in">
            <div><label className="lbl" htmlFor="callsign">CALLSIGN</label><input id="callsign" name="callsign" autoComplete="nickname" placeholder="Your in-game name" value={callsign} onChange={event => { setCallsign(event.target.value); setLocal(''); setError('') }} disabled={busy || profileBlocked} autoFocus onKeyDown={event => event.key === 'Enter' && handleCallsign()} /></div>
            {err && <p className="mono auth-error" role="alert">! {err}</p>}
            {busy && <p className="mono auth-busy">SAVING...</p>}
            <div className="auth-form-actions">
              {!needsCallsign && <button className="btn-ghost" onClick={reset} disabled={busy}>BACK</button>}
              <button className="btn-gold" onClick={handleCallsign} disabled={busy || profileBlocked}>CONFIRM CALLSIGN</button>
            </div>
          </div>
        )}

        <div className="auth-facts">
          <div className="mono auth-fact"><span className="auth-fact-label">QUEST DATA</span><span className="auth-fact-value">TARKOV.DEV</span></div>
          <div className="mono auth-fact"><span className="auth-fact-label">MAPS</span><span className="auth-fact-value">{MAP_COUNT} · PVP / PVE / SEASON</span></div>
          <div className="mono auth-fact"><span className="auth-fact-label">PARTY SYNC</span><span className="auth-fact-live"><span className="auth-fact-dot" />REAL-TIME</span></div>
        </div>

        <AppFooter compact onOpenChangelog={onOpenChangelog} />
      </div>
    </div>
  )
}
