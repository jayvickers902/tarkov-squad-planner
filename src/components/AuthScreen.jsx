import { useEffect, useState } from 'react'

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

export default function AuthScreen({ onGoogleLogin, onCreateProfile, needsCallsign, error, setError }) {
  const [mode, setMode]         = useState(needsCallsign ? 'callsign' : 'home')
  const [callsign, setCallsign] = useState('')
  const [busy, setBusy]         = useState(false)
  const [local, setLocal]       = useState('')

  useEffect(() => {
    if (needsCallsign) setMode('callsign')
  }, [needsCallsign])

  const err = local || error

  async function handleGoogle() {
    setBusy(true)
    const ok = await onGoogleLogin()
    if (ok === false) setBusy(false)
  }

  async function handleCallsign() {
    setBusy(true); setLocal('')
    const ok = await onCreateProfile(callsign)
    if (!ok) setBusy(false)
  }

  function reset() {
    setCallsign('')
    setLocal('')
    setError('')
    setMode('home')
  }

  return (
    <div className="auth-screen">
      <div className="auth-shell">
        <div className="auth-brand">
          <div className="auth-splash">
            <img src="/splash.jpg" alt="" />
            <div className="auth-splash-fade" />
          </div>
          <div className="auth-title"><div className="auth-title-bar" /><h1>SQUAD PLANNER</h1></div>
          <p className="mono auth-subtitle">ESCAPE FROM TARKOV // RAID COORDINATOR</p>
        </div>

        {mode === 'home' && (
          <div className="auth-actions fade-in">
            <button className="btn-gold auth-google-primary" onClick={handleGoogle} disabled={busy}>
              <GoogleIcon />
              CONTINUE WITH GOOGLE
            </button>
          </div>
        )}

        {mode === 'callsign' && (
          <div className="card auth-card fade-in">
            <h2>CHOOSE YOUR CALLSIGN</h2>
            <p className="mono auth-note">THIS IS YOUR IN-GAME NAME - CHOOSE WISELY</p>
            <div><div className="lbl">CALLSIGN</div><input placeholder="Your in-game name" value={callsign} onChange={event => { setCallsign(event.target.value); setLocal(''); setError('') }} autoFocus onKeyDown={event => event.key === 'Enter' && handleCallsign()} /></div>
            {err && <p className="mono auth-error">! {err}</p>}
            {busy && <p className="mono auth-busy">SAVING...</p>}
            <div className="auth-form-actions">
              {!needsCallsign && <button className="btn-ghost" onClick={reset} disabled={busy}>BACK</button>}
              <button className="btn-gold" onClick={handleCallsign} disabled={busy}>CONFIRM CALLSIGN</button>
            </div>
          </div>
        )}

        {err && mode === 'home' && <p className="mono auth-error auth-home-error">! {err}</p>}
        <p className="mono auth-footer">QUEST DATA VIA TARKOV.DEV - COMMUNITY MAINTAINED</p>
      </div>
    </div>
  )
}
