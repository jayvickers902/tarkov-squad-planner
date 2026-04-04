import { useState } from 'react'

export default function Lobby({ callsign, onEnter, onForceJoin, onManageQuests, onLogout, onAdmin, isAdmin, error, loading, autoJoinCode, friends = [], pendingIn = [], pendingOut = [], onSendRequest, onAcceptRequest, onRemoveRequest, onRemoveFriend, onRefreshFriends }) {
  const [mode, setMode]         = useState('home')
  const [code, setCode]         = useState('')
  const [local, setLocal]       = useState('')
  const [lastCode, setLastCode] = useState(() => localStorage.getItem('lastPartyCode'))
  const [forceCode, setForceCode] = useState(null)  // code to offer force-join on "already in party" error
  const [showFriends, setShowFriends] = useState(false)
  const [addInput, setAddInput] = useState('')
  const [addError, setAddError] = useState('')
  const [addBusy, setAddBusy]   = useState(false)

  async function handleSendRequest() {
    if (!addInput.trim()) return
    setAddBusy(true); setAddError('')
    const err = await onSendRequest(addInput)
    if (err) setAddError(err)
    else setAddInput('')
    setAddBusy(false)
  }

  function create() {
    setLocal(''); onEnter('create', '')
  }
  function join() {
    const c = code.trim().toUpperCase()
    if (!c) { setLocal('Enter a party code'); return }
    setLocal(''); setForceCode(null); onEnter('join', c)
  }

  const err = local || error
  const totalFriends = friends.length
  const hasPending = pendingIn.length > 0

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

        {autoJoinCode && (
          <div className="card fade-in" style={{ padding: 20, textAlign: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <div style={{ width: 16, height: 16, border: '2px solid var(--brd2)', borderTop: '2px solid var(--gold)', borderRadius: '50%', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
              <div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--txm)' }}>JOINING PARTY</div>
                <div className="mono" style={{ fontSize: 20, color: 'var(--gold)', letterSpacing: '0.2em', marginTop: 2 }}>{autoJoinCode}</div>
              </div>
            </div>
            {error && !error.includes('already in another party') && (
              <p className="mono" style={{ color: 'var(--red)', fontSize: 12, marginTop: 10 }}>⚠ {error}</p>
            )}
            {error && error.includes('already in another party') && (
              <div style={{ marginTop: 10 }}>
                <p className="mono" style={{ color: 'var(--red)', fontSize: 12, marginBottom: 8 }}>⚠ You are already in another party.</p>
                <button className="btn-danger" style={{ width: '100%' }} disabled={loading}
                  onClick={() => onForceJoin(autoJoinCode)}>
                  LEAVE CURRENT PARTY &amp; JOIN
                </button>
              </div>
            )}
          </div>
        )}

        {lastCode && !autoJoinCode && (
          <div className="card fade-in" style={{ padding: '14px 16px', marginBottom: 12, borderColor: 'var(--golddim)' }}>
            <div className="mono" style={{ fontSize: 10, color: 'var(--txm)', marginBottom: 6 }}>LAST PARTY</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mono" style={{ fontSize: 20, color: 'var(--gold)', letterSpacing: '0.2em', flex: 1 }}>{lastCode}</span>
              <button className="btn-gold btn-sm" disabled={loading}
                onClick={() => onEnter('join', lastCode)}>
                REJOIN
              </button>
              <button className="btn-danger btn-sm"
                onClick={() => { localStorage.removeItem('lastPartyCode'); setLastCode(null) }}>
                LEAVE
              </button>
            </div>
            {error && <p className="mono" style={{ color: 'var(--red)', fontSize: 11, marginTop: 6 }}>⚠ {error}</p>}
          </div>
        )}

        {mode === 'home' && !autoJoinCode && (
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
            {isAdmin && (
              <button className="btn-ghost" style={{ padding: '14px 24px', fontSize: 16, color: 'var(--txm)' }} onClick={onAdmin}>
                ⚙ KEY ADMIN
              </button>
            )}

            {/* Friends panel */}
            <div style={{ marginTop: 6 }}>
              <button
                className="btn-ghost"
                style={{ width: '100%', padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onClick={() => { setShowFriends(v => !v); if (!showFriends) onRefreshFriends() }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  FRIENDS
                  {totalFriends > 0 && <span style={{ color: 'var(--txm)' }}>({totalFriends})</span>}
                  {hasPending && (
                    <span className="mono" style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 3,
                      background: 'rgba(201,168,76,0.15)', border: '1px solid var(--golddim)',
                      color: 'var(--gold)',
                    }}>{pendingIn.length} REQ</span>
                  )}
                </span>
                <span style={{ color: 'var(--txd)', fontSize: 10 }}>{showFriends ? '▲' : '▼'}</span>
              </button>

              {showFriends && (
                <div className="card fade-in" style={{ marginTop: 6, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 0 }}>

                  {/* Incoming requests */}
                  {pendingIn.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div className="lbl" style={{ color: 'var(--gold)', marginBottom: 6 }}>
                        FRIEND REQUESTS ({pendingIn.length})
                      </div>
                      {pendingIn.map(r => (
                        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                          <span className="mono" style={{ flex: 1, fontSize: 13, color: 'var(--tx)' }}>{r.callsign}</span>
                          <button className="btn-gold btn-sm" onClick={() => onAcceptRequest(r.id)} style={{ fontSize: 11 }}>ACCEPT</button>
                          <button
                            className="btn-ghost btn-sm"
                            style={{ color: 'var(--txd)', borderColor: 'transparent', padding: '4px 7px' }}
                            onClick={() => onRemoveRequest(r.id)}
                            title="Decline"
                          >×</button>
                        </div>
                      ))}
                      <div style={{ borderBottom: '1px solid var(--brd)', marginBottom: 10, marginTop: 4 }} />
                    </div>
                  )}

                  {/* Accepted friends */}
                  {friends.length === 0 && pendingIn.length === 0 && pendingOut.length === 0 && (
                    <div className="mono" style={{ fontSize: 11, color: 'var(--txd)', textAlign: 'center', padding: '6px 0' }}>
                      NO FRIENDS ADDED YET
                    </div>
                  )}

                  {friends.map(f => (
                    <div key={f.callsign} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: f.partyCode ? 'var(--gold)' : 'var(--txd)', flexShrink: 0 }} />
                      <span className="mono" style={{ flex: 1, fontSize: 13, color: f.partyCode ? 'var(--tx)' : 'var(--txm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.callsign}
                      </span>
                      {f.partyCode && (
                        <button className="btn-gold btn-sm" onClick={() => onEnter('join', f.partyCode)} disabled={loading}>
                          JOIN
                        </button>
                      )}
                      <button
                        className="btn-ghost btn-sm"
                        style={{ color: 'var(--txd)', borderColor: 'transparent', padding: '4px 7px' }}
                        onClick={() => onRemoveFriend(f.callsign)}
                        title="Unfriend"
                      >×</button>
                    </div>
                  ))}

                  {/* Pending outgoing */}
                  {pendingOut.map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--txd)', flexShrink: 0 }} />
                      <span className="mono" style={{ flex: 1, fontSize: 13, color: 'var(--txd)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.callsign}
                      </span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>PENDING</span>
                      <button
                        className="btn-ghost btn-sm"
                        style={{ color: 'var(--txd)', borderColor: 'transparent', padding: '4px 7px' }}
                        onClick={() => onRemoveRequest(r.id)}
                        title="Withdraw request"
                      >×</button>
                    </div>
                  ))}

                  {/* Add friend input */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, borderTop: '1px solid var(--brd)', paddingTop: 10 }}>
                    <input
                      placeholder="Add by callsign"
                      value={addInput}
                      onChange={e => { setAddInput(e.target.value); setAddError('') }}
                      onKeyDown={e => e.key === 'Enter' && handleSendRequest()}
                      style={{ fontSize: 13 }}
                      disabled={addBusy}
                    />
                    <button className="btn-ghost btn-sm" onClick={handleSendRequest} disabled={addBusy} style={{ whiteSpace: 'nowrap' }}>
                      + ADD
                    </button>
                  </div>
                  {addError && <p className="mono" style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>⚠ {addError}</p>}
                </div>
              )}
            </div>
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
            {err && !err.includes('already in another party') && (
              <p className="mono" style={{ color: 'var(--red)', fontSize: 12 }}>⚠ {err}</p>
            )}
            {err && err.includes('already in another party') && (
              <div style={{ background: 'rgba(232,93,93,0.08)', border: '1px solid rgba(232,93,93,0.3)', borderRadius: 4, padding: '10px 12px' }}>
                <p className="mono" style={{ color: 'var(--red)', fontSize: 12, marginBottom: 8 }}>
                  ⚠ You are already in another party.
                </p>
                <p className="mono" style={{ color: 'var(--txm)', fontSize: 11, marginBottom: 10 }}>
                  Leave your current party and join this one?
                </p>
                <button className="btn-danger" style={{ width: '100%' }} disabled={loading}
                  onClick={async () => { await onForceJoin(code.trim().toUpperCase()); setLastCode(code.trim().toUpperCase()) }}>
                  LEAVE CURRENT PARTY &amp; JOIN
                </button>
              </div>
            )}
            {loading && <p className="mono" style={{ color: 'var(--txm)', fontSize: 12 }}>JOINING...</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" onClick={() => { setMode('home'); setLocal(''); setForceCode(null) }}>BACK</button>
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
