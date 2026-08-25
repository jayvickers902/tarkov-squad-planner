import { useState, useRef, useMemo } from 'react'
import { FEATURED, MAP_IMAGES } from '../constants'
import { useKeys, useTasks } from '../useTarkov'
import { useMapKeys } from '../useMapKeys'
import { useMapLoot } from '../useMapLoot'
import { useIntel } from '../useIntel'
import { useIsMobile } from '../useIsMobile'
import { INTEL_KINDS, worldToNorm } from '../tarkovIntel'
import { useQuestShareOverrides } from '../useQuestShareOverrides'

// Season 1 "Kord Breach" document items. Upstream has these items but *no*
// coordinates for them on any map — 0 hits across all 17 maps in lootLoose and
// lootContainers — so every point in map_loot is placed by hand here. If that
// ever changes upstream, this editor becomes redundant rather than wrong.
const DOCUMENT_NAMES = [
  'Project documentation',
  'Blueprints and technical documentation',
  'Test documentation',
  'User documentation',
  'Medical documents',
  'Technical documentation',
  'Classified documents',
  'Financial documents',
  'Battle Pass Document',
]

const MAP_LABELS = {
  'customs': 'Customs', 'woods': 'Woods', 'interchange': 'Interchange',
  'shoreline': 'Shoreline', 'factory': 'Factory', 'lighthouse': 'Lighthouse',
  'streets-of-tarkov': 'Streets of Tarkov', 'reserve': 'Reserve',
  'ground-zero': 'Ground Zero', 'the-lab': 'The Lab',
  'icebreaker': 'Icebreaker', 'the-labyrinth': 'Labyrinth',
}

