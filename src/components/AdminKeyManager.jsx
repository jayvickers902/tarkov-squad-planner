import { useState, useRef } from 'react'
import { FEATURED, MAP_IMAGES } from '../constants'
import { useKeys } from '../useTarkov'
import { useMapKeys } from '../useMapKeys'
import { useIsMobile } from '../useIsMobile'

const MAP_LABELS = {
  'customs': 'Customs', 'woods': 'Woods', 'interchange': 'Interchange',
  'shoreline': 'Shoreline', 'factory': 'Factory', 'lighthouse': 'Lighthouse',
  'streets-of-tarkov': 'Streets of Tarkov', 'reserve': 'Reserve',
  'ground-zero': 'Ground Zero', 'the-lab': 'The Lab',
}

export default function AdminKeyManager({ onBack }) {
  const [mapNorm, setMapNorm]       = useState('customs')
  const [placing, setPlacing]       = useState(null)   // key name being placed on map
  const [saving, setSaving]         = useState(null)   // key name currently saving
  const [feedback, setFeedback]     = useState('')
  const imgRef = useRef(null)

  const isMobile = useIsMobile()
  const { keys, loading: keysLoading } = useKeys(mapNorm)
  const { mapKeys, upsertKey }         = useMapKeys(mapNorm)

  function flash(msg) { setFeedback(msg); setTimeout(() => setFeedback(''), 2000) }

  async function togglePriority(keyName) {
    const current = mapKeys[keyName]
    const newPriority = !(current?.priority ?? false)
    setSaving(keyName)
    const { error } = await upsertKey(mapNorm, keyName, newPriority, current?.loc_x, current?.loc_y)
    setSaving(null)
    if (error) flash('Save failed: ' + error.message)
    else flash(newPriority ? `★ ${keyName} marked priority` : `${keyName} unmarked`)
  }

  async function handleMapClick(e) {
    if (!placing) return
    const rect = imgRef.current.getBoundingClientRect()
    const loc_x = (e.clientX - rect.left) / rect.width
    const loc_y = (e.clientY - rect.top) / rect.height
    const current = mapKeys[placing]
    setSaving(placing)
    const { error } = await upsertKey(mapNorm, placing, current?.priority ?? false, loc_x, loc_y)
    setSaving(null)
    if (error) flash('Save failed: ' + error.message)
    else { flash(`📍 Location set for ${placing}`); setPlacing(null) }
  }

  async function clearLocation(keyName) {
    const current = mapKeys[keyName]
    if (!current?.loc_x && !current?.loc_y) return
    setSaving(keyName)
    const { error } = await upsertKey(mapNorm, keyName, current?.priority ?? false, null, null)
    setSaving(null)
    if (error) flash('Save failed: ' + error.message)
    else flash(`Location cleared for ${keyName}`)
  }

  const imgSrc = MAP_IMAGES[mapNorm]
  const located = Object.entries(mapKeys).filter(([, v]) => v.loc_x != null && v.loc_y != null)

  return (
    <div style={{ minHeight: '100vh', padding: '14px 16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid var(--brd)' }}>
        <button className="btn-ghost btn-sm" onClick={onBack}>← BACK</button>
        <div style={{ width: 4, height: 26, background: 'var(--gold)', borderRadius: 2 }} />
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>KEY ADMIN</h1>
          <div className="mono" style={{ fontSize: 11, color: 'var(--txm)' }}>// PRIORITY + LOCATION MANAGER</div>
        </div>
        {feedback && (
          <div className="mono" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--gold)', background: 'var(--sur2)', border: '1px solid var(--golddim)', borderRadius: 4, padding: '4px 10px' }}>
            {feedback}
          </div>
        )}
      </div>

      {/* Map selector */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
        {FEATURED.map(m => (
          <button key={m}
            onClick={() => { setMapNorm(m); setPlacing(null) }}
            className={mapNorm === m ? 'btn-gold' : 'btn-ghost'}
            style={{ padding: '5px 12px', fontSize: 12 }}>
            {MAP_LABELS[m]}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '320px 1fr', gap: 16, alignItems: 'start' }}>

        {/* Key list */}
        <div className="card" style={{ padding: 14, maxHeight: '80vh', overflowY: 'auto' }}>
          <div className="lbl" style={{ marginBottom: 10 }}>
            {keys.length} KEYS — TOGGLE PRIORITY / CLICK TO PLACE
          </div>

          {keysLoading && (
            <div className="mono" style={{ fontSize: 12, color: 'var(--txm)', padding: 8 }}>LOADING...</div>
          )}

          {keys.map(k => {
            const db    = mapKeys[k.name] || {}
            const isPri = db.priority ?? false
            const hasLoc = db.loc_x != null && db.loc_y != null
            const isPlacing = placing === k.name
            const isSaving = saving === k.name

            return (
              <div key={k.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 8px', marginBottom: 3,
                background: isPlacing ? 'var(--sur3, rgba(201,168,76,0.08))' : isPri ? 'var(--sur2)' : 'transparent',
                border: `1px solid ${isPlacing ? 'var(--gold)' : isPri ? 'var(--golddim)' : 'var(--brd)'}`,
                borderRadius: 4,
                opacity: isSaving ? 0.5 : 1,
              }}>
                {/* Priority toggle */}
                <button
                  onClick={() => togglePriority(k.name)}
                  disabled={isSaving}
                  title={isPri ? 'Unmark priority' : 'Mark priority'}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    fontSize: 14, color: isPri ? 'var(--gold)' : 'var(--txd)',
                    flexShrink: 0, lineHeight: 1,
                  }}>
                  {isPri ? '★' : '☆'}
                </button>

                {/* Key name */}
                <span style={{ flex: 1, fontSize: 12, color: isPri ? 'var(--tx)' : 'var(--txm)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {k.name}
                </span>

                {/* Location indicator */}
                {hasLoc && !isPlacing && (
                  <button
                    onClick={() => clearLocation(k.name)}
                    disabled={isSaving}
                    title="Clear location"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11, color: 'var(--grn, #5de87a)', flexShrink: 0 }}>
                    📍
                  </button>
                )}

                {/* Place button */}
                <button
                  onClick={() => setPlacing(isPlacing ? null : k.name)}
                  disabled={isSaving}
                  className={isPlacing ? 'btn-gold' : 'btn-ghost'}
                  style={{ padding: '2px 7px', fontSize: 10, flexShrink: 0 }}>
                  {isPlacing ? 'CANCEL' : 'PLACE'}
                </button>
              </div>
            )
          })}
        </div>

        {/* Map with click-to-place */}
        <div className="card" style={{ padding: 14 }}>
          {placing && (
            <div className="mono" style={{
              marginBottom: 10, padding: '8px 12px',
              background: 'rgba(201,168,76,0.1)', border: '1px solid var(--gold)', borderRadius: 4,
              fontSize: 12, color: 'var(--gold)',
            }}>
              CLICK MAP TO PLACE: {placing}
            </div>
          )}
          {!placing && (
            <div className="mono" style={{ marginBottom: 10, fontSize: 11, color: 'var(--txd)' }}>
              SELECT A KEY FROM THE LIST AND CLICK PLACE, THEN CLICK THE MAP
            </div>
          )}

          <div style={{
            position: 'relative', width: '100%', lineHeight: 0,
            borderRadius: 4, overflow: 'hidden',
            cursor: placing ? 'crosshair' : 'default',
          }}>
            {imgSrc
              ? <img ref={imgRef} src={imgSrc} alt={mapNorm} draggable={false}
                  onClick={handleMapClick}
                  style={{ width: '100%', display: 'block', userSelect: 'none', opacity: placing ? 0.85 : 1 }} />
              : <div style={{ width: '100%', paddingBottom: '66%', background: 'var(--sur)' }} />
            }

            {/* Existing location markers */}
            {located.map(([keyName, v]) => (
              <div key={keyName} style={{
                position: 'absolute',
                left: `${v.loc_x * 100}%`,
                top: `${v.loc_y * 100}%`,
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))',
              }}>
                <svg width="27" height="27" viewBox="0 0 24 24" fill={v.priority ? '#c9a84c' : '#6a9aaa'}>
                  <path stroke="black" strokeWidth="1.2" strokeLinejoin="round" d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
                </svg>
              </div>
            ))}
          </div>

          <div className="mono" style={{ marginTop: 8, fontSize: 10, color: 'var(--txd)' }}>
            {located.length} KEY{located.length !== 1 ? 'S' : ''} PLACED ON THIS MAP
            {' — '}
            <span style={{ color: 'var(--gold)' }}>● PRIORITY</span>
            {'  '}
            <span style={{ color: '#6a9aaa' }}>● STANDARD</span>
          </div>
        </div>
      </div>
    </div>
  )
}
