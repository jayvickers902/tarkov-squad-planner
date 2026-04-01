import { useState, useMemo } from 'react'

const TYPE_ICON  = { location: '◈', item: '◻', mark: '◎', shoot: '✕', extract: '▲', skill: '↑' }
const TYPE_LABEL = { location: 'LOCATE', item: 'FIND', mark: 'MARK', shoot: 'KILL', extract: 'EXTRACT', skill: 'SKILL' }

// Stable colour per member name so each person always has the same colour
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

function MemberPill({ name, allMembers, style = {} }) {
  const c = memberColor(name, allMembers)
  return (
    <span className="mono" style={{
      fontSize: 10, padding: '2px 6px', borderRadius: 3,
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      flexShrink: 0, letterSpacing: '.04em', ...style,
    }}>
      {name.slice(0, 8).toUpperCase()}
    </span>
  )
}

function Checkbox({ checked, onChange, size = 14 }) {
  return (
    <div onClick={onChange} style={{
      width: size, height: size, flexShrink: 0, cursor: 'pointer',
      border: `1px solid ${checked ? 'var(--grn)' : 'var(--brd2)'}`,
      borderRadius: 3, background: checked ? 'var(--grn)' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all .15s',
    }}>
      {checked && <div style={{ width: size * 0.45, height: size * 0.45, background: 'var(--bg)', borderRadius: 1 }} />}
    </div>
  )
}

