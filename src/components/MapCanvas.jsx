import { useRef, useEffect, useCallback, useState } from 'react'
import { MAP_IMAGES } from '../constants'
import { useMapKeys } from '../useMapKeys'



const USER_COLORS = ['#e85d5d', '#5db8e8', '#5de87a', '#f5a623', '#c45de8', '#5de8d4', '#e8e85d', '#e85da8']
const PALETTE = ['#e85d5d', '#f5a623', '#e8e85d', '#5de87a', '#5de8d4', '#5db8e8', '#c45de8', '#e85da8', '#ffffff', '#b0b0b0']

function getUserColor(user, memberNames) {
  const idx = memberNames.indexOf(user)
  return USER_COLORS[Math.max(idx, 0) % USER_COLORS.length]
}

function drawAllStrokes(canvas, drawings, memberNames) {
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ;(drawings || []).forEach(stroke => {
    if (!stroke.pts || stroke.pts.length < 2) return
    ctx.strokeStyle = stroke.color ?? getUserColor(stroke.user, memberNames)
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(stroke.pts[0][0] * canvas.width, stroke.pts[0][1] * canvas.height)
    for (let i = 1; i < stroke.pts.length; i++) {
      ctx.lineTo(stroke.pts[i][0] * canvas.width, stroke.pts[i][1] * canvas.height)
    }
    ctx.stroke()
  })
}

function QuestMarkerPin({ color, initial }) {
  return (
    <svg width="18" height="22" viewBox="0 0 18 22" style={{ display: 'block' }}>
      <path
        d="M9 0C4.03 0 0 4.03 0 9c0 5.5 8.1 12.4 9 13 .9-.6 9-7.5 9-13 0-4.97-4.03-9-9-9z"
        fill={color}
        stroke="rgba(0,0,0,0.75)"
        strokeWidth="1.5"
      />
      <text x="9" y="12.5" textAnchor="middle" fill="rgba(0,0,0,0.8)"
        fontSize="8" fontWeight="bold" fontFamily="Share Tech Mono">
        {initial}
      </text>
    </svg>
  )
}

