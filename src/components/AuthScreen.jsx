import { useState } from 'react'

export default function AuthScreen({ onAuth, error, setError }) {
  const [mode, setMode]     = useState('home')
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