export default function AdminKeyManager({ onBack }) {
  const [mapNorm, setMapNorm]       = useState('customs')
  const [section, setSection]       = useState('keys')  // 'keys' | 'loot' | 'share'
  const [placing, setPlacing]       = useState(null)   // key name being placed on map
  const [saving, setSaving]         = useState(null)   // key name currently saving
  const [feedback, setFeedback]     = useState('')
  const [lootName, setLootName]     = useState(DOCUMENT_NAMES[0])
  const [lootNotes, setLootNotes]   = useState('')
  const [placingLoot, setPlacingLoot] = useState(false)
  const [showIntelRef, setShowIntelRef] = useState(true)
  const [overrideTaskId, setOverrideTaskId] = useState('')
  const [overrideTaskName, setOverrideTaskName] = useState('')
  const [overrideVerdict, setOverrideVerdict] = useState('solo')
  const [overrideNote, setOverrideNote] = useState('')
  const imgRef = useRef(null)

  const isMobile = useIsMobile()
  const { keys, loading: keysLoading } = useKeys(mapNorm)
  const { mapKeys, upsertKey }         = useMapKeys(mapNorm)
  const { lootRows, error: lootError, addLoot, removeLoot } = useMapLoot(mapNorm)
  const { intelPoints } = useIntel(mapNorm)
  const { tasks } = useTasks(null)
  const { overrides, loading: overridesLoading, upsertOverride } = useQuestShareOverrides()

  // The prebaked loose-loot points, projected back onto the flat map image, so a
  // hand-placed document can be put where the intel spawns already are instead
  // of somewhere plausible-looking.
  const intelRefMarks = useMemo(
    () => intelPoints.map(p => ({ id: p.id, ...worldToNorm(p.x, p.z, mapNorm) })).filter(m => m.nx != null),
    [intelPoints, mapNorm],
  )

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
    const rect = imgRef.current.getBoundingClientRect()
    const loc_x = (e.clientX - rect.left) / rect.width
    const loc_y = (e.clientY - rect.top) / rect.height

    if (section === 'loot') {
      if (!placingLoot || !lootName.trim()) return
      setSaving('__loot__')
      const { error } = await addLoot({
        mapNorm, lootName: lootName.trim(), lootType: 'document',
        locX: loc_x, locY: loc_y, notes: lootNotes.trim() || null,
      })
      setSaving(null)
      if (error) flash('Save failed: ' + error.message)
      // Placement stays armed: these go in runs of three or four per document.
      else flash(`📄 ${lootName} placed`)
      return
    }

    if (!placing) return
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

  function selectOverrideTask(taskId) {
    setOverrideTaskId(taskId)
    const task = tasks.find(entry => entry.id === taskId)
    const existing = overrides[taskId]
    setOverrideTaskName(existing?.task_name || task?.name || '')
    setOverrideVerdict(existing?.verdict || 'solo')
    setOverrideNote(existing?.note || '')
  }

  async function saveOverride() {
    const taskId = overrideTaskId.trim()
    if (!taskId) { flash('Task id is required'); return }
    const { error } = await upsertOverride({
      taskId,
      taskName: overrideTaskName.trim(),
      verdict: overrideVerdict,
      note: overrideNote.trim(),
    })
    flash(error ? 'Save failed: ' + error.message : `Override saved for ${overrideTaskName || taskId}`)
  }

  const imgSrc = MAP_IMAGES[mapNorm]
  const located = Object.entries(mapKeys).filter(([, v]) => v.loc_x != null && v.loc_y != null)
  const armed = section === 'loot' ? placingLoot : !!placing

  return (
    <div style={{ minHeight: '100vh', padding: '14px 16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid var(--brd)' }}>
        <button className="btn-ghost btn-sm" onClick={onBack}>← BACK</button>
        <div style={{ width: 4, height: 26, background: 'var(--gold)', borderRadius: 2 }} />
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>MAP DATA ADMIN</h1>
          <div className="mono" style={{ fontSize: 11, color: 'var(--txm)' }}>
            // {section === 'keys' ? 'KEY PRIORITY + LOCATION MANAGER' : 'HAND-PLACED DOCUMENT SPAWNS'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={section === 'keys' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
            onClick={() => { setSection('keys'); setPlacingLoot(false) }}>🔑 KEYS</button>
          <button className={section === 'loot' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
            onClick={() => { setSection('loot'); setPlacing(null) }}>📄 DOCUMENTS</button>
          <button className={section === 'share' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
            onClick={() => { setSection('share'); setPlacing(null); setPlacingLoot(false) }}>⚑ SHAREABILITY</button>
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
            onClick={() => { setMapNorm(m); setPlacing(null); setPlacingLoot(false) }}
            className={mapNorm === m ? 'btn-gold' : 'btn-ghost'}
            style={{ padding: '5px 12px', fontSize: 12 }}>
            {MAP_LABELS[m]}
          </button>
        ))}
      </div>

      {section === 'share' && (
        <div className="card" style={{ padding: 14, marginBottom: 16, maxWidth: 900 }}>
          <div className="lbl" style={{ marginBottom: 8 }}>QUEST SHAREABILITY OVERRIDES</div>
          <div className="mono" style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--txd)', marginBottom: 10 }}>
            CLASSIFICATION IS DERIVED FROM OBJECTIVE TYPES. USE THIS EDITOR FOR SOLO-ONLY CHAINS OR OTHER CURATED CORRECTIONS.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.5fr 1fr 150px', gap: 8, alignItems: 'end' }}>
            <label className="mono" style={{ fontSize: 10, color: 'var(--txm)' }}>
              TASK
              <select value={overrideTaskId} onChange={e => selectOverrideTask(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4, background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 3, color: 'var(--tx)', padding: 7 }}>
                <option value="">Select a task…</option>
                {tasks.map(task => <option key={task.id} value={task.id}>{task.name} · {task.id}</option>)}
              </select>
            </label>
            <label className="mono" style={{ fontSize: 10, color: 'var(--txm)' }}>
              VERDICT
              <select value={overrideVerdict} onChange={e => setOverrideVerdict(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4, background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 3, color: 'var(--tx)', padding: 7 }}>
                <option value="solo">SOLO</option><option value="partial">PARTIAL</option><option value="shared">SHARED</option>
              </select>
            </label>
            <button className="btn-gold" onClick={saveOverride} disabled={overridesLoading || !overrideTaskId}>SAVE OVERRIDE</button>
          </div>
          <input aria-label="Override task name" placeholder="Task name" value={overrideTaskName} onChange={e => setOverrideTaskName(e.target.value)} style={{ marginTop: 8 }} />
          <input aria-label="Override note" placeholder="Reason / source note" value={overrideNote} onChange={e => setOverrideNote(e.target.value)} style={{ marginTop: 8 }} />
          <div className="mono" style={{ fontSize: 10, color: 'var(--txd)', marginTop: 14, marginBottom: 6 }}>SAVED OVERRIDES ({Object.keys(overrides).length})</div>
          {Object.values(overrides).map(row => (
            <div key={row.task_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--brd)' }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{row.task_name || row.task_id}</span>
              <span className="mono" style={{ fontSize: 10, color: row.verdict === 'solo' ? 'var(--red)' : row.verdict === 'shared' ? 'var(--grn)' : 'var(--gold)' }}>{row.verdict.toUpperCase()}</span>
              <button className="btn-ghost btn-sm" onClick={() => selectOverrideTask(row.task_id)}>EDIT</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '320px 1fr', gap: 16, alignItems: 'start' }}>

        {/* Key list */}
        {section === 'keys' && (
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
        )}

        {/* Document list — curated map_loot rows for this map */}
        {section === 'loot' && (
        <div className="card" style={{ padding: 14, maxHeight: '80vh', overflowY: 'auto' }}>
          {lootError && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--red)', marginBottom: 10, lineHeight: 1.5 }}>
              ⚠ {lootError}
              <div style={{ color: 'var(--txd)', marginTop: 4 }}>
                RUN THE map_loot BLOCK IN supabase-schema.sql
              </div>
            </div>
          )}

          <div className="lbl" style={{ marginBottom: 8 }}>PLACE A DOCUMENT SPAWN</div>

          <select value={lootName} onChange={e => setLootName(e.target.value)}
            style={{ width: '100%', fontSize: 12, padding: '4px 6px', marginBottom: 6, background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 3, color: 'var(--tx)' }}>
            {DOCUMENT_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <input aria-label="Document spawn note" placeholder="Note (e.g. 3rd floor office desk)" value={lootNotes}
            onChange={e => setLootNotes(e.target.value)}
            style={{ width: '100%', fontSize: 12, marginBottom: 6 }} />
          <button
            className={placingLoot ? 'btn-gold' : 'btn-ghost'}
            onClick={() => setPlacingLoot(v => !v)}
            style={{ width: '100%', padding: '5px', fontSize: 11 }}>
            {placingLoot ? 'PLACING — CLICK MAP (CLICK HERE TO STOP)' : 'PLACE ON MAP'}
          </button>

          <div className="lbl" style={{ margin: '14px 0 8px' }}>
            {lootRows.length} PLACED ON {MAP_LABELS[mapNorm]?.toUpperCase()}
          </div>
          {lootRows.length === 0 && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--txd)' }}>— NONE YET</div>
          )}
          {lootRows.map(row => (
            <div key={row.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 8px', marginBottom: 3,
              background: 'var(--sur2)', border: '1px solid var(--brd)', borderRadius: 4,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.loot_name}
                </div>
                <div className="mono" style={{ fontSize: 9, color: 'var(--txd)' }}>
                  {row.notes ? `${row.notes} · ` : ''}
                  {row.loc_x?.toFixed(3)} / {row.loc_y?.toFixed(3)}
                </div>
              </div>
              <button className="btn-ghost btn-sm" style={{ fontSize: 10, color: 'var(--red)', flexShrink: 0 }}
                onClick={async () => {
                  const { error } = await removeLoot(row.id)
                  flash(error ? 'Delete failed: ' + error.message : `Removed ${row.loot_name}`)
                }}>
                ×
              </button>
            </div>
          ))}

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={showIntelRef} onChange={e => setShowIntelRef(e.target.checked)} style={{ width: 'auto' }} />
            <span className="mono" style={{ fontSize: 10, color: 'var(--txm)' }}>
              SHOW {intelRefMarks.length} PREBAKED INTEL SPAWNS FOR REFERENCE
            </span>
          </label>
        </div>
        )}

        {/* Map with click-to-place */}
        <div className="card" style={{ padding: 14 }}>
          {armed && (
            <div className="mono" style={{
              marginBottom: 10, padding: '8px 12px',
              background: 'rgba(201,168,76,0.1)', border: '1px solid var(--gold)', borderRadius: 4,
              fontSize: 12, color: 'var(--gold)',
            }}>
              CLICK MAP TO PLACE: {section === 'loot' ? lootName : placing}
            </div>
          )}
          {!armed && (
            <div className="mono" style={{ marginBottom: 10, fontSize: 11, color: 'var(--txd)' }}>
              {section === 'loot'
                ? 'PICK A DOCUMENT, CLICK PLACE ON MAP, THEN CLICK THE MAP — PLACEMENT STAYS ARMED'
                : 'SELECT A KEY FROM THE LIST AND CLICK PLACE, THEN CLICK THE MAP'}
            </div>
          )}

          <div style={{
            position: 'relative', width: '100%', lineHeight: 0,
            borderRadius: 4, overflow: 'hidden',
            cursor: armed ? 'crosshair' : 'default',
          }}>
            {imgSrc
              ? <img ref={imgRef} src={imgSrc} alt={mapNorm} draggable={false}
                  onClick={handleMapClick}
                  style={{ width: '100%', display: 'block', userSelect: 'none', opacity: armed ? 0.85 : 1 }} />
              : <div style={{ width: '100%', paddingBottom: '66%', background: 'var(--sur)' }} />
            }

            {/* Prebaked intel spawns, as placement reference only */}
            {section === 'loot' && showIntelRef && intelRefMarks.map(m => (
              <div key={m.id} style={{
                position: 'absolute', left: `${m.nx * 100}%`, top: `${m.ny * 100}%`,
                width: 6, height: 6, marginLeft: -3, marginTop: -3,
                borderRadius: '50%', background: 'rgba(106,154,170,0.75)',
                border: '1px solid rgba(0,0,0,0.7)', pointerEvents: 'none',
              }} />
            ))}

            {/* Curated document points */}
            {section === 'loot' && lootRows.filter(r => r.loc_x != null && r.loc_y != null).map(row => (
              <div key={row.id} title={row.loot_name} style={{
                position: 'absolute',
                left: `${row.loc_x * 100}%`,
                top: `${row.loc_y * 100}%`,
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))',
              }}>
                <svg width="20" height="20" viewBox="0 0 22 22">
                  <path d="M6 4.5 h7 l4 4 v9.5 a1 1 0 0 1 -1 1 h-10 a1 1 0 0 1 -1 -1 v-12.5 a1 1 0 0 1 1 -1 Z"
                    fill={INTEL_KINDS.document.color} stroke="rgba(0,0,0,0.85)" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
              </div>
            ))}

            {/* Existing location markers */}
            {section === 'keys' && located.map(([keyName, v]) => (
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
            {section === 'keys' ? (
              <>
                {located.length} KEY{located.length !== 1 ? 'S' : ''} PLACED ON THIS MAP
                {' — '}
                <span style={{ color: 'var(--gold)' }}>● PRIORITY</span>
                {'  '}
                <span style={{ color: '#6a9aaa' }}>● STANDARD</span>
              </>
            ) : (
              <>
                {lootRows.length} DOCUMENT SPAWN{lootRows.length !== 1 ? 'S' : ''} PLACED
                {' — '}
                <span style={{ color: INTEL_KINDS.document.color }}>▧ HAND-PLACED</span>
                {showIntelRef && intelRefMarks.length > 0 && (
                  <>{'  '}<span style={{ color: '#6a9aaa' }}>● PREBAKED INTEL (REFERENCE)</span></>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
