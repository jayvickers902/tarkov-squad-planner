import { useRef, useEffect, useCallback, useState } from 'react'
import { MAP_IMAGES } from '../constants'
import { useMapKeys } from '../useMapKeys'



const USER_COLORS = ['#e85d5d', '#5db8e8', '#5de87a', '#f5a623', '#c45de8', '#5de8d4', '#e8e85d', '#e85da8']

function getUserColor(user, memberNames) {
  const idx = memberNames.indexOf(user)
  return USER_COLORS[Math.max(idx, 0) % USER_COLORS.length]
}

function drawAllStrokes(canvas, drawings, memberNames) {
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ;(drawings || []).forEach(stroke => {
    if (!stroke.pts || stroke.pts.length < 2) return
    ctx.strokeStyle = getUserColor(stroke.user, memberNames)
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

export default function MapCanvas({ mapNorm, mapName, drawings = [], myName, memberNames = [], onAddStroke, onClearMyStrokes }) {
  const canvasRef   = useRef(null)
  const drawingRef  = useRef(false)
  const strokeRef   = useRef([])
  const [hovKey, setHovKey] = useState(null)

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

  function toRel(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]
  }

  const handleMouseDown = useCallback((e) => {
    drawingRef.current = true
    const pt = toRel(e)
    strokeRef.current = [pt]
    // Draw the initial dot
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = getUserColor(myName, memberNames)
    ctx.beginPath()
    ctx.arc(pt[0] * canvas.width, pt[1] * canvas.height, 2, 0, Math.PI * 2)
    ctx.fill()
  }, [myName, memberNames])

  const handleMouseMove = useCallback((e) => {
    if (!drawingRef.current) return
    const pt = toRel(e)
    const prev = strokeRef.current[strokeRef.current.length - 1]
    strokeRef.current.push(pt)
    // Draw only the latest segment for performance
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = getUserColor(myName, memberNames)
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(prev[0] * canvas.width, prev[1] * canvas.height)
    ctx.lineTo(pt[0] * canvas.width, pt[1] * canvas.height)
    ctx.stroke()
  }, [myName, memberNames])

  const handleMouseUp = useCallback(() => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (strokeRef.current.length >= 2) {
      onAddStroke({ user: myName, pts: strokeRef.current })
    }
    strokeRef.current = []
  }, [myName, onAddStroke])

  const imgSrc   = MAP_IMAGES[mapNorm]
  const myColor  = getUserColor(myName, memberNames)

  return (
    <div>
      {/* Legend + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        {memberNames.map(m => (
          <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: getUserColor(m, memberNames), flexShrink: 0 }} />
            <span className="mono" style={{ fontSize: 10, color: m === myName ? 'var(--goldtx)' : 'var(--txm)' }}>
              {m.toUpperCase()}
            </span>
          </div>
        ))}
        <button className="btn-ghost btn-sm" onClick={onClearMyStrokes}
          style={{ fontSize: 10, marginLeft: 'auto', flexShrink: 0 }}>
          CLEAR MY LINES
        </button>
      </div>

      {/* Map image + drawing canvas */}
      <div style={{ position: 'relative', width: '100%', lineHeight: 0, borderRadius: 4, overflow: 'hidden' }}>
        {imgSrc
          ? <img src={imgSrc} alt={mapName} draggable={false}
              onLoad={() => syncRef.current?.()}
              style={{ width: '100%', display: 'block', userSelect: 'none' }} />
          : <div style={{ width: '100%', paddingBottom: '66%', background: 'var(--sur)' }} />
        }
        {/* Key location markers */}
        {locatedKeys.length > 0 && (
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 2 }}
            viewBox="0 0 100 100" preserveAspectRatio="none">
            {locatedKeys.map(([keyName, v]) => {
              const px = v.loc_x * 100
              const py = v.loc_y * 100
              const isPri = v.priority
              return (
                <g key={keyName} style={{ cursor: 'default', pointerEvents: 'all' }}
                  onMouseEnter={() => setHovKey(keyName)}
                  onMouseLeave={() => setHovKey(null)}>
                  <circle cx={px} cy={py} r="2.5" fill="transparent" />
                  <circle cx={px} cy={py} r="1.8" fill="rgba(0,0,0,0.55)" />
                  <circle cx={px} cy={py} r="1.4" fill={isPri ? '#c9a84c' : '#6a9aaa'} />
                </g>
              )
            })}
          </svg>
        )}

        {/* Hover tooltip for hovered key */}
        {hovKey && (
          <div style={{
            position: 'absolute', bottom: 8, left: 8,
            background: 'rgba(6,16,10,0.95)', border: '1px solid var(--brd2)',
            borderRadius: 4, padding: '5px 10px', fontSize: 12,
            pointerEvents: 'none', zIndex: 3,
          }}>
            <span className="mono" style={{ color: 'var(--gold)' }}>🔑</span>{' '}
            <span style={{ color: 'var(--tx)' }}>{hovKey}</span>
          </div>
        )}

        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            cursor: 'crosshair',
            zIndex: 1,
          }}
        />
      </div>

      <div className="mono" style={{ marginTop: 8, fontSize: 10, color: 'var(--txd)', textAlign: 'center' }}>
        YOUR COLOR: <span style={{ color: myColor }}>■</span>&nbsp;
        DRAW ROUTES — VISIBLE TO ALL PARTY MEMBERS IN REAL TIME
        {locatedKeys.length > 0 && <> — <span style={{ color: 'var(--gold)' }}>●</span> KEY LOCATIONS</>}
      </div>
    </div>
  )
}
