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
      <div style={{ width: '100%', maxWidth: 400 }}>

        <div style={{ marginBottom: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 42, fontFamily: 'IM Fell English, serif', color: '#fff', letterSpacing: '-.01em', marginBottom: 4 }}>
            Squad<span style={{ color: '#e8b84b' }}>.</span>gg
          </div>
          <div className="mono" style={{ fontSize: 10, color: '#333', letterSpacing: '.14em' }}>
            ESCAPE FROM TARKOV // RAID COORDINATOR
          </div>
        </div>

        {mode === 'home' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} className="fade-in">
            <button className="btn-gold" style={{ padding: '13px 24px', fontSize: 13 }} onClick={() => setMode('create')}>
              CREATE PARTY
            </button>
            <button className="btn-ghost" style={{ padding: '13px 24px', fontSize: 13 }} onClick={() => setMode('join')}>
              JOIN PARTY
            </button>
          </div>
        )}

        {(mode === 'create' || mode === 'join') && (
          <div className="card fade-in" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="serif" style={{ fontSize: 22, color: '#fff' }}>
              {mode === 'create' ? 'Create party' : 'Join party'}
            </div>

            <div>
              <div className="lbl">Your callsign</div>
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
                <div className="lbl">Party code</div>
                <input
                  placeholder="6-letter code"
                  value={code}
                  onChange={e => { setCode(e.target.value.toUpperCase()); setLocal('') }}
                  style={{ letterSpacing: '.22em', fontSize: 18 }}
                  maxLength={6}
                  onKeyDown={e => e.key === 'Enter' && join()}
                />
              </div>
            )}

            {err && <p className="mono" style={{ color: 'var(--red)', fontSize: 11 }}>/ {err}</p>}
            {loading && <p className="mono" style={{ color: 'var(--txm)', fontSize: 11 }}>connecting...</p>}

            <div style={{ display: 'flex', gap: 7, marginTop: 4 }}>
              <button className="btn-ghost" onClick={() => { setMode('home'); setLocal('') }}>BACK</button>
              <button className="btn-gold" style={{ flex: 1 }} onClick={mode === 'create' ? create : join} disabled={loading}>
                {mode === 'create' ? 'CREATE' : 'JOIN'}
              </button>
            </div>
          </div>
        )}

        <p className="mono" style={{ textAlign: 'center', marginTop: 24, fontSize: 9, color: '#222', letterSpacing: '.08em' }}>
          QUEST DATA VIA TARKOV.DEV
        </p>
      </div>
    </div>
  )
}
