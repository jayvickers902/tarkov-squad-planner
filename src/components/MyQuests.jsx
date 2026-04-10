import { useState, useMemo, useEffect } from 'react'
import { useTasks } from '../useTarkov'
import { FEATURED } from '../constants'
import QuestScanner from './QuestScanner'

// Small Kappa badge — reused in search results and saved list
function KappaBadge() {
  return (
    <span className="mono" title="Required for Kappa" style={{
      fontSize: 9, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
      background: 'rgba(201,168,76,0.15)', border: '1px solid var(--golddim)',
      color: 'var(--gold)', letterSpacing: '.06em',
    }}>κ</span>
  )
}

const MAP_NAMES = {
  customs: 'Customs', woods: 'Woods', interchange: 'Interchange',
  shoreline: 'Shoreline', factory: 'Factory', lighthouse: 'Lighthouse',
  'streets-of-tarkov': 'Streets', reserve: 'Reserve',
  'ground-zero': 'Ground Zero', 'the-lab': 'The Lab',
}

export default function MyQuests({ userId, userQuests, onAdd, onRemove, onToggleImportant, onToggleSkipped, onClearAll, onRestore, onDone, inParty }) {
  const [mapFilter, setMapFilter]     = useState('all')
  const [searchMap, setSearchMap]     = useState('any')
  const [searchQ, setSearchQ]         = useState('')
  const [searchOpen, setSearchOpen]   = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [recentlyAdded, setRecentlyAdded] = useState(new Set())
  const [questOrder, setQuestOrder] = useState(() => userQuests.map(q => q.quest_id))

  // Sync questOrder when userQuests changes externally (restore, clear, done)
  useEffect(() => {
    setQuestOrder(prev => {
      const currentIds = new Set(userQuests.map(q => q.quest_id))
      const cleaned = prev.filter(id => currentIds.has(id))
      const existingSet = new Set(cleaned)
      const newIds = userQuests.filter(q => !existingSet.has(q.quest_id)).map(q => q.quest_id)
      return [...newIds, ...cleaned]
    })
  }, [userQuests])

  const snapKey = userId ? `tarkov_quests_${userId}` : null
  const [snapshot, setSnapshot] = useState(() => {
    if (!snapKey) return null
    try { return JSON.parse(localStorage.getItem(snapKey)) } catch { return null }
  })
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [restoring, setRestoring] = useState(false)

  function handleSaveSnapshot() {
    if (!snapKey) return
    const snap = { savedAt: new Date().toISOString(), quests: userQuests }
    localStorage.setItem(snapKey, JSON.stringify(snap))
    setSnapshot(snap)
  }

  async function handleRestore() {
    setRestoring(true)
    await onRestore(snapshot.quests)
    setConfirmRestore(false)
    setRestoring(false)
  }

  // Load tasks for the currently selected search map
  const { tasks, loading: tasksLoading } = useTasks(searchMap === 'any' ? null : searchMap)
  // Always load all tasks for kappa lookup (uses module-level cache — no extra fetch)
  const { tasks: allTasks } = useTasks(null)
  const kappaIds = useMemo(() => new Set(allTasks.filter(t => t.kappaRequired).map(t => t.id)), [allTasks])

  const searchHits = useMemo(() => {
    if (searchQ.length < 1) return []
    return tasks
      .filter(t =>
        t.name.toLowerCase().includes(searchQ.toLowerCase()) &&
        !userQuests.find(q => q.quest_id === t.id)
      )
      .slice(0, 12)
  }, [searchQ, tasks, userQuests])

  // Filter the saved list (no sort — questOrder handles ordering)
  const filtered = useMemo(() => {
    let list = [...userQuests]
    if (mapFilter === 'any')  return list.filter(q => !q.map_norm)
    if (mapFilter !== 'all')  return list.filter(q => q.map_norm === mapFilter)
    return list
  }, [userQuests, mapFilter])

  // Apply questOrder sort to filtered list
  const orderedFiltered = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const ai = questOrder.indexOf(a.quest_id)
      const bi = questOrder.indexOf(b.quest_id)
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
  }, [filtered, questOrder])

  function moveToTop(questId) {
    const filteredIds = orderedFiltered.map(q => q.quest_id)
    setQuestOrder(prev => {
      const newOrder = prev.filter(id => id !== questId)
      const firstId = filteredIds.find(id => id !== questId)
      if (!firstId) return [questId, ...newOrder]
      const firstIdx = newOrder.indexOf(firstId)
      if (firstIdx === -1) return [questId, ...newOrder]
      newOrder.splice(firstIdx, 0, questId)
      return newOrder
    })
  }

  function moveToBottom(questId) {
    const filteredIds = orderedFiltered.map(q => q.quest_id)
    setQuestOrder(prev => {
      const newOrder = prev.filter(id => id !== questId)
      const lastId = [...filteredIds].reverse().find(id => id !== questId)
      if (!lastId) return [...newOrder, questId]
      const lastIdx = newOrder.indexOf(lastId)
      if (lastIdx === -1) return [...newOrder, questId]
      newOrder.splice(lastIdx + 1, 0, questId)
      return newOrder
    })
  }

  const mapCounts = useMemo(() => {
    const counts = { all: userQuests.length, any: 0 }
    userQuests.forEach(q => {
      if (!q.map_norm) counts.any = (counts.any || 0) + 1
      else counts[q.map_norm] = (counts[q.map_norm] || 0) + 1
    })
    return counts
  }, [userQuests])

  function handleAdd(task) {
    const autoMap = task.map?.normalizedName || null
    onAdd({ id: task.id, name: task.name }, autoMap)
    setSearchQ('')
    setRecentlyAdded(prev => new Set([...prev, task.id]))
    setTimeout(() => {
      setRecentlyAdded(prev => { const n = new Set(prev); n.delete(task.id); return n })
    }, 2800)
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '20px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--goldtx)' }}>MY QUESTS</h2>
          <div className="mono" style={{ fontSize: 11, color: 'var(--txm)', marginTop: 2 }}>
            SAVED BETWEEN SESSIONS — AUTO-LOADED WHEN YOU JOIN A PARTY
          </div>
        </div>
        <button className="btn-ghost" onClick={onDone} style={{ fontSize: 13 }}>
          {inParty ? '← BACK TO PARTY' : '← BACK TO LOBBY'}
        </button>
      </div>

      {/* In-party notice */}
      {inParty && (
        <div className="mono" style={{
          marginBottom: 16, padding: '8px 12px',
          background: 'var(--sur2)', border: '1px solid var(--golddim)',
          borderLeft: '3px solid var(--gold)', borderRadius: 4,
          fontSize: 11, color: 'var(--gold)', letterSpacing: '.04em',
        }}>
          ◆ YOUR PARTY IS STILL ACTIVE — CHANGES HERE WON'T AFFECT THE CURRENT RAID
        </div>
      )}

      {/* Snapshot save / restore */}
      {snapKey && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button
            className="btn-ghost btn-sm"
            onClick={handleSaveSnapshot}
            disabled={userQuests.length === 0}
            style={{ fontSize: 11 }}
          >
            ↓ SAVE SNAPSHOT ({userQuests.length})
          </button>
          {snapshot && !confirmRestore && (
            <button
              className="btn-ghost btn-sm"
              onClick={() => setConfirmRestore(true)}
              style={{ fontSize: 11, color: 'var(--gold)' }}
            >
              ↑ RESTORE SNAPSHOT · {snapshot.quests.length} QUESTS · {new Date(snapshot.savedAt).toLocaleDateString()}
            </button>
          )}
          {snapshot && confirmRestore && (
            <>
              <span className="mono" style={{ fontSize: 10, color: '#e07070' }}>
                REPLACE {userQuests.length} CURRENT QUESTS WITH {snapshot.quests.length} FROM SNAPSHOT?
              </span>
              <button
                className="btn-sm"
                onClick={handleRestore}
                disabled={restoring}
                style={{ fontSize: 11, background: 'rgba(180,60,60,.2)', border: '1px solid rgba(180,60,60,.4)', color: '#e07070' }}
              >{restoring ? 'RESTORING...' : 'YES, RESTORE'}</button>
              <button className="btn-ghost btn-sm" onClick={() => setConfirmRestore(false)} style={{ fontSize: 11 }}>CANCEL</button>
            </>
          )}
        </div>
      )}

      {/* Screenshot scanner */}
      <QuestScanner allTasks={allTasks} userQuests={userQuests} onAdd={onAdd} />

      {/* Add quest section */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="lbl">ADD QUEST TO YOUR LIST</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--txm)', flexShrink: 0 }}>FILTER BY MAP:</div>
          <button
            onClick={() => setSearchMap('any')}
            className={searchMap === 'any' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}>
            ANY MAP
          </button>
          {FEATURED.map(norm => (
            <button key={norm}
              onClick={() => setSearchMap(norm)}
              className={searchMap === norm ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
              style={{ fontSize: 11 }}>
              {MAP_NAMES[norm] || norm}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative' }}>
          {tasksLoading && searchMap !== 'any'
            ? <div className="mono" style={{ fontSize: 11, color: 'var(--txm)', padding: '8px 0' }}>LOADING QUESTS...</div>
            : <input
                placeholder={`Search quests${searchMap !== 'any' ? ` for ${MAP_NAMES[searchMap] || searchMap}` : ' (any map)'}...`}
                value={searchQ}
                onChange={e => { setSearchQ(e.target.value); setSearchOpen(true) }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => setTimeout(() => setSearchOpen(false), 160)}
              />
          }

          {searchOpen && searchHits.length > 0 && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
              background: 'var(--sur3)', border: '1px solid var(--brd2)', borderRadius: 5,
              maxHeight: 300, overflowY: 'auto',
            }}>
              {searchHits.map(t => (
                <div key={t.id}
                  onMouseDown={() => handleAdd(t)}
                  style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid var(--brd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--sur)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13 }}>{t.name}</span>
                      {t.kappaRequired && <KappaBadge />}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--txm)', marginTop: 2 }}>
                      {t.trader?.name} · Lv.{t.minPlayerLevel || 1}
                      {!t.map && <span style={{ marginLeft: 8, color: 'var(--txd)' }}>any map</span>}
                    </div>
                  </div>
                  <span style={{ color: 'var(--gold)', fontSize: 18, flexShrink: 0, marginLeft: 8 }}>+</span>
                </div>
              ))}
            </div>
          )}

          {searchOpen && searchQ.length >= 1 && searchHits.length === 0 && !tasksLoading && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
              background: 'var(--sur3)', border: '1px solid var(--brd2)', borderRadius: 5,
              padding: '12px', fontSize: 12, color: 'var(--txm)',
            }} className="mono">
              NO RESULTS FOR "{searchQ.toUpperCase()}"
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes goldFlash {
          0%   { box-shadow: 0 0 0 2px var(--gold); }
          60%  { box-shadow: 0 0 0 2px rgba(201,168,76,0.5); }
          100% { box-shadow: none; }
        }
        .quest-new-flash { animation: goldFlash 2.4s ease forwards; }
      `}</style>

      {/* Saved quests */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {[
            { key: 'all', label: `ALL (${mapCounts.all})` },
            { key: 'any', label: `ANY MAP (${mapCounts.any || 0})` },
            ...FEATURED.filter(n => mapCounts[n]).map(n => ({ key: n, label: `${MAP_NAMES[n]} (${mapCounts[n]})` })),
          ].map(({ key, label }) => (
            <button key={key}
              onClick={() => setMapFilter(key)}
              className={mapFilter === key ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
              style={{ fontSize: 11 }}>
              {label}
            </button>
          ))}
          {userQuests.length > 0 && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              {confirmClear ? (
                <>
                  <span className="mono" style={{ fontSize: 10, color: '#e07070' }}>CLEAR ALL {userQuests.length} QUESTS?</span>
                  <button
                    className="btn-sm"
                    onClick={() => { onClearAll(); setConfirmClear(false) }}
                    style={{ fontSize: 11, background: 'rgba(180,60,60,.2)', border: '1px solid rgba(180,60,60,.4)', color: '#e07070' }}
                  >YES, CLEAR</button>
                  <button className="btn-ghost btn-sm" onClick={() => setConfirmClear(false)} style={{ fontSize: 11 }}>CANCEL</button>
                </>
              ) : (
                <button className="btn-ghost btn-sm" onClick={() => setConfirmClear(true)} style={{ fontSize: 11, color: 'var(--txd)' }}>
                  CLEAR ALL
                </button>
              )}
            </div>
          )}
        </div>

        {!filtered.length ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div className="mono" style={{ fontSize: 12, color: 'var(--txd)' }}>
              {userQuests.length === 0 ? 'NO SAVED QUESTS YET — SEARCH ABOVE TO ADD SOME' : 'NO QUESTS FOR THIS FILTER'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {orderedFiltered.map((q, idx) => (
              <div key={q.quest_id} className={recentlyAdded.has(q.quest_id) ? 'quest-new-flash' : ''} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px',
                background: 'var(--sur2)',
                border: `1px solid ${q.important && !q.skipped ? 'var(--golddim)' : 'var(--brd)'}`,
                borderLeft: `3px solid ${q.skipped ? 'var(--brd)' : q.important ? 'var(--gold)' : 'var(--brd)'}`,
                borderRadius: 4,
                opacity: q.skipped ? 0.5 : 1,
                transition: 'opacity .2s',
              }}>
                {/* Important star */}
                <button
                  onClick={() => onToggleImportant(q.quest_id)}
                  title="Mark as important — will be starred when joining a party"
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0,
                    fontSize: 15, lineHeight: 1, color: q.important ? 'var(--gold)' : 'var(--txd)',
                    transition: 'color .15s',
                  }}>★</button>

                {/* Quest name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {q.quest_name}
                    </span>
                    {kappaIds.has(q.quest_id) && <KappaBadge />}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--txm)', marginTop: 2 }}>
                    {q.map_norm ? (MAP_NAMES[q.map_norm] || q.map_norm).toUpperCase() : 'ANY MAP'}
                    {q.skipped && <span style={{ marginLeft: 8, color: 'var(--txd)' }}>⊘ SKIPPED</span>}
                  </div>
                </div>

                {/* Move to top / bottom */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
                  <button
                    onClick={() => moveToTop(q.quest_id)}
                    title="Move to top"
                    disabled={idx === 0}
                    style={{
                      background: 'none', border: 'none', padding: '1px 4px', cursor: idx === 0 ? 'default' : 'pointer',
                      fontSize: 10, lineHeight: 1, color: idx === 0 ? 'var(--brd2)' : 'var(--txd)',
                      transition: 'color .15s',
                    }}>▲</button>
                  <button
                    onClick={() => moveToBottom(q.quest_id)}
                    title="Move to bottom"
                    disabled={idx === orderedFiltered.length - 1}
                    style={{
                      background: 'none', border: 'none', padding: '1px 4px', cursor: idx === orderedFiltered.length - 1 ? 'default' : 'pointer',
                      fontSize: 10, lineHeight: 1, color: idx === orderedFiltered.length - 1 ? 'var(--brd2)' : 'var(--txd)',
                      transition: 'color .15s',
                    }}>▼</button>
                </div>

                {/* Done + Skip actions */}
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button
                    onClick={() => onRemove(q.quest_id)}
                    title="Mark as done — removes from your list"
                    style={{
                      background: 'none', border: '1px solid var(--brd2)', borderRadius: 3,
                      padding: '2px 7px', cursor: 'pointer', fontSize: 10, fontFamily: 'Share Tech Mono',
                      color: 'var(--grn)', letterSpacing: '.04em',
                    }}>✓ DONE</button>
                  <button
                    onClick={() => onToggleSkipped(q.quest_id)}
                    title={q.skipped ? 'Un-skip' : 'Skip — will be pre-skipped in party UI'}
                    style={{
                      background: 'none', border: '1px solid var(--brd2)', borderRadius: 3,
                      padding: '2px 7px', cursor: 'pointer', fontSize: 10, fontFamily: 'Share Tech Mono',
                      color: q.skipped ? 'var(--gold)' : 'var(--txd)', letterSpacing: '.04em',
                    }}>{q.skipped ? 'UNSKIP' : '⊘ SKIP'}</button>
                </div>

                {/* Remove */}
                <button
                  onClick={() => onRemove(q.quest_id)}
                  style={{ background: 'none', border: 'none', color: 'var(--txd)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0, flexShrink: 0 }}
                  title="Remove from saved list">×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mono" style={{ marginTop: 16, fontSize: 10, color: 'var(--txd)', textAlign: 'center', lineHeight: 1.6 }}>
        ★ STARRED QUESTS WILL BE AUTO-STARRED IN THE PARTY TODO LIST<br />
        QUESTS ARE AUTO-LOADED WHEN YOU JOIN OR CREATE A PARTY
      </div>
    </div>
  )
}
