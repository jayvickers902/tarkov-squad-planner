import { useState, useRef, useMemo } from 'react'
import { useMaps, useTasks } from '../useTarkov'
import { RED_REBEL_MAPS } from '../constants'
import { useIsMobile } from '../useIsMobile'
import QuestSearch from './QuestSearch'
import TodoList from './TodoList'
import MyQuestPanel from './MyQuestPanel'
import MapCanvas from './MapCanvas'
import KeysList from './KeysList'
import RequiredItems from './RequiredItems'

function Spin({ s = 20 }) {
  return <div style={{ width: s, height: s, border: '2px solid var(--brd2)', borderTop: '2px solid var(--gold)', borderRadius: '50%', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
}

const MEMBER_COLORS = [
  { bg: '#1a2e3a', border: '#1e5a7a', text: '#5aace8' },
  { bg: '#2a1a2e', border: '#5a1e7a', text: '#b85ae8' },
  { bg: '#2e1a1a', border: '#7a1e1e', text: '#e85a5a' },
  { bg: '#1a2e1a', border: '#1e7a1e', text: '#5ae85a' },
  { bg: '#2e2a1a', border: '#7a6a1e', text: '#e8c85a' },
  { bg: '#1a2a2e', border: '#1e6a7a', text: '#5ad8e8' },
]
function memberColor(name, allMembers) {
  return MEMBER_COLORS[Math.max(0, allMembers.indexOf(name)) % MEMBER_COLORS.length]
}
function MemberPill({ name, allMembers }) {
  const c = memberColor(name, allMembers)
  return (
    <span className="mono" style={{
      fontSize: 10, padding: '1px 5px', borderRadius: 3,
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      flexShrink: 0, letterSpacing: '.04em',
    }}>{name.slice(0, 8).toUpperCase()}</span>
  )
}

export default function Room({ party, myName, isAdmin, onLeave, onSelectMap, onAddQuest, onRemoveQuest, onSetSpawn, onToggleStar, skippedQuestIds, onAddStroke, onClearMyStrokes, onAddMarker, onClearMyMarkers, onMyQuests, onAdmin, onSubmitProgress, friends = [], pendingIn = [], pendingOut = [], onSendRequest, onAcceptRequest, onRemoveRequest, onRemoveFriend, onRefreshFriends, onRefresh }) {
  const isMobile = useIsMobile()
  const [tab, setTab]           = useState('todo')
  const [copied, setCopied]     = useState(false)
  const [showFriends, setShowFriends] = useState(false)
  const [showMapRec, setShowMapRec] = useState(false)
  const [addInput, setAddInput] = useState('')
  const [addError, setAddError] = useState('')
  const [addBusy, setAddBusy]   = useState(false)
  const [confirmUnfriend, setConfirmUnfriend] = useState(null)
  const [chipTooltip, setChipTooltip] = useState(null)  // { task, anchor }

  async function handleSendRequest() {
    if (!addInput.trim()) return
    setAddBusy(true); setAddError('')
    const err = await onSendRequest(addInput)
    if (err) setAddError(err)
    else setAddInput('')
    setAddBusy(false)
  }

  const { maps, loading: loadingMaps } = useMaps()
  const { tasks, loading: loadingTasks } = useTasks(party.map_norm)
  const { tasks: allTasks } = useTasks(null)
  const isLeader = party.leader === myName
  const members  = Object.keys(party.members || {})
  const mine     = party.members?.[myName] || []

  // Track if we ever had quests — used to show "syncing" instead of "no quests" on brief dips
  const mineWasNonEmpty = useRef(mine.length > 0)
  if (mine.length > 0) mineWasNonEmpty.current = true

  // Completed quests — only my own entries (key format: __done__:questId::memberName)
  const completedQuests = Object.fromEntries(
    Object.entries(party.progress || {})
      .filter(([k, v]) => k.startsWith('__done__:') && k.endsWith(`::${myName}`) && v)
      .map(([k]) => [k.slice(9, k.lastIndexOf('::')), true])
  )

  // Map recommendation: uses member_quests_all (full quest list per member, not map-filtered)
  const mapStats = useMemo(() => {
    const mqAll = party.member_quests_all || {}
    const activeMembers = Object.keys(mqAll).filter(n => (mqAll[n] || []).length > 0)
    if (!allTasks.length || !maps.length || !activeMembers.length) return []
    return maps.map(m => {
      const perMember = {}
      const questIdSets = {}
      activeMembers.forEach(name => {
        const ids = (mqAll[name] || [])
          .filter(q => allTasks.find(t => t.id === q.id)?.map?.normalizedName === m.normalizedName)
          .map(q => q.id)
        perMember[name] = ids.length
        if (ids.length) questIdSets[name] = new Set(ids)
      })
      const allIds = new Set(Object.values(questIdSets).flatMap(s => [...s]))
      let crossover = 0
      allIds.forEach(id => {
        if (Object.values(questIdSets).filter(s => s.has(id)).length >= 2) crossover++
      })
      const total = Object.values(perMember).reduce((s, v) => s + v, 0)
      return { map: m, total, crossover, perMember }
    })
    .filter(s => s.total > 0)
    .sort((a, b) => b.total - a.total || b.crossover - a.crossover)
  }, [allTasks, maps, party.member_quests_all]) // eslint-disable-line


  function copy() {
    navigator.clipboard?.writeText(`https://dudgy.net/join/${party.code}`).catch(() => {})
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ minHeight: '100vh', padding: '14px 16px' }}>

      {/* Header */}
      <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid var(--brd)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{ width: 4, height: 26, background: 'var(--gold)', borderRadius: 2, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>SQUAD PLANNER</h1>
              <div className="mono" style={{ fontSize: 11, color: 'var(--txm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {party.map_name ? `// ${party.map_name.toUpperCase()}` : '// NO MAP SELECTED'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {!isMobile && (
              <>
                <button className="btn-ghost btn-sm" onClick={onMyQuests} style={{ color: 'var(--gold)', borderColor: 'var(--golddim)' }}>★ QUEST MANAGER</button>
                <button className={showFriends ? 'btn-ghost btn-sm btn-active' : 'btn-ghost btn-sm'} onClick={() => { setShowFriends(v => !v); if (!showFriends) onRefreshFriends() }} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  FRIENDS{friends.length > 0 ? ` (${friends.length})` : ''}
                  {pendingIn.length > 0 && <span className="mono" style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(201,168,76,0.15)', border: '1px solid var(--golddim)', color: 'var(--gold)' }}>{pendingIn.length}</span>}
                </button>
                {isAdmin && <button className="btn-ghost btn-sm" onClick={onAdmin} style={{ color: 'var(--txm)' }}>⚙</button>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 4, padding: '5px 10px' }}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--txm)' }}>PARTY</span>
                  <span className="mono" style={{ fontSize: 17, color: 'var(--gold)', letterSpacing: '0.2em' }}>{party.code}</span>
                  <button className="btn-ghost btn-sm" onClick={copy}>{copied ? '✓' : 'COPY'}</button>
                </div>
              </>
            )}
            <button className="btn-danger btn-sm" onClick={onLeave}>LEAVE</button>
          </div>
        </div>

        {/* Mobile second row */}
        {isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn-ghost btn-sm" onClick={onMyQuests} style={{ color: 'var(--gold)', borderColor: 'var(--golddim)' }}>★ QUEST MANAGER</button>
            <button className={showFriends ? 'btn-ghost btn-sm btn-active' : 'btn-ghost btn-sm'} onClick={() => { setShowFriends(v => !v); if (!showFriends) onRefreshFriends() }}>
              FRIENDS{friends.length > 0 ? ` (${friends.length})` : ''}
            </button>
            {isAdmin && <button className="btn-ghost btn-sm" onClick={onAdmin} style={{ color: 'var(--txm)' }}>⚙</button>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 4, padding: '4px 8px' }}>
              <span className="mono" style={{ fontSize: 15, color: 'var(--gold)', letterSpacing: '0.2em' }}>{party.code}</span>
              <button className="btn-ghost btn-sm" onClick={copy}>{copied ? '✓' : 'COPY'}</button>
            </div>
          </div>
        )}
      </div>

      {/* Friends panel */}
      {showFriends && (
        <div className="card fade-in" style={{ marginBottom: 14, padding: '12px 16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 24px', alignItems: 'flex-start' }}>

            {/* Friend list */}
            <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 5 }}>

              {/* Incoming requests */}
              {pendingIn.length > 0 && (
                <>
                  <div className="lbl" style={{ color: 'var(--gold)' }}>FRIEND REQUESTS ({pendingIn.length})</div>
                  {pendingIn.map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="mono" style={{ flex: 1, fontSize: 12, color: 'var(--tx)' }}>{r.callsign}</span>
                      <button className="btn-gold btn-sm" style={{ fontSize: 11 }} onClick={() => onAcceptRequest(r.id)}>ACCEPT</button>
                      <button className="btn-ghost btn-sm" style={{ color: 'var(--txd)', borderColor: 'transparent', padding: '3px 6px' }} onClick={() => onRemoveRequest(r.id)} title="Decline">×</button>
                    </div>
                  ))}
                  <div style={{ borderBottom: '1px solid var(--brd)', margin: '4px 0' }} />
                </>
              )}

              <div className="lbl">FRIENDS</div>
              {friends.length === 0 && pendingIn.length === 0 && pendingOut.length === 0 && (
                <div className="mono" style={{ fontSize: 11, color: 'var(--txd)' }}>NO FRIENDS ADDED YET</div>
              )}
              {friends.map(f => (
                <div key={f.callsign} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: f.partyCode ? 'var(--gold)' : 'var(--txd)', flexShrink: 0 }} />
                  <span className="mono" style={{ flex: 1, fontSize: 12, color: f.partyCode ? 'var(--tx)' : 'var(--txm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.callsign}
                  </span>
                  {confirmUnfriend === f.callsign ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--txm)' }}>REMOVE?</span>
                      <button className="btn-danger btn-sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => { onRemoveFriend(f.callsign); setConfirmUnfriend(null) }}>YES</button>
                      <button className="btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => setConfirmUnfriend(null)}>NO</button>
                    </div>
                  ) : (
                    <>
                      <span className="mono" style={{ fontSize: 10, color: f.partyCode ? 'var(--gold)' : 'var(--txd)' }}>
                        {f.partyCode ? 'IN PARTY' : 'OFFLINE'}
                      </span>
                      <button className="btn-ghost btn-sm" style={{ color: 'var(--txd)', borderColor: 'transparent', padding: '3px 6px' }} onClick={() => setConfirmUnfriend(f.callsign)} title="Unfriend">×</button>
                    </>
                  )}
                </div>
              ))}

              {/* Pending outgoing */}
              {pendingOut.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--txd)', flexShrink: 0 }} />
                  <span className="mono" style={{ flex: 1, fontSize: 12, color: 'var(--txd)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.callsign}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>PENDING</span>
                  <button className="btn-ghost btn-sm" style={{ color: 'var(--txd)', borderColor: 'transparent', padding: '3px 6px' }} onClick={() => onRemoveRequest(r.id)} title="Withdraw">×</button>
                </div>
              ))}
            </div>

            {/* Add friend */}
            <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="lbl">ADD FRIEND</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  placeholder="Callsign"
                  value={addInput}
                  onChange={e => { setAddInput(e.target.value); setAddError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleSendRequest()}
                  style={{ fontSize: 13 }}
                  disabled={addBusy}
                />
                <button className="btn-ghost btn-sm" onClick={handleSendRequest} disabled={addBusy} style={{ whiteSpace: 'nowrap' }}>+ ADD</button>
              </div>
              {addError && <p className="mono" style={{ color: 'var(--red)', fontSize: 11 }}>⚠ {addError}</p>}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '210px 1fr', gap: 14 }}>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Members */}
          <div className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div className="lbl" style={{ marginBottom: 0 }}>PARTY MEMBERS</div>
              <button className="btn-ghost btn-sm" onClick={onRefresh} title="Refresh members" style={{ fontSize: 14, padding: '2px 7px', color: 'var(--txd)' }}>↻</button>
            </div>
            {members.map(m => {
              const isSelf    = m === myName
              const isFriend  = friends.some(f => f.callsign === m)
              const isPending = [...(pendingIn || []), ...(pendingOut || [])].some(r => r.callsign === m)
              const mQuests   = party.members[m] || []
              const totalCount = mQuests.length
              const mapCount  = party.map_norm
                ? mQuests.filter(q => {
                    const task = tasks.find(t => t.id === q.id)
                    return task?.map?.normalizedName === party.map_norm
                  }).length
                : null
              return (
                <div key={m} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '7px 0', borderBottom: '1px solid var(--brd)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: isSelf ? 'var(--goldtx)' : 'var(--tx)' }}>
                      {m}{isSelf ? ' · you' : ''}
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--txm)' }}>
                      {totalCount} QUEST{totalCount !== 1 ? 'S' : ''}
                      {mapCount !== null && (
                        <span style={{ color: 'var(--txd)' }}> · {mapCount} ON MAP</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                    {party.leader === m && (
                      <span className="mono" style={{ fontSize: 10, color: 'var(--gold)', border: '1px solid var(--golddim)', borderRadius: 3, padding: '1px 5px' }}>LDR</span>
                    )}
                    {!isSelf && !isFriend && !isPending && (
                      <button className="btn-ghost btn-sm" style={{ fontSize: 10 }}
                        onClick={() => onSendRequest(m)}>
                        + FRIEND
                      </button>
                    )}
                    {!isSelf && isPending && (
                      <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>PENDING</span>
                    )}
                    {!isSelf && isFriend && (
                      <span className="mono" style={{ fontSize: 10, color: 'var(--grn)' }}>✓</span>
                    )}
                  </div>
                </div>
              )
            })}

          {/* Map Recommendations */}
          {mapStats.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--brd)' }}>
              <button
                onClick={() => setShowMapRec(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                  background: 'transparent', border: 'none', padding: '3px 0',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--gold)', flexShrink: 0 }}>◆</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--goldtx)', letterSpacing: '.06em', flex: 1, textAlign: 'left' }}>
                  MAP RECOMMENDATIONS
                </span>
                <span className="mono" style={{ fontSize: 9, color: 'var(--txd)' }}>
                  {showMapRec ? '▲' : `▼ ${mapStats[0].map.name.slice(0, 8).toUpperCase()}`}
                </span>
              </button>

              {showMapRec && (() => {
                const maxTotal = mapStats[0].total
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }} className="fade-in">
                    {mapStats.map((stat, i) => {
                      const pct = maxTotal ? Math.round((stat.total / maxTotal) * 100) : 0
                      const isTop = i === 0
                      return (
                        <div key={stat.map.id} style={{
                          padding: isTop ? '6px 8px' : '4px 8px',
                          background: isTop ? 'rgba(201,168,76,0.06)' : 'var(--sur2)',
                          border: `1px solid ${isTop ? 'var(--golddim)' : 'var(--brd)'}`,
                          borderRadius: 4,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                            <span className="mono" style={{ fontSize: 9, color: isTop ? 'var(--gold)' : 'var(--txd)', flexShrink: 0 }}>#{i + 1}</span>
                            <span style={{ fontSize: isTop ? 11 : 10, fontWeight: isTop ? 600 : 400, color: isTop ? 'var(--tx)' : 'var(--txm)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {stat.map.name.toUpperCase()}
                            </span>
                            <span className="mono" style={{ fontSize: 9, color: isTop ? 'var(--goldtx)' : 'var(--txm)', flexShrink: 0 }}>
                              {stat.total}Q
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <div style={{ flex: 1, height: 3, background: 'var(--brd)', borderRadius: 2 }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: isTop ? 'var(--gold)' : 'var(--brd2)', borderRadius: 2 }} />
                            </div>
                            {stat.crossover > 0 && (
                              <span className="mono" style={{ fontSize: 9, color: 'var(--grn)', flexShrink: 0 }}>{stat.crossover}S</span>
                            )}
                            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                              {Object.entries(stat.perMember).filter(([, v]) => v > 0).map(([name]) => {
                                const c = memberColor(name, members)
                                return (
                                  <span key={name} className="mono" title={`${name}: ${stat.perMember[name]} quest${stat.perMember[name] !== 1 ? 's' : ''}`} style={{
                                    fontSize: 9, width: 14, height: 14, borderRadius: 2,
                                    background: c.bg, border: `1px solid ${c.border}`, color: c.text,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0, cursor: 'default',
                                  }}>
                                    {name[0].toUpperCase()}
                                  </span>
                                )
                              })}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          )}
          </div>
        </div>

        {/* Main */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>

          {/* Map selector */}
          <div className="card" style={{ padding: 16 }}>
            <div className="lbl">{isLeader ? 'SELECT MAP FOR THIS RAID' : 'MAP — SET BY LEADER'}</div>
            {loadingMaps
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Spin s={18} /><span className="mono" style={{ fontSize: 12, color: 'var(--txm)' }}>LOADING MAPS...</span></div>
              : (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {maps.map(m => (
                      <button key={m.id}
                        onClick={() => isLeader && onSelectMap(m)}
                        className={party.map_id === m.id ? 'btn-gold' : 'btn-ghost'}
                        style={{ padding: '7px 12px', fontSize: 13, opacity: isLeader ? 1 : .7, cursor: isLeader ? 'pointer' : 'default' }}>
                        {m.name.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  {party.map_norm && RED_REBEL_MAPS.has(party.map_norm) && (
                    <div style={{
                      marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--brd)',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{ fontSize: 16 }}>⛏</span>
                      <span style={{ fontSize: 16 }}>🪢</span>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--goldtx)', letterSpacing: '.04em' }}>
                        CLIFF DESCENT AVAILABLE — BRING RED REBEL ICE PICK + PARACORD
                      </span>
                    </div>
                  )}

                </>
              )
            }
          </div>

          {party.map_id && (
            <>
              {/* Tabs */}
              <div className="tab-bar">
                {[['todo', 'TODO LIST'], ['quests', 'QUESTS'], ['items', 'REQUIRED ITEMS'], ['map', 'MAP / ROUTE'], ['keys', 'KEYS']].map(([id, lbl]) => (
                  <button key={id} onClick={() => setTab(id)} style={{
                    background: 'none', border: 'none',
                    borderBottom: `2px solid ${tab === id ? 'var(--gold)' : 'transparent'}`,
                    color: tab === id ? 'var(--goldtx)' : 'var(--txm)',
                    fontFamily: 'Rajdhani', fontWeight: 600, fontSize: 14, letterSpacing: '.08em',
                    padding: '8px 18px', borderRadius: 0, cursor: 'pointer', transition: 'all .15s',
                  }}>{lbl}</button>
                ))}
              </div>

              {tab === 'quests' && (
                <div className="card fade-in" style={{ padding: 16 }}>
                  <>
                    <div className="lbl">{myName.toUpperCase()} — YOUR ACTIVE QUESTS ON {party.map_name?.toUpperCase()}</div>
                    <QuestSearch tasks={tasks} mine={mine} completedQuests={completedQuests} onAdd={onAddQuest} onRemove={onRemoveQuest} loading={loadingTasks} mapNorm={party.map_norm} />
                    {members.filter(m => m !== myName).map(m => (
                      <div key={m} style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--brd)' }}>
                        <div className="lbl">{m.toUpperCase()} — QUESTS</div>
                        {!(party.members[m] || []).length
                          ? <p className="mono" style={{ fontSize: 11, color: 'var(--txd)' }}>WAITING FOR {m.toUpperCase()} TO ADD QUESTS</p>
                          : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {(party.members[m] || []).map(q => {
                              const task = tasks.find(t => t.id === q.id)
                              return (
                                <span key={q.id}
                                  onMouseEnter={task ? e => setChipTooltip({ task, anchor: e.currentTarget.getBoundingClientRect() }) : undefined}
                                  onMouseLeave={() => setChipTooltip(null)}
                                  style={{ display: 'inline-flex', background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 3, padding: '2px 7px', fontSize: 11, fontFamily: 'Share Tech Mono', color: 'var(--txm)', cursor: task ? 'default' : undefined }}>
                                  {q.name}
                                </span>
                              )
                            })}
                          </div>
                        }
                      </div>
                    ))}
                  </>

                  {/* Hover tooltip (shared between both views) */}
                  {chipTooltip && (() => {
                    const objs = (chipTooltip.task.objectives || []).filter(o => {
                      if (o.optional) return false
                      if (!o.maps || o.maps.length === 0) return true
                      return o.maps.some(m => m.normalizedName === party.map_norm)
                    })
                    const a = chipTooltip.anchor
                    const showAbove = (window.innerHeight - a.bottom) < 220 && a.top > 220
                    return objs.length ? (
                      <div style={{
                        position: 'fixed',
                        left: Math.min(a.left, window.innerWidth - 320),
                        ...(showAbove ? { bottom: window.innerHeight - a.top + 4 } : { top: a.bottom + 4 }),
                        width: 300, background: 'rgba(6,16,10,0.98)',
                        border: '1px solid var(--brd2)', borderRadius: 5,
                        padding: '8px 10px', zIndex: 300, pointerEvents: 'none',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.7)',
                      }}>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--gold)', marginBottom: 6, letterSpacing: '.06em' }}>
                          {chipTooltip.task.name.toUpperCase()}
                        </div>
                        {objs.map(obj => (
                          <div key={obj.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--brd)' }}>
                            <span style={{ fontSize: 12, color: 'var(--tx)', flex: 1, lineHeight: 1.4 }}>{obj.description}</span>
                          </div>
                        ))}
                      </div>
                    ) : null
                  })()}
                </div>
              )}

              {tab === 'todo' && (
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                  {/* Squad Objectives — party-wide card */}
                  <div className="card fade-in" style={{ padding: 16, flex: 1, minWidth: 0 }}>
                    {!mine.length ? (
                      mineWasNonEmpty.current ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '32px 24px', justifyContent: 'center' }}>
                          <Spin />
                          <span className="mono" style={{ fontSize: 12, color: 'var(--txm)' }}>SYNCING...</span>
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', padding: '40px 24px' }}>
                          <div className="mono" style={{ fontSize: 13, color: 'var(--goldtx)', letterSpacing: '.1em', marginBottom: 10 }}>NO QUESTS ADDED</div>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--txm)', lineHeight: 1.7 }}>
                            ADD QUESTS ON THE FLY FROM THE <button onClick={() => setTab('quests')} className="btn-ghost btn-sm" style={{ display: 'inline', padding: '1px 7px', fontSize: 11 }}>QUESTS</button> TAB,<br />
                            OR MANAGE THEM CENTRALLY UNDER <button onClick={onMyQuests} className="btn-ghost btn-sm" style={{ display: 'inline', padding: '1px 7px', fontSize: 11, color: 'var(--gold)', borderColor: 'var(--golddim)' }}>★ QUEST MANAGER</button>
                          </div>
                        </div>
                      )
                    ) : loadingTasks
                      ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8 }}><Spin /><span className="mono" style={{ fontSize: 12, color: 'var(--txm)' }}>LOADING...</span></div>
                      : (
                        <TodoList
                          key={party.map_norm}
                          tasks={tasks}
                          memberQuests={party.members}
                          progress={party.progress || {}}
                          starredQuests={party.starred || {}}
                          onToggleStar={onToggleStar}
                          questOrder={party.quest_order}
                          initialSkipped={skippedQuestIds}
                          myName={myName}
                          mapNorm={party.map_norm}
                        />
                      )
                    }
                  </div>
                  {/* My Quests — personal card */}
                  <div className="card fade-in" style={{ padding: 16, flex: 1, minWidth: 0, position: 'sticky', top: 16 }}>
                    <MyQuestPanel
                      myQuests={mine}
                      tasks={tasks}
                      progress={party.progress || {}}
                      myName={myName}
                      onSubmit={onSubmitProgress}
                      mapNorm={party.map_norm}
                    />
                  </div>
                </div>
              )}

              {tab === 'items' && (
                <div className="card fade-in" style={{ padding: 16 }}>
                  {loadingTasks
                    ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8 }}><Spin /><span className="mono" style={{ fontSize: 12, color: 'var(--txm)' }}>LOADING...</span></div>
                    : <RequiredItems tasks={tasks} memberQuests={party.members} mapNorm={party.map_norm} />
                  }
                </div>
              )}

              {tab === 'keys' && (
                <div className="card fade-in" style={{ padding: 16 }}>
                  <KeysList mapNorm={party.map_norm} />
                </div>
              )}

              {tab === 'map' && (
                <div className="card fade-in" style={{ padding: 16 }}>
                  <MapCanvas
                    mapNorm={party.map_norm}
                    mapName={party.map_name}
                    drawings={party.drawings || []}
                    markers={party.markers || []}
                    myName={myName}
                    memberNames={members}
                    myQuests={mine}
                    tasks={tasks}
                    onAddStroke={onAddStroke}
                    onClearMyStrokes={onClearMyStrokes}
                    onAddMarker={onAddMarker}
                    onClearMyMarkers={onClearMyMarkers}
                  />
                </div>
              )}
            </>
          )}

          {!party.map_id && !loadingMaps && (
            <div className="card" style={{ padding: 24, textAlign: 'center' }}>
              <p className="mono" style={{ color: 'var(--txm)', fontSize: 13 }}>
                {isLeader ? '↑ SELECT A MAP TO BEGIN PLANNING' : 'WAITING FOR LEADER TO SELECT A MAP...'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
