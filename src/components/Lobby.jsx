import { useState } from 'react'

export default function Lobby({ onEnter, error, loading }) {
  const [mode, setMode]   = useState('home')
  const [sign, setSign]   = useState('')
  const [code, setCode]   = useState('')
  const [local, setLocal] = useState('')

  function create() {
    const n = sign.trim()
    if (!n) { setLocal('Enter a callsign'); return }
    setLocal('')
    onEnter('create', n, '')
  }

  function join() {
    const n = sign.trim(), c = code.trim().toUpperCase()
    if (!n) { setLocal('Enter a callsign'); return }
    if (!c) { setLocal('Enter a party code'); return }
    setLocal('')
    onEnter('join', n, c)
  }

  const err = local || error

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
            <button className="btn-gold" style={{ padding: '14px 24px', fontSize: 16 }} onClick={() => setMode('create')}>
              CREATE PARTY
            </button>
            <button className="btn-ghost" style={{ padding: '14px 24px', fontSize: 16 }} onClick={() => setMode('join')}>
              JOIN PARTY
            </button>
          </div>
        )}

        {(mode === 'create' || mode === 'join') && (
          <div className="card fade-in" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ fontSize: 22, color: 'var(--goldtx)' }}>
              {mode === 'create' ? 'CREATE PARTY' : 'JOIN PARTY'}
            </h2>

            <div>
              <div className="lbl">YOUR CALLSIGN</div>
              <input
                placeholder="e.g. DeadEye47"
                value={sign}
                onChange={e => { setSign(e.target.value); setLocal('') }}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && (mode === 'create' ? create() : join())}
              />
            </div>

            {mode === 'join' && (
              <div>
                <div className="lbl">PARTY CODE</div>
                <input
                  placeholder="6-letter code"
                  value={code}
                  onChange={e => { setCode(e.target.value.toUpperCase()); setLocal('') }}
                  style={{ fontFamily: 'Share Tech Mono', letterSpacing: '0.2em', fontSize: 20 }}
                  maxLength={6}
                  onKeyDown={e => e.key === 'Enter' && join()}
                />
              </div>
            )}

            {err && (
              <p className="mono" style={{ color: 'var(--red)', fontSize: 12 }}>⚠ {err}</p>
            )}

            {loading && (
              <p className="mono" style={{ color: 'var(--txm)', fontSize: 12 }}>CONNECTING...</p>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="btn-ghost" onClick={() => { setMode('home'); setLocal('') }}>BACK</button>
              <button className="btn-gold" style={{ flex: 1 }} onClick={mode === 'create' ? create : join} disabled={loading}>
                {mode === 'create' ? 'CREATE' : 'JOIN'}
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
