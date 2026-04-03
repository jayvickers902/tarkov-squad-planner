import { useState } from 'react'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>
    </svg>
  )
}

export default function AuthScreen({ onAuth, onGoogleLogin, onCreateProfile, needsCallsign, error, setError }) {
  const [mode, setMode]         = useState(needsCallsign ? 'callsign' : 'home')
  const [callsign, setCallsign] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [busy, setBusy]         = useState(false)
  const [local, setLocal]       = useState('')

  const err = local || error

  async function handleRegister() {
    if (password !== confirm) { setLocal('Passwords do not match'); return }
    setBusy(true); setLocal('')
    const ok = await onAuth('register', callsign, password)
    if (!ok) setBusy(false)
  }

  async function handleLogin() {
    setBusy(true); setLocal('')
    const ok = await onAuth('login', callsign, password)
    if (!ok) setBusy(false)
  }

  async function handleCallsign() {
    setBusy(true); setLocal('')
    const ok = await onCreateProfile(callsign)
    if (!ok) setBusy(false)
  }

  async function handleGoogle() {
    setBusy(true)
    await onGoogleLogin()
    // page will redirect — no need to reset busy
  }

  function reset() { setCallsign(''); setPassword(''); setConfirm(''); setLocal(''); setError(''); setMode('home') }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 430 }}>

        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 5, height: 34, background: 'var(--gold)', borderRadius: 2 }} />
            <h1 style={{ fontSize: 36, fontWeight: 700 }}>SQUAD PLANNER</h1>
          </div>
          <p className="mono" style={{ fontSize: 11, color: 'var(--txm)', letterSpacing: '0.1em' }}>
            ESCAPE FROM TARKOV // RAID COORDINATOR
          </p>
        </div>

        {mode === 'home' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} className="fade-in">
            <button className="btn-gold" style={{ padding: '14px 24px', fontSize: 16 }} onClick={() => setMode('register')}>
              CREATE ACCOUNT
            </button>
            <button className="btn-ghost" style={{ padding: '14px 24px', fontSize: 16 }} onClick={() => setMode('login')}>
              LOGIN
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--brd2)' }} />
              <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>OR</span>
              <div style={{ flex: 1, height: 1, background: 'var(--brd2)' }} />
            </div>
            <button
              className="btn-ghost"
              style={{ padding: '14px 24px', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
              onClick={handleGoogle}
              disabled={busy}
            >
              <GoogleIcon />
              CONTINUE WITH GOOGLE
            </button>
          </div>
        )}

        {/* Callsign picker — shown after Google sign-in for new users */}
        {mode === 'callsign' && (
          <div className="card fade-in" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ fontSize: 22, color: 'var(--goldtx)' }}>CHOOSE YOUR CALLSIGN</h2>
            <p className="mono" style={{ fontSize: 11, color: 'var(--txm)' }}>
              THIS IS YOUR IN-GAME NAME — CHOOSE WISELY
            </p>
            <div>
              <div className="lbl">CALLSIGN</div>
              <input
                placeholder="Your in-game name"
                value={callsign}
                onChange={e => { setCallsign(e.target.value); setLocal(''); setError('') }}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleCallsign()}
              />
            </div>
            {err && <p className="mono" style={{ color: 'var(--red)', fontSize: 12 }}>⚠ {err}</p>}
            {busy && <p className="mono" style={{ color: 'var(--txm)', fontSize: 12 }}>SAVING...</p>}
            <button className="btn-gold" onClick={handleCallsign} disabled={busy}>
              CONFIRM CALLSIGN
            </button>
          </div>
        )}

        {(mode === 'register' || mode === 'login') && (
          <div className="card fade-in" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ fontSize: 22, color: 'var(--goldtx)' }}>
              {mode === 'register' ? 'CREATE ACCOUNT' : 'LOGIN'}
            </h2>

            <div>
              <div className="lbl">CALLSIGN</div>
              <input
                placeholder="Your in-game name"
                value={callsign}
                onChange={e => { setCallsign(e.target.value); setLocal(''); setError('') }}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && (mode === 'register' ? handleRegister() : handleLogin())}
              />
              {mode === 'register' && (
                <div className="mono" style={{ fontSize: 10, color: 'var(--txd)', marginTop: 4 }}>
                  THIS IS YOUR USERNAME — CHOOSE WISELY
                </div>
              )}
            </div>

            <div>
              <div className="lbl">PASSWORD</div>
              <input
                type="password"
                placeholder={mode === 'register' ? 'Min. 6 characters' : 'Your password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setLocal('') }}
                onKeyDown={e => e.key === 'Enter' && (mode === 'register' ? handleRegister() : handleLogin())}
              />
            </div>

            {mode === 'register' && (
              <div>
                <div className="lbl">CONFIRM PASSWORD</div>
                <input
                  type="password"
                  placeholder="Same again"
                  value={confirm}
                  onChange={e => { setConfirm(e.target.value); setLocal('') }}
                  onKeyDown={e => e.key === 'Enter' && handleRegister()}
                />
              </div>
            )}

            {err && <p className="mono" style={{ color: 'var(--red)', fontSize: 12 }}>⚠ {err}</p>}
            {busy && <p className="mono" style={{ color: 'var(--txm)', fontSize: 12 }}>
              {mode === 'register' ? 'CREATING ACCOUNT...' : 'LOGGING IN...'}
            </p>}

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="btn-ghost" onClick={reset} disabled={busy}>BACK</button>
              <button className="btn-gold" style={{ flex: 1 }}
                onClick={mode === 'register' ? handleRegister : handleLogin}
                disabled={busy}>
                {mode === 'register' ? 'CREATE' : 'LOGIN'}
              </button>
            </div>
          </div>
        )}

        <p className="mono" style={{ textAlign: 'center', marginTop: 28, fontSize: 10, color: 'var(--txd)' }}>
          QUEST DATA VIA TARKOV.DEV — COMMUNITY MAINTAINED
        </p>
      </div>
    </div>
  )
}