export default function TodoList({ tasks, memberQuests, progress, onToggleObjective, onToggleStar, starredQuests }) {
  const [filter, setFilter]   = useState('all')
  const [expanded, setExpanded] = useState({})
  const members = Object.keys(memberQuests)

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
        return { task, owners, objs, doneCount, starred, allDone }
      })
      .sort((a, b) => {
        if (a.allDone !== b.allDone) return a.allDone ? 1 : -1
        if (a.starred !== b.starred) return a.starred ? -1 : 1
        return 0
      })
  }, [tasks, memberQuests, progress, starredQuests])

  const filtered = questRows.filter(row => {
    if (filter === 'starred') return row.starred
    if (members.includes(filter)) return row.owners.includes(filter)
    return true
  })

  const totalObjs = questRows.reduce((s, r) => s + r.objs.length, 0)
  const doneObjs  = questRows.reduce((s, r) => s + r.doneCount, 0)
  const pctDone   = totalObjs ? Math.round((doneObjs / totalObjs) * 100) : 0

  if (!questRows.length) return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div className="mono" style={{ fontSize: 12, color: 'var(--txd)', letterSpacing: '.1em' }}>NO QUESTS SELECTED</div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--txd)', marginTop: 8, letterSpacing: '.08em' }}>ADD QUESTS IN THE QUESTS TAB TO BUILD YOUR TODO LIST</div>
    </div>
  )

  return (
    <div>
      {/* ── Header + overall progress ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <h3 style={{ fontSize: 18, color: 'var(--goldtx)' }}>RAID OBJECTIVES</h3>
          <span className="mono" style={{ fontSize: 11, color: 'var(--txm)' }}>
            {doneObjs}/{totalObjs} DONE &nbsp;·&nbsp; {pctDone}%
          </span>
        </div>
        <div style={{ height: 3, background: 'var(--brd)', borderRadius: 2 }}>
          <div style={{
            height: '100%',
            width: `${pctDone}%`,
            background: pctDone === 100 ? 'var(--grn)' : 'var(--gold)',
            borderRadius: 2, transition: 'width .4s',
          }} />
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setFilter('all')}
          className={filter === 'all' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}>
          ALL
        </button>
        <button onClick={() => setFilter('starred')}
          className={filter === 'starred' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
          style={{ color: filter !== 'starred' ? 'var(--gold)' : undefined }}>
          ★ STARRED
        </button>
        {members.map(m => {
          const c = memberColor(m, members)
          const active = filter === m
          return (
            <button key={m} onClick={() => setFilter(m)}
              style={{
                padding: '5px 10px', fontSize: 12, borderRadius: 4,
                background: active ? c.bg : 'transparent',
                border: `1px solid ${active ? c.border : 'var(--brd2)'}`,
                color: active ? c.text : 'var(--txm)',
                fontFamily: 'Share Tech Mono', letterSpacing: '.04em',
                transition: 'all .15s',
              }}>
              {m.slice(0, 10).toUpperCase()}
            </button>
          )
        })}
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--txd)' }}>
          {filtered.length} QUEST{filtered.length !== 1 ? 'S' : ''}
        </span>
      </div>

      {/* ── Quest rows ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.map(({ task, owners, objs, doneCount, starred, allDone }) => {
          const isOpen = expanded[task.id]
          const pct    = objs.length ? (doneCount / objs.length) * 100 : 0

          return (
            <div key={task.id} style={{
              background: 'var(--sur2)',
              border: `1px solid ${starred && !allDone ? 'var(--golddim)' : 'var(--brd)'}`,
              borderLeft: `3px solid ${allDone ? 'var(--grn)' : starred ? 'var(--gold)' : 'var(--brd)'}`,
              borderRadius: 4,
              opacity: allDone ? .45 : 1,
              transition: 'opacity .2s, border-color .15s',
            }}>

              {/* Quest header — always visible */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', cursor: 'pointer' }}
                onClick={() => setExpanded(e => ({ ...e, [task.id]: !e[task.id] }))}>

                {/* Star */}
                <button onClick={e => { e.stopPropagation(); onToggleStar(task.id) }}
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0,
                    fontSize: 14, lineHeight: 1,
                    color: starred ? 'var(--gold)' : 'var(--txd)',
                    transition: 'color .15s',
                  }}>★</button>

                {/* Quest name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontFamily: 'Rajdhani, sans-serif', fontWeight: 600,
                    color: allDone ? 'var(--txm)' : 'var(--tx)',
                    textDecoration: allDone ? 'line-through' : 'none',
                    letterSpacing: '.03em',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{task.name}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                    {owners.map(o => <MemberPill key={o} name={o} allMembers={members} />)}
                    {task.trader && (
                      <span className="mono" style={{ fontSize: 10, color: 'var(--txd)', padding: '2px 0' }}>
                        {task.trader.name}
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress fraction */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="mono" style={{ fontSize: 12, color: allDone ? 'var(--grn)' : 'var(--txm)' }}>
                    {doneCount}/{objs.length}
                  </div>
                  <div className="mono" style={{ fontSize: 9, color: 'var(--txd)' }}>
                    {allDone ? 'DONE' : `${Math.round(pct)}%`}
                  </div>
                </div>

                {/* Expand toggle */}
                <div className="mono" style={{ color: 'var(--txd)', fontSize: 10, flexShrink: 0 }}>
                  {isOpen ? '▲' : '▼'}
                </div>
              </div>

              {/* Thin progress bar */}
              <div style={{ height: 2, background: 'var(--brd)', margin: '0 0 0 0' }}>
                <div style={{
                  height: '100%', width: `${pct}%`,
                  background: allDone ? 'var(--grn)' : 'var(--gold)',
                  transition: 'width .3s',
                }} />
              </div>

              {/* Expanded objectives */}
              {isOpen && (
                <div style={{ padding: '6px 10px 10px' }} className="fade-in">
                  <div style={{ marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid var(--brd)' }}>
                    <div className="mono" style={{ fontSize: 9, color: 'var(--txd)', letterSpacing: '.1em' }}>
                      OBJECTIVES
                    </div>
                  </div>
                  {objs.map(obj => {
                    const key    = `${task.id}::${obj.id}`
                    const isDone = progress?.[key] || false
                    return (
                      <div key={obj.id}
                        onClick={() => onToggleObjective(key)}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 9,
                          padding: '6px 0', borderBottom: '1px solid var(--brd)',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <Checkbox checked={isDone} onChange={() => onToggleObjective(key)} />

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
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--txd)' }}>
            NO QUESTS MATCH THIS FILTER
          </div>
        </div>
      )}
    </div>
  )
}
