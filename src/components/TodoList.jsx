import { useState } from 'react'

const TYPE_ICON = { location: '◈', item: '◻', mark: '◎', shoot: '✕', extract: '▲', skill: '↑' }

export default function TodoList({ tasks, memberQuests }) {
  const [done, setDone] = useState({})

  const ids = [...new Set(Object.values(memberQuests).flat().map(q => q.id))]
  const relevant = tasks.filter(t => ids.includes(t.id))

  const rows = []
  relevant.forEach(task => {
    const owners = Object.entries(memberQuests)
      .filter(([, qs]) => qs.find(q => q.id === task.id))
      .map(([n]) => n)
    ;(task.objectives || []).filter(o => !o.optional).forEach(obj => {
      rows.push({ key: `${task.id}::${obj.id}`, obj, task, owners })
    })
  })

  if (!rows.length) return (
    <div style={{ textAlign: 'center', padding: 40, color: 'var(--txm)' }} className="mono">
      NO OBJECTIVES YET — ADD QUESTS FIRST
    </div>
  )

  const dc = rows.filter(r => done[r.key]).length

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 18, color: 'var(--goldtx)' }}>RAID OBJECTIVES</h3>
        <span className="mono" style={{ fontSize: 12, color: 'var(--txm)' }}>{dc}/{rows.length} DONE</span>
      </div>

      <div style={{ height: 3, background: 'var(--brd)', borderRadius: 2, marginBottom: 14 }}>
        <div style={{
          height: '100%',
          width: `${rows.length ? (dc / rows.length) * 100 : 0}%`,
          background: 'var(--gold)', borderRadius: 2, transition: 'width .3s',
        }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {rows.map(({ key, obj, task, owners }) => {
          const isDone = done[key]
          return (
            <div
              key={key}
              onClick={() => setDone(d => ({ ...d, [key]: !d[key] }))}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px',
                background: isDone ? 'var(--sur)' : 'var(--sur2)',
                border: '1px solid var(--brd)',
                borderLeft: `3px solid ${isDone ? 'var(--grn)' : 'var(--gold)'}`,
                borderRadius: 4, cursor: 'pointer', opacity: isDone ? .5 : 1, transition: 'all .15s',
              }}
            >
              <span style={{ color: 'var(--gold)', fontFamily: 'Share Tech Mono', fontSize: 13, marginTop: 1 }}>
                {TYPE_ICON[obj.type] || '◆'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, textDecoration: isDone ? 'line-through' : 'none', color: isDone ? 'var(--txm)' : 'var(--tx)' }}>
                  {obj.description}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                  <span style={{ display: 'inline-flex', background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 3, padding: '2px 7px', fontSize: 11, fontFamily: 'Share Tech Mono', color: 'var(--txm)' }}>
                    {task.name}
                  </span>
                  {owners.map(o => (
                    <span key={o} style={{ display: 'inline-flex', background: 'var(--sur2)', border: '1px solid var(--golddim)', borderRadius: 3, padding: '2px 7px', fontSize: 11, fontFamily: 'Share Tech Mono', color: 'var(--gold)' }}>
                      {o}
                    </span>
                  ))}
                </div>
              </div>
              <span style={{ fontSize: 15, color: isDone ? 'var(--grn)' : 'var(--txd)', flexShrink: 0 }}>
                {isDone ? '✓' : '○'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