export default function MapCanvas({
  mapNorm, mapName,
  drawings = [], markers = [],
  myName, memberNames = [],
  myQuests = [], tasks = [],
  onAddStroke, onClearMyStrokes,
  onAddMarker, onClearMyMarkers,
}) {
  const canvasRef   = useRef(null)
  const drawingRef  = useRef(false)
  const strokeRef   = useRef([])
  const [hovKey, setHovKey]         = useState(null)
  const [hovMarker, setHovMarker]   = useState(null)
  const [myColor, setMyColor]       = useState(() => getUserColor(myName, memberNames))
  const [mode, setMode]             = useState('draw')          // 'draw' | 'marker'
  const [selectedQuestId, setSelectedQuestId] = useState('')

  const { mapKeys } = useMapKeys(mapNorm)
  const locatedKeys = Object.entries(mapKeys).filter(([, v]) => v.loc_x != null && v.loc_y != null)

  // Keep latest drawings/members in refs so resize handler can access them
  const drawingsRef    = useRef(drawings)
  const memberNamesRef = useRef(memberNames)
  useEffect(() => { drawingsRef.current = drawings; memberNamesRef.current = memberNames }, [drawings, memberNames])

  // Sync canvas internal resolution to its CSS display size, redraw on resize
  const syncRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    function sync() {
      const rect = canvas.getBoundingClientRect()
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width  = w
        canvas.height = h
        drawAllStrokes(canvas, drawingsRef.current, memberNamesRef.current)
      }
    }
    syncRef.current = sync
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  // Redraw whenever drawings or members change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !canvas.width) return
    drawAllStrokes(canvas, drawings, memberNames)
  }, [drawings, memberNames])

  // Reset marker mode when map changes
  useEffect(() => {
    setMode('draw')
    setSelectedQuestId('')
    setHovMarker(null)
  }, [mapNorm])

  function toRel(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]
  }

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return

    if (mode === 'marker') {
      if (!selectedQuestId) return
      const quest = myQuests.find(q => q.id === selectedQuestId)
      if (!quest) return
      const pt = toRel(e)
      onAddMarker?.({ id: crypto.randomUUID(), user: myName, questId: quest.id, questName: quest.name, x: pt[0], y: pt[1] })
      return
    }

    drawingRef.current = true
    const pt = toRel(e)
    strokeRef.current = [pt]
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = myColor
    ctx.beginPath()
    ctx.arc(pt[0] * canvas.width, pt[1] * canvas.height, 2, 0, Math.PI * 2)
    ctx.fill()
  }, [mode, selectedQuestId, myQuests, myName, myColor, onAddMarker])

  const handleMouseMove = useCallback((e) => {
    if (!drawingRef.current) return
    const pt = toRel(e)
    const prev = strokeRef.current[strokeRef.current.length - 1]
    strokeRef.current.push(pt)
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = myColor
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(prev[0] * canvas.width, prev[1] * canvas.height)
    ctx.lineTo(pt[0] * canvas.width, pt[1] * canvas.height)
    ctx.stroke()
  }, [myColor])

  const handleMouseUp = useCallback(() => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (strokeRef.current.length >= 2) {
      onAddStroke({ user: myName, color: myColor, pts: strokeRef.current })
    }
    strokeRef.current = []
  }, [myName, myColor, onAddStroke])

  function handleQuestSelect(e) {
    const val = e.target.value
    setSelectedQuestId(val)
    setMode(val ? 'marker' : 'draw')
  }

  const imgSrc = MAP_IMAGES[mapNorm]

  return (
    <div>
      {/* Mode toggle + legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button
          className={mode === 'draw' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
          onClick={() => { setMode('draw'); setSelectedQuestId('') }}
          style={{ fontSize: 10 }}>
          ✏ DRAW
        </button>
        <button
          className={mode === 'marker' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
          onClick={() => setMode('marker')}
          style={{ fontSize: 10 }}>
          ◎ QUEST MARKER
        </button>

        {mode === 'marker' && (
          <select
            value={selectedQuestId}
            onChange={handleQuestSelect}
            style={{ fontSize: 11, padding: '3px 6px', background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 3, color: selectedQuestId ? 'var(--gold)' : 'var(--txm)', flexShrink: 1, minWidth: 0, maxWidth: 220 }}>
            <option value="">— select quest to pin —</option>
            {myQuests.map(q => (
              <option key={q.id} value={q.id}>{q.name}</option>
            ))}
          </select>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexShrink: 0, flexWrap: 'wrap' }}>
          {memberNames.map(m => (
            <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: m === myName ? myColor : getUserColor(m, memberNames), flexShrink: 0 }} />
              <span className="mono" style={{ fontSize: 10, color: m === myName ? 'var(--goldtx)' : 'var(--txm)' }}>
                {m.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Color palette (draw mode only) + clear buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
        {mode === 'draw' && (
          <>
            <span className="mono" style={{ fontSize: 9, color: 'var(--txd)', marginRight: 2 }}>COLOR</span>
            {PALETTE.map(c => (
              <button key={c} onClick={() => setMyColor(c)} style={{
                width: 16, height: 16, borderRadius: '50%', padding: 0, flexShrink: 0,
                background: c,
                border: myColor === c ? '2px solid var(--gold)' : '1.5px solid rgba(255,255,255,0.2)',
                boxShadow: myColor === c ? '0 0 6px rgba(247,183,49,0.7)' : 'none',
              }} />
            ))}
            <button className="btn-ghost btn-sm" onClick={onClearMyStrokes}
              style={{ fontSize: 10, marginLeft: 'auto', flexShrink: 0 }}>
              CLEAR MY LINES
            </button>
          </>
        )}
        {mode === 'marker' && myQuests.length > 0 && (
          <>
            {selectedQuestId
              ? <span className="mono" style={{ fontSize: 10, color: 'var(--gold)' }}>CLICK MAP TO PLACE MARKER</span>
              : <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>SELECT A QUEST ABOVE, THEN CLICK THE MAP</span>
            }
            <button className="btn-ghost btn-sm" onClick={onClearMyMarkers}
              style={{ fontSize: 10, marginLeft: 'auto', flexShrink: 0 }}>
              CLEAR MY MARKERS
            </button>
          </>
        )}
        {mode === 'marker' && myQuests.length === 0 && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>ADD QUESTS FIRST TO PLACE MARKERS</span>
        )}
      </div>

      {/* Map image + drawing canvas + markers */}
      <div style={{ position: 'relative', width: '100%', lineHeight: 0, borderRadius: 4, overflow: 'hidden' }}>
        {imgSrc
          ? <img src={imgSrc} alt={mapName} draggable={false}
              onLoad={() => syncRef.current?.()}
              style={{ width: '100%', display: 'block', userSelect: 'none' }} />
          : <div style={{ width: '100%', paddingBottom: '66%', background: 'var(--sur)' }} />
        }

        {/* Key location markers */}
        {locatedKeys.map(([keyName, v]) => (
          <div key={keyName}
            onMouseEnter={() => setHovKey(keyName)}
            onMouseLeave={() => setHovKey(null)}
            style={{
              position: 'absolute',
              left: `${v.loc_x * 100}%`,
              top: `${v.loc_y * 100}%`,
              transform: 'translate(-50%, -50%)',
              zIndex: 2,
              cursor: 'default',
              filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))',
              pointerEvents: mode === 'marker' ? 'none' : 'auto',
            }}>
            <svg width="27" height="27" viewBox="0 0 24 24" fill={v.priority ? '#c9a84c' : '#6a9aaa'}>
              <path stroke="black" strokeWidth="1.2" strokeLinejoin="round" d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
            </svg>
          </div>
        ))}

        {/* Quest markers */}
        {markers.map(m => {
          const color = getUserColor(m.user, memberNames)
          return (
            <div key={m.id}
              onMouseEnter={() => setHovMarker(m)}
              onMouseLeave={() => setHovMarker(null)}
              style={{
                position: 'absolute',
                left: `${m.x * 100}%`,
                top: `${m.y * 100}%`,
                transform: 'translate(-50%, -100%)',
                zIndex: 3,
                cursor: 'default',
                filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.9))',
                pointerEvents: mode === 'marker' ? 'none' : 'auto',
              }}>
              <QuestMarkerPin color={color} initial={m.user[0].toUpperCase()} />
            </div>
          )
        })}

        {/* Hover tooltip — key */}
        {hovKey && !hovMarker && (
          <div style={{
            position: 'absolute', bottom: 8, left: 8,
            background: 'rgba(6,16,10,0.95)', border: '1px solid var(--brd2)',
            borderRadius: 4, padding: '5px 10px', fontSize: 12,
            pointerEvents: 'none', zIndex: 4,
          }}>
            <span className="mono" style={{ color: 'var(--gold)' }}>🔑</span>{' '}
            <span style={{ color: 'var(--tx)' }}>{hovKey}</span>
          </div>
        )}

        {/* Hover tooltip — quest marker */}
        {hovMarker && (() => {
          const color = getUserColor(hovMarker.user, memberNames)
          const task = tasks.find(t => t.id === hovMarker.questId)
          const objectives = task?.objectives?.filter(o => !o.optional) || []
          return (
            <div style={{
              position: 'absolute', bottom: 8, left: 8, right: 8,
              background: 'rgba(6,16,10,0.95)', border: '1px solid var(--brd2)',
              borderRadius: 4, padding: '7px 10px', fontSize: 12,
              pointerEvents: 'none', zIndex: 4,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span className="mono" style={{ fontSize: 10, color }}>{hovMarker.user.toUpperCase()}</span>
              </div>
              <div className="mono" style={{ color: 'var(--gold)', fontSize: 11, marginBottom: objectives.length ? 5 : 0 }}>
                {hovMarker.questName}
              </div>
              {objectives.map(o => (
                <div key={o.id} style={{ color: 'var(--txm)', fontSize: 11, paddingLeft: 8 }}>
                  · {o.description}
                </div>
              ))}
            </div>
          )
        })()}

        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            cursor: mode === 'marker' ? (selectedQuestId ? 'crosshair' : 'default') : 'crosshair',
            zIndex: 1,
          }}
        />
      </div>

      <div className="mono" style={{ marginTop: 8, fontSize: 10, color: 'var(--txd)', textAlign: 'center' }}>
        {mode === 'draw'
          ? <>YOUR COLOR: <span style={{ color: myColor }}>■</span>&nbsp; DRAW ROUTES — VISIBLE TO ALL PARTY MEMBERS IN REAL TIME</>
          : <>◎ QUEST MARKER MODE — PINS ARE VISIBLE TO ALL PARTY MEMBERS</>
        }
        {locatedKeys.length > 0 && mode === 'draw' && <> — <span style={{ color: 'var(--gold)' }}>●</span> KEY LOCATIONS</>}
      </div>
    </div>
  )
}
