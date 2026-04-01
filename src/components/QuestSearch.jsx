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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {mine.map(item => (
          <div key={item.id} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px',
            background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 4, fontSize: 12,
          }}>
            <span style={{ color: 'var(--goldtx)' }}>{item.name}</span>
            <button onMouseDown={() => onRemove(item.id)}
              style={{ background: 'none', border: 'none', color: 'var(--txm)', padding: '0 0 0 3px', fontSize: 16, lineHeight: 1, cursor: 'pointer' }}>×</button>
          </div>
        ))}
        {mine.length === 0 && !loading && (
          <p className="mono" style={{ fontSize: 11, color: 'var(--txd)' }}>TYPE TO SEARCH AND ADD YOUR ACTIVE QUESTS</p>
        )}
      </div>
    </div>
  )
}
