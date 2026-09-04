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

function DiscordIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }} aria-hidden="true">
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.011c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.128 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029zM8.02 15.331c-1.182 0-2.157-1.086-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.211 0 2.176 1.095 2.157 2.42 0 1.332-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.332-.946 2.418-2.157 2.418z"/>
    </svg>
  )
}

// The sign-in options, in the order the panel offers them. Google keeps the
// primary treatment because every account that exists today arrived through it.
const PROVIDERS = [
  { id: 'google',  label: 'CONTINUE WITH GOOGLE',  Icon: GoogleIcon },
  { id: 'discord', label: 'CONTINUE WITH DISCORD', Icon: DiscordIcon },
]

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

export default function AuthScreen({ onOAuthLogin, onCreateProfile, needsCallsign, error, profileError, setError, onOpenChangelog }) {
  const [mode, setMode]         = useState(needsCallsign ? 'callsign' : 'home')
  const [callsign, setCallsign] = useState('')
  const [busy, setBusy]         = useState(false)
  const [pending, setPending]   = useState('')
  const [local, setLocal]       = useState('')
  const submitInFlight = useRef(false)

  useEffect(() => {
    if (needsCallsign) setMode('callsign')
  }, [needsCallsign])

  const err = local || error || profileError
  const profileBlocked = Boolean(profileError)

  // Every provider button locks while a redirect is in flight, but only the one
  // that was pressed claims the busy state.
  async function handleOAuth(provider) {
    setBusy(true)
    setPending(provider)
    const ok = await onOAuthLogin(provider)
    if (ok === false) { setBusy(false); setPending('') }
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
            <div className="auth-providers">
              {PROVIDERS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  className={`auth-provider auth-provider-${id}`}
                  type="button"
                  onClick={() => handleOAuth(id)}
                  disabled={busy}
                  aria-busy={pending === id}
                >
                  <Icon />
                  {label}
                </button>
              ))}
            </div>
            <p className="mono auth-step"><span className="auth-step-dot" />NEXT STEP · CHOOSE YOUR CALLSIGN</p>
            <p className="auth-note">Use the same one every time. Signing in with a different provider can land you on a separate account, with its own callsign and quest list.</p>
            {err && <p className="mono auth-error" role="alert">! {err}</p>}
          </div>
        )}

        {mode === 'callsign' && (
          <div className="card auth-card fade-in">
            <div><label className="lbl" htmlFor="callsign">CALLSIGN</label><input id="callsign" name="callsign" autoComplete="nickname" placeholder="Your in-game name" value={callsign} onChange={event => { setCallsign(event.target.value); setLocal(''); setError('') }} disabled={busy || profileBlocked} autoFocus onKeyDown={event => event.key === 'Enter' && handleCallsign()} /></div>
            {err && <p className="mono auth-error" role="alert">! {err}</p>}
            {busy && <p className="mono auth-busy">SAVING...</p>}
            <div className="auth-form-actions">
              {!needsCallsign && <button className="btn-ghost" type="button" onClick={reset} disabled={busy}>BACK</button>}
              <button className="btn-gold" type="button" onClick={handleCallsign} disabled={busy || profileBlocked} aria-busy={busy}>CONFIRM CALLSIGN</button>
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
