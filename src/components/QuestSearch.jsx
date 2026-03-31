import { useState, useRef } from 'react'

export default function QuestSearch({ tasks, mine, onAdd, onRemove, loading }) {
  const [q, setQ]       = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef()

  const hits = q.length >= 1
    ? tasks.filter(t => t.name.toLowerCase().includes(q.toLowerCase()) && !mine.find(x => x.id === t.id)).slice(0, 14)
    : []

  return (
    <div style={{ position: 'relative' }}>
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <div style={{ width: 14, height: 14, border: '1px solid var(--brd2)', borderTop: '1px solid var(--gold)', borderRadius: '50%', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
          <span className="mono" style={{ fontSize: 10, color: 'var(--txm)' }}>FETCHING QUEST DATA FROM TARKOV.DEV...</span>
        </div>
      ) : (
        <input
          ref={ref}
          placeholder="Search quests for this map..."
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 160)}
        />
      )}

      {open && hits.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0, zIndex: 200,
          background: 'var(--sur3)', border: '1px solid var(--brd2)', borderRadius: 2,
          maxHeight: 300, overflowY: 'auto',
        }}>
          {hits.map(t => (
            <div key={t.id}
              onMouseDown={() => { onAdd({ id: t.id, name: t.name }); setQ(''); ref.current?.focus() }}
              style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--brd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--sur)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div>
                <div style={{ fontSize: 12, color: 'var(--tx)' }}>{t.name}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--txm)', marginTop: 2 }}>
                  {t.trader?.name} · lv.{t.minPlayerLevel || 1}
                  {!t.map && <span style={{ marginLeft: 8, color: 'var(--txd)' }}>any map</span>}
                </div>
              </div>
              <span style={{ color: 'var(--gold)', fontSize: 16, flexShrink: 0, marginLeft: 8 }}>+</span>
            </div>
          ))}
        </div>
      )}

      {open && q.length >= 1 && hits.length === 0 && !loading && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0, zIndex: 200,
          background: 'var(--sur3)', border: '1px solid var(--brd2)', borderRadius: 2,
          padding: '10px 12px',
        }}>
          <span className="mono" style={{ fontSize: 10, color: 'var(--txm)' }}>NO RESULTS FOR "{q.toUpperCase()}"</span>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
        {mine.map(item => (
          <div key={item.id} style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px',
            background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 2, fontSize: 11,
          }}>
            <span style={{ color: 'var(--tx)', fontFamily: 'Share Tech Mono, monospace' }}>{item.name}</span>
            <button onMouseDown={() => onRemove(item.id)}
              style={{ background: 'none', border: 'none', color: 'var(--txm)', padding: '0 0 0 3px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}>×</button>
          </div>
        ))}
        {mine.length === 0 && !loading && (
          <p className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>TYPE TO SEARCH AND ADD YOUR ACTIVE QUESTS</p>
        )}
      </div>
    </div>
  )
}
