import { useState, useRef, useMemo } from 'react'
import { useMaps, useTasks } from '../useTarkov'
import { useIsMobile } from '../useIsMobile'
import QuestSearch from './QuestSearch'
import TodoList from './TodoList'
import MyQuestPanel from './MyQuestPanel'
import MapLeaflet from './MapLeaflet'
import RequiredItems from './RequiredItems'
import FindItems from './FindItems'
import BossPanel from './BossPanel'
import TarkovClocks from './TarkovClocks'
import StartRaidModal from './StartRaidModal'
import RaidView from './RaidView'

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

export default function Room({ party, myName, isAdmin, questsLoading, onLeave, onSelectMap, onAddQuest, onRemoveQuest, onSetSpawn, onToggleStar, skippedQuestIds, onAddStroke, onClearMyStrokes, onAddMarker, onClearMyMarkers, onMyQuests, onAdmin, onSubmitProgress, onQuestComplete, userObjProgress, friends = [], pendingIn = [], pendingOut = [], onSendRequest, onAcceptRequest, onRemoveRequest, onRemoveFriend, onRefreshFriends, onRefresh, onStartRaid }) {
  const isMobile = useIsMobile()
  const [tab, setTab]           = useState('todo')
  const [copied, setCopied]     = useState(false)
  const [showFriends, setShowFriends] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [addInput, setAddInput] = useState('')
  const [addError, setAddError] = useState('')
  const [addBusy, setAddBusy]   = useState(false)
  const [confirmUnfriend, setConfirmUnfriend] = useState(null)
  const [chipTooltip, setChipTooltip] = useState(null)  // { task, anchor }
  const [dismissedRaidStart, setDismissedRaidStart] = useState(null)
  const [raidView, setRaidView] = useState(false)

  const raidStart = party.progress?.['__raid_start__'] || null
  const showRaidModal = !!party.map_id && raidStart !== null && raidStart !== dismissedRaidStart


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

      {showRaidModal && (
        <StartRaidModal
          party={party}
          myName={myName}
          tasks={allTasks}
          onClose={() => setDismissedRaidStart(raidStart)}
        />
      )}

      {raidView && party.map_id && (
        <RaidView
          party={party}
          myName={myName}
          members={members}
          tasks={tasks}
          allTasks={allTasks}
          loadingTasks={loadingTasks}
          skippedQuestIds={skippedQuestIds}
          onToggleStar={onToggleStar}
          onAddStroke={onAddStroke}
          onClearMyStrokes={onClearMyStrokes}
          onAddMarker={onAddMarker}
          onClearMyMarkers={onClearMyMarkers}
          onClose={() => setRaidView(false)}
        />
      )}

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
            <TarkovClocks />
            {!isMobile && (
              <>
                <button className="btn-ghost btn-sm" onClick={onMyQuests} style={{ color: 'var(--gold)', borderColor: 'var(--golddim)' }}>★ QUEST MANAGER</button>
                {raidStart !== null && party.map_id && (
                  <button className="btn-ghost btn-sm" onClick={() => setRaidView(true)} style={{ color: 'var(--goldtx)', borderColor: 'var(--golddim)' }}>⛺ RAID VIEW</button>
                )}
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
            {isLeader && party.map_id && (
              <button className="btn-gold btn-sm" onClick={onStartRaid} style={{ letterSpacing: '.06em' }}>▶ START RAID</button>
            )}
            <button className="btn-danger btn-sm" onClick={onLeave}>LEAVE</button>
          </div>
        </div>

        {/* Mobile second row */}
        {isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn-ghost btn-sm" onClick={onMyQuests} style={{ color: 'var(--gold)', borderColor: 'var(--golddim)' }}>★ QUEST MANAGER</button>
            {raidStart !== null && party.map_id && (
              <button className="btn-ghost btn-sm" onClick={() => setRaidView(true)} style={{ color: 'var(--goldtx)', borderColor: 'var(--golddim)' }}>⛺ RAID VIEW</button>
            )}
            <button className={showFriends ? 'btn-ghost btn-sm btn-active' : 'btn-ghost btn-sm'} onClick={() => { setShowFriends(v => !v); if (!showFriends) onRefreshFriends() }}>
              FRIENDS{friends.length > 0 ? ` (${friends.length})` : ''}
            </button>
            {isAdmin && <button className="btn-ghost btn-sm" onClick={onAdmin} style={{ color: 'var(--txm)' }}>⚙</button>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 4, padding: '4px 8px' }}>
              <span className="mono" style={{ fontSize: 15, color: 'var(--gold)', letterSpacing: '0.2em' }}>{party.code}</span>
              <button className="btn-ghost btn-sm" onClick={copy}>{copied ? '✓' : 'COPY'}</button>
            </div>
            {isLeader && party.map_id && (
              <button className="btn-gold btn-sm" onClick={onStartRaid} style={{ letterSpacing: '.06em' }}>▶ START RAID</button>
            )}
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

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : (sidebarOpen ? '210px 1fr' : '28px 1fr'), gap: 14, transition: 'grid-template-columns .2s' }}>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>

          {/* Collapse toggle when closed */}
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              title="Expand sidebar"
              style={{
                background: 'var(--sur2)', border: '1px solid var(--brd)', borderRadius: 4,
                color: 'var(--txd)', cursor: 'pointer', padding: '6px 0',
                fontSize: 12, writingMode: 'vertical-rl', width: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >▶</button>
          )}

          {/* Members */}
          {sidebarOpen && <div className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div className="lbl" style={{ marginBottom: 0 }}>PARTY MEMBERS</div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn-ghost btn-sm" onClick={onRefresh} title="Refresh members" style={{ fontSize: 14, padding: '2px 7px', color: 'var(--txd)' }}>↻</button>
                <button className="btn-ghost btn-sm" onClick={() => setSidebarOpen(false)} title="Collapse sidebar" style={{ fontSize: 11, padding: '2px 7px', color: 'var(--txd)' }}>◀</button>
              </div>
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
              <div className="mono" style={{ fontSize: 10, color: 'var(--goldtx)', letterSpacing: '.06em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--gold)' }}>◆</span>
                MAP RECOMMENDATIONS
              </div>
              {(() => {
                const maxTotal = mapStats[0].total
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                            {/* Segmented bar: each member's width = their share of total quests on this map */}
                            <div style={{ flex: 1, height: 4, background: 'var(--brd)', borderRadius: 2, overflow: 'hidden', display: 'flex' }}>
                              {(() => {
                                const activeEntries = Object.entries(stat.perMember).filter(([, v]) => v > 0)
                                const barTotal = activeEntries.reduce((s, [, v]) => s + v, 0)
                                return activeEntries.map(([name, count], idx) => {
                                  const c = memberColor(name, members)
                                  const segPct = barTotal ? (count / barTotal) * pct : 0
                                  return (
                                    <div key={name} title={`${name}: ${count} quest${count !== 1 ? 's' : ''}`} style={{
                                      height: '100%',
                                      flex: `0 0 ${segPct}%`,
                                      background: c.text,
                                      opacity: isTop ? 1 : 0.6,
                                    }} />
                                  )
                                })
                              })()}
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
          </div>}
        </div>

        {/* Main */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>

          {/* Map selector */}
          <div className="card" style={{ padding: 16 }}>
            <div className="lbl">{isLeader ? 'SELECT MAP FOR THIS RAID' : 'MAP — SET BY LEADER'}</div>
            {loadingMaps
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Spin s={18} /><span className="mono" style={{ fontSize: 12, color: 'var(--txm)' }}>LOADING MAPS...</span></div>
              : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
                  {maps.map(m => (
                    <button key={m.id}
                      onClick={() => isLeader && onSelectMap(m)}
                      className={party.map_id === m.id ? 'btn-gold' : 'btn-ghost'}
                      style={{ padding: '7px 12px', fontSize: 13, opacity: isLeader ? 1 : .7, cursor: isLeader ? 'pointer' : 'default' }}>
                      {m.name.toUpperCase()}
                    </button>
                  ))}
                </div>
              )
            }
          </div>

          {party.map_id && (
            <>
              {/* Tabs */}
              <div className="tab-bar">
                {[['todo', 'TODO LIST'], ['items', 'REQUIRED ITEMS'], ['find', 'WHAT TO LOOK FOR'], ['map', 'MAP / ROUTE'], ['bosses', 'BOSS SPAWNS']].map(([id, lbl]) => (
                  <button key={id} onClick={() => setTab(id)} style={{
                    background: 'none', border: 'none',
                    borderBottom: `2px solid ${tab === id ? 'var(--gold)' : 'transparent'}`,
                    color: tab === id ? 'var(--goldtx)' : 'var(--txm)',
                    fontFamily: 'Rajdhani', fontWeight: 600, fontSize: 14, letterSpacing: '.08em',
                    padding: '8px 18px', borderRadius: 0, cursor: 'pointer', transition: 'all .15s',
                  }}>{lbl}</button>
                ))}
              </div>


              {tab === 'todo' && (
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                  {/* Squad Objectives — party-wide card */}
                  <div className="card fade-in" style={{ padding: 16, flex: 1, minWidth: 0 }}>
                    {!mine.length ? (
                      (mineWasNonEmpty.current || questsLoading) ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '32px 24px', justifyContent: 'center' }}>
                          <Spin />
                          <span className="mono" style={{ fontSize: 12, color: 'var(--txm)' }}>SYNCING...</span>
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', padding: '40px 24px' }}>
                          <div className="mono" style={{ fontSize: 13, color: 'var(--goldtx)', letterSpacing: '.1em', marginBottom: 10 }}>NO QUESTS ADDED</div>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--txm)', lineHeight: 1.7 }}>
                            CLICK <button onClick={onMyQuests} className="btn-ghost btn-sm" style={{ display: 'inline', padding: '1px 7px', fontSize: 11, color: 'var(--gold)', borderColor: 'var(--golddim)' }}>★ QUEST MANAGER</button> AT THE TOP TO IMPORT YOUR QUESTS
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
                      userObjProgress={userObjProgress}
                      myName={myName}
                      onSubmit={onSubmitProgress}
                      onQuestComplete={onQuestComplete}
                      onOpenQuestManager={onMyQuests}
                      mapNorm={party.map_norm}
                      loading={questsLoading}
                    />
                  </div>
                </div>
              )}

              {tab === 'items' && (
                <div className="card fade-in" style={{ padding: 16 }}>
                  {loadingTasks
                    ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8 }}><Spin /><span className="mono" style={{ fontSize: 12, color: 'var(--txm)' }}>LOADING...</span></div>
                    : <RequiredItems tasks={tasks} memberQuests={party.members} mapNorm={party.map_norm} progress={party.progress} />
                  }
                </div>
              )}

              {tab === 'find' && (
                <div className="card fade-in" style={{ padding: 16 }}>
                  {loadingTasks
                    ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8 }}><Spin /><span className="mono" style={{ fontSize: 12, color: 'var(--txm)' }}>LOADING...</span></div>
                    : <FindItems tasks={tasks} memberQuests={party.members} mapNorm={party.map_norm} progress={party.progress} myName={myName} />
                  }
                </div>
              )}

              {tab === 'bosses' && (
                <div className="card fade-in" style={{ padding: 16 }}>
                  <BossPanel mapNorm={party.map_norm} />
                </div>
              )}

              {tab === 'map' && (
                <div className="card fade-in" style={{ padding: 16 }}>
                  <MapLeaflet
                    mapNorm={party.map_norm}
                    mapName={party.map_name}
                    drawings={party.drawings || []}
                    markers={party.markers || []}
                    myName={myName}
                    memberNames={members}
                    myQuests={mine}
                    memberQuests={party.members || {}}
                    tasks={allTasks}
                    progress={party.progress || {}}
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
