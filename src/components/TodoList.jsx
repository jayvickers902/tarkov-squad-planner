import { useState, useMemo } from 'react'

const TYPE_LABEL = { location: 'LOCATE', item: 'FIND', mark: 'MARK', shoot: 'KILL', extract: 'EXTRACT', skill: 'SKILL' }

const MEMBER_COLORS = [
  { bg: '#1a2e3a', border: '#1e5a7a', text: '#5aace8' },
  { bg: '#2a1a2e', border: '#5a1e7a', text: '#b85ae8' },
  { bg: '#2e1a1a', border: '#7a1e1e', text: '#e85a5a' },
  { bg: '#1a2e1a', border: '#1e7a1e', text: '#5ae85a' },
  { bg: '#2e2a1a', border: '#7a6a1e', text: '#e8c85a' },
  { bg: '#1a2a2e', border: '#1e6a7a', text: '#5ad8e8' },
]

function memberColor(name, allMembers) {
  const idx = allMembers.indexOf(name) % MEMBER_COLORS.length
  return MEMBER_COLORS[Math.max(0, idx)]
}

function MemberPill({ name, allMembers }) {
  const c = memberColor(name, allMembers)
  return (
    <span className="mono" style={{
      fontSize: 10, padding: '2px 6px', borderRadius: 3,
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      flexShrink: 0, letterSpacing: '.04em',
    }}>
      {name.slice(0, 8).toUpperCase()}
    </span>
  )
}

