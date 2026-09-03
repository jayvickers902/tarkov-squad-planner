import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { GAME_MODES, gameModeLabel, normalizeGameMode } from '../gameMode'
import Icon from './Icon'
import AppFooter from './AppFooter'

const EMPTY_LIST = []

export default function Lobby({ userId, callsign, userGameMode = 'regular', onEnter, onForceJoin, onManageQuests, onAdmin, isAdmin, error, friendsError = '', loading, autoJoinCode, friends = EMPTY_LIST, pendingIn = EMPTY_LIST, pendingOut = EMPTY_LIST, onSendRequest, onAcceptRequest, onRemoveRequest, onRemoveFriend, onRefreshFriends, onOpenChangelog }) {
  const [createGameMode, setCreateGameMode] = useState(() => normalizeGameMode(userGameMode))
  const [code, setCode] = useState('')
  const [local, setLocal] = useState('')
  const [lastCode, setLastCode] = useState(() => {
    try { return localStorage.getItem('lastPartyCode') } catch { return null }
  })
  const [rejoinLookup, setRejoinLookup] = useState('loading')
  const [friendJoinCode, setFriendJoinCode] = useState(null)
  const [confirmUnfriend, setConfirmUnfriend] = useState(null)
  const [addInput, setAddInput] = useState('')
  const [addError, setAddError] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addSuccess, setAddSuccess] = useState(false)
  const [rejoinGameMode, setRejoinGameMode] = useState(null)
  const [friendPartyModes, setFriendPartyModes] = useState({})

  useEffect(() => {
    setCreateGameMode(normalizeGameMode(userGameMode))
  }, [userGameMode])

  useEffect(() => {
    onRefreshFriends?.()
  }, [onRefreshFriends])

  useEffect(() => {
    let cancelled = false
    let hint = null
    try { hint = localStorage.getItem('lastPartyCode') } catch { /* offline hint is optional */ }
    if (hint) setLastCode(hint)

    async function findCurrentParty() {
      if (!userId) return
      const { data: membership, error: membershipError } = await supabase
        .from('party_members')
        .select('party_id, joined_at')
        .eq('user_id', userId)
        .order('joined_at', { ascending: false })
        .limit(1)
      if (cancelled) return
      if (membershipError) {
        setRejoinLookup('offline')
        return
      }
      const partyId = membership?.[0]?.party_id
      const { data: partyRow, error: partyError } = partyId
        ? await supabase.from('parties').select('code, game_mode').eq('id', partyId).maybeSingle()
        : { data: null, error: null }
      if (cancelled) return
      if (partyError) {
        setRejoinLookup('offline')
        return
      }
      const currentCode = partyRow?.code || null
      setLastCode(currentCode)
      setRejoinGameMode(partyRow?.game_mode || null)
      setRejoinLookup('ready')
      try {
        if (currentCode) localStorage.setItem('lastPartyCode', currentCode)
        else localStorage.removeItem('lastPartyCode')
      } catch { /* offline hint is optional */ }
    }

    findCurrentParty()
    return () => { cancelled = true }
  }, [userId])

  useEffect(() => {
    let cancelled = false
    const friendIds = friends.filter(friend => friend.partyCode).map(friend => friend.user_id)
    if (!friendIds.length) {
      setFriendPartyModes({})
      return () => { cancelled = true }
    }
    supabase.rpc('get_friend_parties', { p_user_ids: friendIds }).then(({ data }) => {
      if (cancelled) return
      setFriendPartyModes(Object.fromEntries((data || []).map(row => [row.user_id, normalizeGameMode(row.game_mode)])))
    })
    return () => { cancelled = true }
  }, [friends])

  async function handleSendRequest() {
    if (!addInput.trim()) return
    setAddBusy(true)
    setAddError('')
    setAddSuccess(false)
    const requestError = await onSendRequest(addInput)
    if (requestError) {
      setAddError(requestError)
    } else {
      setAddInput('')
      setAddSuccess(true)
      setTimeout(() => setAddSuccess(false), 2500)
    }
    setAddBusy(false)
  }

  function create() {
    setLocal('')
    onEnter('create', '', createGameMode)
  }

  function join() {
    const normalizedCode = code.trim().toUpperCase()
    if (!normalizedCode) {
      setLocal('Enter a party code')
      return
    }
    setLocal('')
    setFriendJoinCode(null)
    onEnter('join', normalizedCode)
  }

  const err = local || error || friendsError
  const totalFriends = friends.length
  const hasPending = pendingIn.length > 0
  const displayCallsign = callsign?.toUpperCase() || 'OPERATOR'

  return (
    <>
    <main className="lobby-screen">
      <div className="lobby-art" aria-hidden="true" />
      <div className="lobby-scrim" aria-hidden="true" />
      <div className="lobby-vignette" aria-hidden="true" />

      <div className="lobby-board">
        <section className="lobby-left" aria-labelledby="lobby-title">
          <header className="lobby-identity fade-in">
            <div className="lobby-eyebrow mono">
              <span>ESCAPE FROM TARKOV</span>
              <span className="lobby-eyebrow-divider" aria-hidden="true" />
              <span className="room-banner-mode">RAID COORDINATOR</span>
            </div>
            <div className="lobby-headline">
              <span className="lobby-headline-rail" aria-hidden="true" />
              <h1 id="lobby-title">
                <span>READY UP,</span>
                <span className="lobby-callsign" title={displayCallsign}>{displayCallsign}</span>
              </h1>
            </div>
            <p className="lobby-intro">
              Start a party and share the code, or drop into one that's already running. Your quest list is synced and waiting.
            </p>
          </header>

          {autoJoinCode ? (
            <div className="lobby-auto-join lobby-glass-card fade-in" role="status">
              <span className="lobby-spinner" aria-hidden="true" />
              <span>
                <span className="lobby-auto-label mono">JOINING PARTY</span>
                <span className="lobby-auto-code mono">{autoJoinCode}</span>
              </span>
              {err ? <span className="lobby-error mono" role="alert">⚠ {err}</span> : null}
            </div>
          ) : (
            <div className="lobby-actions fade-in">
              <button type="button" className="room-start-raid lobby-create" onClick={create} disabled={loading}>
                <span className="room-start-raid-copy">
                  <span className="lobby-create-title">CREATE PARTY</span>
                  <span className="lobby-create-detail mono">GENERATES A 6-LETTER CODE</span>
                </span>
                <span className="lobby-create-arrow mono" aria-hidden="true">→</span>
              </button>

              <div className="lobby-mode-picker">
                <span className="lobby-mode-label mono">NEW PARTY MODE</span>
                <div className="lobby-mode-options" role="group" aria-label="New party game mode">
                  {GAME_MODES.map(value => (
                    <button
                      type="button"
                      key={value}
                      className={createGameMode === value ? 'is-selected' : ''}
                      onClick={() => setCreateGameMode(value)}
                      aria-pressed={createGameMode === value}
                    >
                      {gameModeLabel(value)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="lobby-join-wrap">
                <div className="lobby-join-row">
                  <label className="lobby-join-label mono" htmlFor="party-code">JOIN WITH CODE</label>
                  <input
                    id="party-code"
                    name="party-code"
                    autoComplete="off"
                    placeholder="ABCDEF"
                    value={code}
                    onChange={event => { setCode(event.target.value.toUpperCase()); setLocal('') }}
                    onKeyDown={event => event.key === 'Enter' && join()}
                    maxLength={6}
                    aria-describedby="lobby-join-status"
                  />
                  <button type="button" className="lobby-join-button" onClick={join} disabled={loading}>JOIN</button>
                </div>
                <div id="lobby-join-status" className="lobby-join-status mono" aria-live="polite">
                  {err ? <span className="lobby-error" role="alert">⚠ {err}</span> : loading ? <span>JOINING...</span> : null}
                </div>
              </div>

              <div className="lobby-secondary-actions">
                <button type="button" className="lobby-secondary lobby-secondary-gold" onClick={onManageQuests}>
                  <Icon name="star" size="md" /> QUEST MANAGER
                </button>
                {isAdmin ? (
                  <button type="button" className="lobby-secondary" onClick={onAdmin}>
                    <Icon name="settings" size="md" /> KEY ADMIN
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </section>

        <aside className="lobby-right" aria-label="Squad status">
          {lastCode ? (
            <section className="lobby-glass-card lobby-active-party fade-in" aria-labelledby="active-party-title">
              <div className="lobby-card-head lobby-active-head">
                <h2 id="active-party-title" className="mono">{rejoinLookup === 'offline' ? 'OFFLINE REJOIN HINT' : 'ACTIVE PARTY'}</h2>
                <span className="mono">MODE · {gameModeLabel(rejoinGameMode)}</span>
              </div>
              <div className="lobby-active-body">
                <div className={`lobby-active-code mono${rejoinLookup === 'loading' ? ' is-loading' : ''}`} aria-label={rejoinLookup === 'loading' ? 'Loading active party code' : `Party code ${lastCode}`}>
                  {rejoinLookup === 'loading' ? <span aria-hidden="true" /> : lastCode}
                </div>
                <div className="lobby-active-actions">
                  <button type="button" className="btn-gold" disabled={loading || rejoinLookup === 'loading'} onClick={() => onForceJoin(lastCode)}>REJOIN</button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => {
                      try { localStorage.removeItem('lastPartyCode') } catch { /* offline hint is optional */ }
                      setLastCode(null)
                    }}
                  >
                    LEAVE
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          <section className="lobby-glass-card lobby-friends fade-in" aria-labelledby="lobby-friends-title">
            <div className="lobby-card-head lobby-friends-head">
              <h2 id="lobby-friends-title" className="mono">FRIENDS <span>({totalFriends})</span></h2>
              {hasPending ? <span className="lobby-request-badge mono">{pendingIn.length} REQ</span> : null}
            </div>

            {pendingIn.length > 0 ? (
              <div className="lobby-request-list">
                <div className="lobby-request-title mono">FRIEND REQUESTS ({pendingIn.length})</div>
                {pendingIn.map(request => (
                  <div className="lobby-friend-row" key={request.id}>
                    <span className="lobby-friend-name mono">{request.callsign}</span>
                    <button type="button" className="lobby-row-gold" onClick={() => onAcceptRequest(request.id)}>ACCEPT</button>
                    <button type="button" className="lobby-row-icon" onClick={() => onRemoveRequest(request.id)} title="Decline" aria-label={`Decline ${request.callsign}'s friend request`}>×</button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="lobby-friend-list">
              {friends.length === 0 && pendingIn.length === 0 && pendingOut.length === 0 ? (
                <div className="lobby-friends-empty mono">NO FRIENDS ADDED YET</div>
              ) : null}

              {friends.map(friend => (
                <div key={friend.user_id}>
                  <div className="lobby-friend-row">
                    <span className={`lobby-presence${friend.partyCode ? ' is-online' : ''}`} aria-hidden="true" />
                    <span className={`lobby-friend-name mono${friend.partyCode ? ' is-online' : ''}`}>{friend.callsign}</span>
                    {friend.partyCode ? (
                      <>
                        <span className="lobby-friend-mode mono">{gameModeLabel(friendPartyModes[friend.user_id])}</span>
                        <button
                          type="button"
                          className="lobby-row-gold"
                          disabled={loading}
                          onClick={() => { setFriendJoinCode(friend.partyCode); onEnter('join', friend.partyCode) }}
                        >
                          JOIN
                        </button>
                      </>
                    ) : <span className="lobby-friend-offline mono">OFFLINE</span>}
                    {confirmUnfriend === friend.user_id ? (
                      <span className="lobby-unfriend-confirm" role="group" aria-label={`Remove ${friend.callsign} from friends`}>
                        <span className="mono">REMOVE?</span>
                        <button type="button" className="btn-danger" onClick={() => { onRemoveFriend(friend.user_id); setConfirmUnfriend(null) }}>YES, REMOVE {friend.callsign}</button>
                        <button type="button" className="btn-ghost" onClick={() => setConfirmUnfriend(null)}>NO, KEEP {friend.callsign}</button>
                      </span>
                    ) : (
                      <button type="button" className="lobby-row-icon" onClick={() => setConfirmUnfriend(friend.user_id)} title="Unfriend" aria-label={`Remove ${friend.callsign} from friends`}>×</button>
                    )}
                  </div>
                  {friendJoinCode === friend.partyCode && error ? <p className="lobby-friend-error mono" role="alert">⚠ {error}</p> : null}
                </div>
              ))}

              {pendingOut.map(request => (
                <div className="lobby-friend-row" key={request.id}>
                  <span className="lobby-presence" aria-hidden="true" />
                  <span className="lobby-friend-name mono">{request.callsign}</span>
                  <span className="lobby-friend-offline mono">PENDING</span>
                  <button type="button" className="lobby-row-icon" onClick={() => onRemoveRequest(request.id)} title="Withdraw request" aria-label={`Withdraw friend request to ${request.callsign}`}>×</button>
                </div>
              ))}
            </div>

            <div className="lobby-add-friend">
              <input
                aria-label="Friend callsign"
                placeholder="Add by callsign"
                value={addInput}
                onChange={event => { setAddInput(event.target.value); setAddError('') }}
                onKeyDown={event => event.key === 'Enter' && handleSendRequest()}
                disabled={addBusy}
              />
              <button type="button" className="btn-ghost" onClick={handleSendRequest} disabled={addBusy}>+ ADD</button>
            </div>
            <div className="lobby-add-status mono" aria-live="polite">
              {addError ? <span className="lobby-error" role="alert">⚠ {addError}</span> : addSuccess ? <span className="lobby-success">✓ REQUEST SENT</span> : null}
            </div>
          </section>

          <div className="lobby-glass-card lobby-sync mono">
            <span>QUEST SYNC</span>
            <span className="lobby-sync-state"><span aria-hidden="true" /> REAL-TIME</span>
          </div>
        </aside>
      </div>
    </main>
    <AppFooter onOpenChangelog={onOpenChangelog} />
    </>
  )
}
