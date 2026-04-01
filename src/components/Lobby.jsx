import { useState } from 'react'

export default function Lobby({ callsign, onEnter, onManageQuests, onLogout, error, loading }) {
  const [mode, setMode]   = useState('home')
  const [code, setCode]   = useState('')
  const [local, setLocal] = useState('')

  function create() {
    setLocal(''); onEnter('create', '')
  }
  function join() {
    const c = code.trim().toUpperCase()
    if (!c) { setLocal('Enter a party code'); return }
    setLocal(''); onEnter('join', c)
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
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--goldtx)' }}>
              ◆ {callsign.toUpperCase()}
            </span>
            <button className="btn-ghost btn-sm" onClick={onLogout} style={{ fontSize: 11 }}>LOGOUT</button>
          </div>
        </div>

        {mode === 'home' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} className="fade-in">
            <button className="btn-gold" style={{ padding: '14px 24px', fontSize: 16 }} onClick={create}>
              CREATE PARTY
            </button>
            <button className="btn-ghost" style={{ padding: '14px 24px', fontSize: 16 }} onClick={() => setMode('join')}>
              JOIN PARTY
            </button>
            <button className="btn-ghost" style={{ padding: '14px 24px', fontSize: 16, color: 'var(--gold)', borderColor: 'var(--golddim)' }} onClick={onManageQuests}>
              ★ MY SAVED QUESTS
            </button>
          </div>
        )}

        {mode === 'join' && (
          <div className="card fade-in" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ fontSize: 22, color: 'var(--goldtx)' }}>JOIN PARTY</h2>
            <div>
              <div className="lbl">PARTY CODE</div>
              <input placeholder="6-letter code" value={code}
                onChange={e => { setCode(e.target.value.toUpperCase()); setLocal('') }}
                style={{ fontFamily: 'Share Tech Mono', letterSpacing: '0.2em', fontSize: 20 }}
                maxLength={6} autoFocus onKeyDown={e => e.key === 'Enter' && join()} />
            </div>
            {err && <p className="mono" style={{ color: 'var(--red)', fontSize: 12 }}>⚠ {err}</p>}
            {loading && <p className="mono" style={{ color: 'var(--txm)', fontSize: 12 }}>JOINING...</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" onClick={() => { setMode('home'); setLocal('') }}>BACK</button>
              <button className="btn-gold" style={{ flex: 1 }} onClick={join} disabled={loading}>JOIN</button>
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
