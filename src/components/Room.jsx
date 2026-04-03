import { useState } from 'react'
import { useMaps, useTasks } from '../useTarkov'
import { RED_REBEL_MAPS } from '../constants'
import QuestSearch from './QuestSearch'
import TodoList from './TodoList'
import MapCanvas from './MapCanvas'
import KeysList from './KeysList'
import RequiredItems from './RequiredItems'

function Spin({ s = 20 }) {
  return <div style={{ width: s, height: s, border: '2px solid var(--brd2)', borderTop: '2px solid var(--gold)', borderRadius: '50%', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
}

export default function Room({ party, myName, isAdmin, onLeave, onSelectMap, onAddQuest, onRemoveQuest, onSetSpawn, onToggleObjective, onToggleStar, onToggleComplete, onAddStroke, onClearMyStrokes, onMyQuests, onAdmin, friends = [], onAddFriend, onRemoveFriend, onRefreshFriends }) {
  const [tab, setTab]           = useState('quests')
  const [copied, setCopied]     = useState(false)
  const [showFriends, setShowFriends] = useState(false)
  const [addInput, setAddInput] = useState('')
  const [addError, setAddError] = useState('')
  const [addBusy, setAddBusy]   = useState(false)

  async function handleAddFriend() {
    if (!addInput.trim()) return
    setAddBusy(true); setAddError('')
    const err = await onAddFriend(addInput)
    if (err) setAddError(err)
    else setAddInput('')
    setAddBusy(false)
  }

  const { maps, loading: loadingMaps } = useMaps()
  const { tasks, loading: loadingTasks } = useTasks(party.map_norm)

  const isLeader = party.leader === myName
  const members  = Object.keys(party.members || {})
  const mine     = party.members?.[myName] || []

  // Completed quests are stored in progress with __done__: prefix (no extra DB column needed)
  const completedQuests = Object.fromEntries(
    Object.entries(party.progress || {})
      .filter(([k, v]) => k.startsWith('__done__:') && v)
      .map(([k]) => [k.slice(9), true])
  )

  function copy() {
    navigator.clipboard?.writeText(`https://dudgy.net/join/${party.code}`).catch(() => {})
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ minHeight: '100vh', padding: '14px 16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid var(--brd)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 4, height: 26, background: 'var(--gold)', borderRadius: 2 }} />
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>SQUAD PLANNER</h1>
            <div className="mono" style={{ fontSize: 11, color: 'var(--txm)' }}>
              {party.map_name ? `// ${party.map_name.toUpperCase()}` : '// NO MAP SELECTED'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn-ghost btn-sm" onClick={onMyQuests}
            style={{ color: 'var(--gold)', borderColor: 'var(--golddim)' }}>
            ★ MY QUESTS
          </button>
          <button
            className={showFriends ? 'btn-ghost btn-sm btn-active' : 'btn-ghost btn-sm'}
            onClick={() => { setShowFriends(v => !v); if (!showFriends) onRefreshFriends() }}
          >
            FRIENDS{friends.length > 0 ? ` (${friends.length})` : ''}
          </button>
          {isAdmin && (
            <button className="btn-ghost btn-sm" onClick={onAdmin}
              style={{ color: 'var(--txm)', borderColor: 'var(--brd2)' }}>
              ⚙ KEY EDITOR
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 4, padding: '5px 10px' }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--txm)' }}>PARTY</span>
            <span className="mono" style={{ fontSize: 17, color: 'var(--gold)', letterSpacing: '0.2em' }}>{party.code}</span>
            <button className="btn-ghost btn-sm" onClick={copy}>{copied ? '✓' : 'COPY'}</button>
          </div>
          <button className="btn-danger btn-sm" onClick={onLeave}>LEAVE</button>
        </div>
      </div>

      {/* Friends panel */}
      {showFriends && (
        <div className="card fade-in" style={{ marginBottom: 14, padding: '12px 16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 24px', alignItems: 'flex-start' }}>

            {/* Friend list */}
            <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div className="lbl">FRIENDS</div>
              {friends.length === 0 && (
                <div className="mono" style={{ fontSize: 11, color: 'var(--txd)' }}>NO FRIENDS ADDED YET</div>
              )}
              {friends.map(f => (
                <div key={f.callsign} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: f.partyCode ? 'var(--gold)' : 'var(--txd)', flexShrink: 0 }} />
                  <span className="mono" style={{ flex: 1, fontSize: 12, color: f.partyCode ? 'var(--tx)' : 'var(--txm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.callsign}
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: f.partyCode ? 'var(--gold)' : 'var(--txd)' }}>
                    {f.partyCode ? 'IN PARTY' : 'OFFLINE'}
                  </span>
                  <button
                    className="btn-ghost btn-sm"
                    style={{ color: 'var(--txd)', borderColor: 'transparent', padding: '3px 6px' }}
                    onClick={() => onRemoveFriend(f.callsign)}
                  >×</button>
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
                  onKeyDown={e => e.key === 'Enter' && handleAddFriend()}
                  style={{ fontSize: 13 }}
                  disabled={addBusy}
                />
                <button className="btn-ghost btn-sm" onClick={handleAddFriend} disabled={addBusy} style={{ whiteSpace: 'nowrap' }}>+ ADD</button>
              </div>
              {addError && <p className="mono" style={{ color: 'var(--red)', fontSize: 11 }}>⚠ {addError}</p>}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', gap: 14 }}>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Members */}
          <div className="card" style={{ padding: 14 }}>
            <div className="lbl">PARTY MEMBERS</div>
            {members.map(m => (
              <div key={m} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--brd)' }}>
                <div>
                  <div style={{ fontSize: 13, color: m === myName ? 'var(--goldtx)' : 'var(--tx)' }}>
                    {m}{m === myName ? ' · you' : ''}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--txm)' }}>
                    {(party.members[m] || []).length} QUEST{(party.members[m] || []).length !== 1 ? 'S' : ''}
                  </div>
                </div>
                {party.leader === m && (
                  <span className="mono" style={{ fontSize: 10, color: 'var(--gold)', border: '1px solid var(--golddim)', borderRadius: 3, padding: '1px 5px' }}>LDR</span>
                )}
              </div>
            ))}
          </div>

          {/* Per-member quest summary — the key usability panel */}
          {party.map_id && (
            <div className="card" style={{ padding: 14 }}>
              <div className="lbl">ALL PARTY QUESTS</div>
              {members.map(m => {
                const quests = party.members[m] || []
                return (
                  <div key={m} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', flexShrink: 0 }} />
                      <div className="mono" style={{ fontSize: 10, color: m === myName ? 'var(--goldtx)' : 'var(--txm)', letterSpacing: '.06em' }}>
                        {m.toUpperCase()}
                      </div>
                    </div>
                    {!quests.length
                      ? <div className="mono" style={{ fontSize: 10, color: 'var(--txd)', paddingLeft: 12 }}>—</div>
                      : quests.map(q => {
                        const taskObjs = tasks.find(t => t.id === q.id)?.objectives?.filter(o => !o.optional) || []
                        const doneCnt  = taskObjs.filter(o => party.progress?.[`${q.id}::${o.id}`]).length
                        const allDone  = taskObjs.length > 0 && doneCnt === taskObjs.length
                        const starred  = party.starred?.[q.id]
                        return (
                          <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 0 3px 12px', opacity: allDone ? .4 : 1 }}>
                            <span style={{ fontSize: 11, color: starred ? 'var(--gold)' : 'var(--txd)', flexShrink: 0 }}>
                              {starred ? '★' : '◆'}
                            </span>
                            <span style={{ fontSize: 11, color: allDone ? 'var(--txd)' : 'var(--txm)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: allDone ? 'line-through' : 'none' }}>
                              {q.name}
                            </span>
                            {taskObjs.length > 0 && (
                              <span className="mono" style={{ fontSize: 9, color: allDone ? 'var(--grn)' : 'var(--txd)', flexShrink: 0 }}>
                                {doneCnt}/{taskObjs.length}
                              </span>
                            )}
                          </div>
                        )
                      })
                    }
                  </div>
                )
              })}
            </div>
          )}
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
              <div style={{ display: 'flex', borderBottom: '1px solid var(--brd)' }}>
                {[['quests', 'QUESTS'], ['todo', 'TODO LIST'], ['items', 'REQUIRED ITEMS'], ['map', 'MAP / ROUTE'], ['keys', 'KEYS']].map(([id, lbl]) => (
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
                  <div className="lbl">{myName.toUpperCase()} — YOUR ACTIVE QUESTS</div>
                  <QuestSearch tasks={tasks} mine={mine} completedQuests={completedQuests} onAdd={onAddQuest} onRemove={onRemoveQuest} loading={loadingTasks} />
                  {members.filter(m => m !== myName).map(m => (
                    <div key={m} style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--brd)' }}>
                      <div className="lbl">{m.toUpperCase()} — QUESTS</div>
                      {!(party.members[m] || []).length
                        ? <p className="mono" style={{ fontSize: 11, color: 'var(--txd)' }}>WAITING FOR {m.toUpperCase()} TO ADD QUESTS</p>
                        : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {(party.members[m] || []).map(q => (
                            <span key={q.id} style={{ display: 'inline-flex', background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 3, padding: '2px 7px', fontSize: 11, fontFamily: 'Share Tech Mono', color: 'var(--txm)' }}>{q.name}</span>
                          ))}
                        </div>
                      }
                    </div>
                  ))}
                </div>
              )}

              {tab === 'todo' && (
                <div className="card fade-in" style={{ padding: 16 }}>
                  {loadingTasks
                    ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8 }}><Spin /><span className="mono" style={{ fontSize: 12, color: 'var(--txm)' }}>LOADING...</span></div>
                    : <TodoList
                        key={party.map_norm}
                        tasks={tasks}
                        memberQuests={party.members}
                        progress={party.progress || {}}
                        starredQuests={party.starred || {}}
                        completedQuests={completedQuests}
                        onToggleObjective={onToggleObjective}
                        onToggleStar={onToggleStar}
                        onToggleComplete={onToggleComplete}
                        myName={myName}
                        isLeader={isLeader}
                      />
                  }
                </div>
              )}

              {tab === 'items' && (
                <div className="card fade-in" style={{ padding: 16 }}>
                  {loadingTasks
                    ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8 }}><Spin /><span className="mono" style={{ fontSize: 12, color: 'var(--txm)' }}>LOADING...</span></div>
                    : <RequiredItems tasks={tasks} memberQuests={party.members} />
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
                    myName={myName}
                    memberNames={members}
                    onAddStroke={onAddStroke}
                    onClearMyStrokes={onClearMyStrokes}
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