export default function TodoList({ tasks, memberQuests, progress, onToggleObjective, onToggleStar, onToggleComplete, starredQuests, completedQuests, myName, isLeader }) {
  const [filter, setFilter]     = useState('all')
  const [kappaOnly, setKappaOnly] = useState(false)
  const [expanded, setExpanded] = useState({})
  const [skipped, setSkipped]   = useState(new Set())
  const members = Object.keys(memberQuests)

  function toggleSkip(questId) {
    setSkipped(prev => {
      const next = new Set(prev)
      next.has(questId) ? next.delete(questId) : next.add(questId)
      return next
    })
  }

  const questRows = useMemo(() => {
    const ids = [...new Set(Object.values(memberQuests).flat().map(q => q.id))]
    return tasks
      .filter(t => ids.includes(t.id))
      .map(task => {
        const owners    = Object.entries(memberQuests).filter(([, qs]) => qs.find(q => q.id === task.id)).map(([n]) => n)
        const objs      = (task.objectives || []).filter(o => !o.optional)
        const doneCount = objs.filter(o => progress?.[`${task.id}::${o.id}`]).length
        const starred   = starredQuests?.[task.id] || false
        const allDone   = objs.length > 0 && doneCount === objs.length
        const completed = completedQuests?.[task.id] || false
        const canAct    = owners.includes(myName)
        return { task, owners, objs, doneCount, starred, allDone, completed, canAct }
      })
  }, [tasks, memberQuests, progress, starredQuests, completedQuests, myName])

  // Split into active, skipped, completed
  const activeRows    = questRows.filter(r => !r.completed && !skipped.has(r.task.id))
  const skippedRows   = questRows.filter(r => !r.completed && skipped.has(r.task.id))
  const completedRows = questRows.filter(r => r.completed)

  function applyFilter(rows) {
    return rows.filter(row => {
      if (kappaOnly && !row.task.kappaRequired) return false
      if (filter === 'starred') return row.starred
      if (members.includes(filter)) return row.owners.includes(filter)
      return true
    })
  }

  const filteredActive    = applyFilter(activeRows)
  const filteredSkipped   = applyFilter(skippedRows)
  const filteredCompleted = applyFilter(completedRows)

  const totalObjs = activeRows.reduce((s, r) => s + r.objs.length, 0)
  const doneObjs  = activeRows.reduce((s, r) => s + r.doneCount, 0)
  const pctDone   = totalObjs ? Math.round((doneObjs / totalObjs) * 100) : 0

  if (!questRows.length) return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div className="mono" style={{ fontSize: 12, color: 'var(--txd)', letterSpacing: '.1em' }}>NO QUESTS SELECTED</div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--txd)', marginTop: 8 }}>ADD QUESTS IN THE QUESTS TAB TO BUILD YOUR TODO LIST</div>
    </div>
  )

  function QuestCard({ task, owners, objs, doneCount, starred, allDone, completed, canAct, dimmed }) {
    const isOpen = expanded[task.id]
    const pct    = objs.length ? (doneCount / objs.length) * 100 : 0

    return (
      <div style={{
        background: 'var(--sur2)',
        border: `1px solid ${starred && !allDone && !completed && !dimmed ? 'var(--golddim)' : 'var(--brd)'}`,
        borderLeft: `3px solid ${completed || allDone ? 'var(--grn)' : dimmed ? 'var(--brd)' : starred ? 'var(--gold)' : 'var(--brd)'}`,
        borderRadius: 4,
        opacity: completed || allDone || dimmed ? .4 : 1,
        transition: 'opacity .2s, border-color .15s',
      }}>

        {/* Quest header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', cursor: 'pointer' }}
          onClick={() => setExpanded(e => ({ ...e, [task.id]: !e[task.id] }))}>


          {/* Star */}
          {canAct ? (
            <button
              onClick={e => { e.stopPropagation(); onToggleStar(task.id) }}
              title="Star — pins to top for everyone"
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0,
                fontSize: 14, lineHeight: 1,
                color: starred ? 'var(--gold)' : 'var(--txd)',
                transition: 'color .15s',
              }}>★</button>
          ) : (
            starred
              ? <span style={{ fontSize: 14, color: 'var(--golddim)', flexShrink: 0, lineHeight: 1 }}>★</span>
              : <span style={{ width: 14, flexShrink: 0 }} />
          )}

          {/* Quest name + owners */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                fontSize: 13, fontFamily: 'Rajdhani, sans-serif', fontWeight: 600,
                color: completed || allDone || dimmed ? 'var(--txm)' : 'var(--tx)',
                textDecoration: completed || allDone ? 'line-through' : 'none',
                letterSpacing: '.03em',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{task.name}</div>
              {task.kappaRequired && (
                <span className="mono" title="Required for Kappa" style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                  background: 'rgba(201,168,76,0.15)', border: '1px solid var(--golddim)',
                  color: 'var(--gold)', letterSpacing: '.06em',
                }}>κ</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
              {owners.map(o => <MemberPill key={o} name={o} allMembers={members} />)}
              {task.trader && (
                <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>{task.trader.name}</span>
              )}
            </div>
          </div>

          {/* Action buttons — only for quest owner, not on completed/allDone */}
          {canAct && !completed && !allDone && (
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
              <button
                onClick={() => onToggleComplete(task.id)}
                title="Mark complete"
                style={{
                  background: 'none', border: '1px solid var(--brd2)', borderRadius: 3,
                  padding: '2px 7px', cursor: 'pointer', fontSize: 10, fontFamily: 'Share Tech Mono',
                  color: 'var(--grn)', letterSpacing: '.04em', transition: 'all .15s',
                }}>✓ DONE</button>
              <button
                onClick={() => toggleSkip(task.id)}
                title={dimmed ? 'Un-skip' : 'Skip for now'}
                style={{
                  background: 'none', border: '1px solid var(--brd2)', borderRadius: 3,
                  padding: '2px 7px', cursor: 'pointer', fontSize: 10, fontFamily: 'Share Tech Mono',
                  color: dimmed ? 'var(--gold)' : 'var(--txd)', letterSpacing: '.04em', transition: 'all .15s',
                }}>{dimmed ? 'UNSKIP' : '⊘ SKIP'}</button>
            </div>
          )}

          {/* Un-complete button for completed quests */}
          {canAct && completed && (
            <div style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>
              <button
                onClick={() => onToggleComplete(task.id)}
                title="Mark incomplete"
                style={{
                  background: 'none', border: '1px solid var(--brd2)', borderRadius: 3,
                  padding: '2px 7px', cursor: 'pointer', fontSize: 10, fontFamily: 'Share Tech Mono',
                  color: 'var(--txd)', letterSpacing: '.04em',
                }}>UNDO</button>
            </div>
          )}

          {/* Progress */}
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="mono" style={{ fontSize: 12, color: completed || allDone ? 'var(--grn)' : 'var(--txm)' }}>
              {doneCount}/{objs.length}
            </div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--txd)' }}>
              {completed || allDone ? 'DONE' : `${Math.round(pct)}%`}
            </div>
          </div>

          <div className="mono" style={{ color: 'var(--txd)', fontSize: 10, flexShrink: 0 }}>
            {isOpen ? '▲' : '▼'}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 2, background: 'var(--brd)' }}>
          <div style={{
            height: '100%', width: `${pct}%`,
            background: completed || allDone ? 'var(--grn)' : 'var(--gold)',
            transition: 'width .3s',
          }} />
        </div>

        {/* Expanded objectives */}
        {isOpen && (
          <div style={{ padding: '6px 10px 10px' }} className="fade-in">
            <div style={{ marginBottom: 6, paddingBottom: 5, borderBottom: '1px solid var(--brd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="mono" style={{ fontSize: 9, color: 'var(--txd)', letterSpacing: '.1em' }}>OBJECTIVES</div>
              {!isLeader && (
                <div className="mono" style={{ fontSize: 9, color: 'var(--txd)' }}>⊘ ONLY LEADER CAN CHECK OFF</div>
              )}
            </div>
            {objs.map(obj => {
              const key    = `${task.id}::${obj.id}`
              const isDone = progress?.[key] || false
              return (
                <div key={obj.id}
                  onClick={() => isLeader && onToggleObjective(key)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 9,
                    padding: '6px 0', borderBottom: '1px solid var(--brd)',
                    cursor: isLeader ? 'pointer' : 'default',
                  }}
                  onMouseEnter={e => { if (isLeader) e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{
                    width: 14, height: 14, flexShrink: 0, marginTop: 1,
                    border: `1px solid ${isDone ? 'var(--grn)' : isLeader ? 'var(--brd2)' : 'var(--txd)'}`,
                    borderRadius: 3,
                    background: isDone ? 'var(--grn)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all .15s',
                    opacity: isLeader ? 1 : .6,
                  }}>
                    {isDone && <div style={{ width: 6, height: 6, background: 'var(--bg)', borderRadius: 1 }} />}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12,
                      color: isDone ? 'var(--txd)' : 'var(--tx)',
                      textDecoration: isDone ? 'line-through' : 'none',
                      lineHeight: 1.4,
                    }}>{obj.description}</div>
                  </div>

                  <span className="mono" style={{
                    fontSize: 9, flexShrink: 0, marginTop: 2, letterSpacing: '.06em',
                    color: isDone ? 'var(--txd)' : 'var(--txm)',
                    background: 'var(--sur)', border: '1px solid var(--brd)',
                    borderRadius: 2, padding: '1px 5px',
                  }}>
                    {TYPE_LABEL[obj.type] || obj.type?.toUpperCase() || '?'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Header + overall progress */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <h3 style={{ fontSize: 18, color: 'var(--goldtx)' }}>RAID OBJECTIVES</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--txm)' }}>
              {doneObjs}/{totalObjs} DONE · {pctDone}%
            </span>
            {!isLeader && (
              <span className="mono" style={{ fontSize: 10, color: 'var(--txd)', background: 'var(--sur)', border: '1px solid var(--brd)', borderRadius: 3, padding: '2px 7px' }}>
                ⊘ LEADER MARKS COMPLETE
              </span>
            )}
          </div>
        </div>
        <div style={{ height: 3, background: 'var(--brd)', borderRadius: 2 }}>
          <div style={{
            height: '100%', width: `${pctDone}%`,
            background: pctDone === 100 ? 'var(--grn)' : 'var(--gold)',
            borderRadius: 2, transition: 'width .4s',
          }} />
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setFilter('all')} className={filter === 'all' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}>ALL</button>
        <button onClick={() => setFilter('starred')}
          className={filter === 'starred' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
          style={{ color: filter !== 'starred' ? 'var(--gold)' : undefined }}>
          ★ STARRED
        </button>
        <button
          onClick={() => setKappaOnly(v => !v)}
          className={kappaOnly ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
          style={{ color: !kappaOnly ? 'var(--gold)' : undefined }}
          title="Show only Kappa-required quests">
          κ KAPPA
        </button>
        {members.map(m => {
          const c = memberColor(m, members)
          const active = filter === m
          return (
            <button key={m} onClick={() => setFilter(m)} style={{
              padding: '5px 10px', fontSize: 12, borderRadius: 4,
              background: active ? c.bg : 'transparent',
              border: `1px solid ${active ? c.border : 'var(--brd2)'}`,
              color: active ? c.text : 'var(--txm)',
              fontFamily: 'Share Tech Mono', letterSpacing: '.04em', transition: 'all .15s',
            }}>
              {m.slice(0, 10).toUpperCase()}
            </button>
          )
        })}
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--txd)' }}>
          {filteredActive.length + filteredSkipped.length} QUEST{filteredActive.length + filteredSkipped.length !== 1 ? 'S' : ''}
        </span>
      </div>

      {/* Active quest rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filteredActive.map(row => (
          <QuestCard key={row.task.id} {...row} dimmed={false} />
        ))}
      </div>

      {filteredActive.length === 0 && filteredSkipped.length === 0 && filteredCompleted.length === 0 && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--txd)' }}>NO QUESTS MATCH THIS FILTER</div>
        </div>
      )}

      {/* Skipped section */}
      {filteredSkipped.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--txd)', letterSpacing: '.1em', marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--brd)' }}>
            ⊘ SKIPPED ({filteredSkipped.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filteredSkipped.map(row => (
              <QuestCard key={row.task.id} {...row} dimmed={true} />
            ))}
          </div>
        </div>
      )}

      {/* Completed section */}
      {filteredCompleted.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--grn)', letterSpacing: '.1em', marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--brd)' }}>
            ✓ COMPLETED ({filteredCompleted.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filteredCompleted.map(row => (
              <QuestCard key={row.task.id} {...row} dimmed={false} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
