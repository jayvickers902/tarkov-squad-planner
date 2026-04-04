import { useState, useRef } from 'react'

const TYPE_LABEL = { location: 'LOCATE', item: 'FIND', mark: 'MARK', shoot: 'KILL', extract: 'EXTRACT', skill: 'SKILL' }

function QuestTooltip({ task, anchor }) {
  if (!task || !anchor) return null
  const objs = (task.objectives || []).filter(o => !o.optional)
  if (!objs.length) return null

  const spaceBelow = window.innerHeight - anchor.bottom
  const showAbove  = spaceBelow < 220 && anchor.top > 220

  return (
    <div style={{
      position: 'fixed',
      left: Math.min(anchor.left, window.innerWidth - 320),
      ...(showAbove ? { bottom: window.innerHeight - anchor.top + 4 } : { top: anchor.bottom + 4 }),
      width: 300,
      background: 'rgba(6,16,10,0.98)',
      border: '1px solid var(--brd2)',
      borderRadius: 5,
      padding: '8px 10px',
      zIndex: 300,
      pointerEvents: 'none',
      boxShadow: '0 4px 20px rgba(0,0,0,0.7)',
    }}>
      <div className="mono" style={{ fontSize: 10, color: 'var(--gold)', marginBottom: 6, letterSpacing: '.06em' }}>
        {task.name.toUpperCase()}
      </div>
      {objs.map(obj => (
        <div key={obj.id} style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '4px 0', borderBottom: '1px solid var(--brd)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--tx)', flex: 1, lineHeight: 1.4 }}>{obj.description}</span>
          <span className="mono" style={{
            fontSize: 9, color: 'var(--txd)', flexShrink: 0, marginTop: 2,
            background: 'var(--sur)', border: '1px solid var(--brd)',
            borderRadius: 2, padding: '1px 4px', letterSpacing: '.04em',
          }}>{TYPE_LABEL[obj.type] || obj.type?.toUpperCase() || '?'}</span>
        </div>
      ))}
    </div>
  )
}

export default function QuestSearch({ tasks, mine, completedQuests = {}, onAdd, onRemove, loading }) {
  const [q, setQ]           = useState('')
  const [open, setOpen]     = useState(false)
  const [tooltip, setTooltip] = useState(null)  // { task, anchor }
  const ref = useRef()

  const activeQuests    = mine.filter(item => !completedQuests[item.id])
  const completedActive = mine.filter(item => completedQuests[item.id])

  const hits = q.length >= 1
    ? tasks.filter(t => t.name.toLowerCase().includes(q.toLowerCase()) && !mine.find(x => x.id === t.id)).slice(0, 14)
    : []

  function showTooltip(e, itemId) {
    const task = tasks.find(t => t.id === itemId)
    if (!task) return
    setTooltip({ task, anchor: e.currentTarget.getBoundingClientRect() })
  }

  return (
    <div style={{ position: 'relative' }}>
      <QuestTooltip task={tooltip?.task} anchor={tooltip?.anchor} />

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <div style={{ width: 16, height: 16, border: '2px solid var(--brd2)', borderTop: '2px solid var(--gold)', borderRadius: '50%', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
          <span className="mono" style={{ fontSize: 12, color: 'var(--txm)' }}>FETCHING QUESTS FROM TARKOV.DEV...</span>
        </div>
      ) : (
        <input ref={ref} placeholder="Search quests for this map..."
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 160)} />
      )}

      {open && hits.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
          background: 'var(--sur3)', border: '1px solid var(--brd2)', borderRadius: 5,
          maxHeight: 320, overflowY: 'auto',
        }}>
          {hits.map(t => (
            <div key={t.id}
              onMouseDown={() => { onAdd({ id: t.id, name: t.name }); setQ(''); ref.current?.focus() }}
              style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid var(--brd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--sur)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div>
                <div style={{ fontSize: 13 }}>{t.name}</div>
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

      {open && q.length >= 1 && hits.length === 0 && !loading && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
          background: 'var(--sur3)', border: '1px solid var(--brd2)', borderRadius: 5,
          padding: '12px', fontSize: 12, color: 'var(--txm)',
        }} className="mono">
          NO RESULTS FOR "{q.toUpperCase()}"
        </div>
      )}

      {/* Active quests */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {activeQuests.map(item => (
          <div key={item.id}
            onMouseEnter={e => showTooltip(e, item.id)}
            onMouseLeave={() => setTooltip(null)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px',
              background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 4, fontSize: 12,
              cursor: 'default',
            }}>
            <span style={{ color: 'var(--goldtx)' }}>{item.name}</span>
            <button onMouseDown={() => onRemove(item.id)}
              style={{ background: 'none', border: 'none', color: 'var(--txm)', padding: '0 0 0 3px', fontSize: 16, lineHeight: 1, cursor: 'pointer' }}>×</button>
          </div>
        ))}
        {activeQuests.length === 0 && !loading && (
          <p className="mono" style={{ fontSize: 11, color: 'var(--txd)' }}>TYPE TO SEARCH AND ADD YOUR ACTIVE QUESTS</p>
        )}
      </div>

      {/* Completed quests */}
      {completedActive.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="mono" style={{ fontSize: 9, color: 'var(--grn)', letterSpacing: '.1em', marginBottom: 6 }}>
            ✓ COMPLETED THIS RAID
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {completedActive.map(item => (
              <div key={item.id}
                onMouseEnter={e => showTooltip(e, item.id)}
                onMouseLeave={() => setTooltip(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px',
                  background: 'var(--sur2)', border: '1px solid var(--brd)', borderRadius: 4, fontSize: 12,
                  opacity: 0.5, cursor: 'default',
                }}>
                <span style={{ color: 'var(--grn)', fontSize: 10 }}>✓</span>
                <span style={{ color: 'var(--txm)', textDecoration: 'line-through' }}>{item.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
