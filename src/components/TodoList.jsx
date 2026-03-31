import { useState, useMemo } from 'react'

const TYPE_ICON = { location: '◈', item: '◻', mark: '◎', shoot: '✕', extract: '▲', skill: '↑' }

export default function TodoList({ tasks, memberQuests, progress, onToggleObjective, onToggleStar, starredQuests }) {
  const [filter, setFilter]     = useState('all')
  const [expanded, setExpanded] = useState({})

  const members = Object.keys(memberQuests)

  // Build quest rows with owners and progress
  const questRows = useMemo(() => {
    const ids = [...new Set(Object.values(memberQuests).flat().map(q => q.id))]
    return tasks
      .filter(t => ids.includes(t.id))
      .map(task => {
        const owners = Object.entries(memberQuests)
          .filter(([, qs]) => qs.find(q => q.id === task.id))
          .map(([n]) => n)
        const objs = (task.objectives || []).filter(o => !o.optional)
        const doneCount = objs.filter(o => progress?.[`${task.id}::${o.id}`]).length
        const starred = starredQuests?.[task.id] || false
        return { task, owners, objs, doneCount, starred }
      })
      .sort((a, b) => {
        if (a.starred !== b.starred) return b.starred ? 1 : -1
        const aDone = a.doneCount === a.objs.length && a.objs.length > 0
        const bDone = b.doneCount === b.objs.length && b.objs.length > 0
        if (aDone !== bDone) return aDone ? 1 : -1
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

  function toggleExpand(id) {
    setExpanded(e => ({ ...e, [id]: !e[id] }))
  }

  if (!questRows.length) return (
    <div style={{ textAlign: 'center', padding: 40 }} className="mono">
      <div style={{ fontSize: 10, color: 'var(--txd)', letterSpacing: '.1em' }}>NO QUESTS SELECTED</div>
      <div style={{ fontSize: 10, color: 'var(--txd)', marginTop: 6, letterSpacing: '.08em' }}>ADD QUESTS IN THE QUESTS TAB</div>
    </div>
  )

  return (
    <div>
      {/* Header with overall progress */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="serif" style={{ fontSize: 18, color: '#fff' }}>Raid objectives</div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--txm)' }}>{doneObjs}/{totalObjs}</div>
      </div>

      {/* Overall progress bar */}
      <div style={{ height: 2, background: 'var(--brd2)', borderRadius: 1, marginBottom: 12 }}>
        <div style={{
          height: '100%',
          width: `${totalObjs ? (doneObjs / totalObjs) * 100 : 0}%`,
          background: doneObjs === totalObjs && totalObjs > 0 ? 'var(--grn)' : 'var(--gold)',
          borderRadius: 1, transition: 'width .4s',
        }} />
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {['all', 'starred', ...members].map(f => (
          <button key={f}
            onClick={() => setFilter(f)}
            className={filter === f ? 'btn-active btn-sm' : 'btn-ghost btn-sm'}
            style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>
            {f === 'starred' ? '★ STARRED' : f.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Quest rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.map(({ task, owners, objs, doneCount, starred }) => {
          const isExpanded = expanded[task.id]
          const pct = objs.length ? (doneCount / objs.length) * 100 : 0
          const allDone = doneCount === objs.length && objs.length > 0

          return (
            <div key={task.id} style={{
              border: `1px solid ${starred ? 'var(--golddim)' : 'var(--brd)'}`,
              borderRadius: 2,
              background: starred ? 'rgba(232,184,75,0.04)' : 'var(--sur)',
              opacity: allDone ? .45 : 1,
              transition: 'opacity .2s',
            }}>
              {/* Quest header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer' }}
                onClick={() => toggleExpand(task.id)}>

                {/* Star toggle */}
                <button
                  onClick={e => { e.stopPropagation(); onToggleStar(task.id) }}
                  style={{
                    background: 'none', border: 'none', padding: 0,
                    fontSize: 13, color: starred ? 'var(--gold)' : 'var(--txd)',
                    cursor: 'pointer', flexShrink: 0, lineHeight: 1,
                    transition: 'color .15s',
                  }}>★</button>

                {/* Quest name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="serif" style={{
                    fontSize: 13, color: allDone ? 'var(--txm)' : '#ccc',
                    textDecoration: allDone ? 'line-through' : 'none',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{task.name}</div>
                </div>

                {/* Owners */}
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {owners.map(o => (
                    <span key={o} className="mono" style={{
                      fontSize: 9, background: 'var(--golddim)', color: 'var(--gold)',
                      borderRadius: 2, padding: '1px 5px', letterSpacing: '.04em',
                    }}>{o.slice(0, 6).toUpperCase()}</span>
                  ))}
                </div>

                {/* Fraction */}
                <div className="mono" style={{ fontSize: 10, color: 'var(--txm)', flexShrink: 0, minWidth: 28, textAlign: 'right' }}>
                  {doneCount}/{objs.length}
                </div>

                {/* Expand chevron */}
                <div style={{ color: 'var(--txd)', fontSize: 10, flexShrink: 0 }}>
                  {isExpanded ? '▲' : '▼'}
                </div>
              </div>

              {/* Thin progress bar */}
              <div style={{ height: 2, background: 'var(--brd)' }}>
                <div style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: allDone ? 'var(--grn)' : 'var(--gold)',
                  transition: 'width .3s',
                }} />
              </div>

              {/* Expanded objectives */}
              {isExpanded && (
                <div style={{ padding: '6px 10px 8px' }} className="fade-in">
                  {objs.map(obj => {
                    const key = `${task.id}::${obj.id}`
                    const isDone = progress?.[key] || false
                    return (
                      <div key={obj.id}
                        onClick={() => onToggleObjective(key)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '5px 0', borderBottom: '1px solid var(--brd)',
                          cursor: 'pointer',
                        }}>

                        {/* Checkbox */}
                        <div style={{
                          width: 12, height: 12, border: `1px solid ${isDone ? 'var(--grn)' : 'var(--brd2)'}`,
                          borderRadius: 2, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: isDone ? 'var(--grn)' : 'transparent', transition: 'all .15s',
                        }}>
                          {isDone && <div style={{ width: 6, height: 6, background: '#0f0f0f', borderRadius: 1 }} />}
                        </div>

                        {/* Type icon */}
                        <span className="mono" style={{ fontSize: 10, color: 'var(--txm)', flexShrink: 0 }}>
                          {TYPE_ICON[obj.type] || '◆'}
                        </span>

                        {/* Description */}
                        <span style={{
                          fontSize: 11, color: isDone ? 'var(--txd)' : 'var(--txm)',
                          textDecoration: isDone ? 'line-through' : 'none',
                          flex: 1,
                        }}>{obj.description}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
