import { useState, useRef } from 'react'
import { SPAWNS, TERRAIN, TERRAIN_LABELS, MAP_IMAGES } from '../constants'

const COLS = ['#c9a84c', '#7aaa6a', '#6a9aaa', '#aa7a6a', '#9a7aaa', '#aa9a6a']

function hashPos(seed) {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return { px: 8 + (h % 1000) / 1000 * 84, py: 8 + (Math.floor(h / 1000) % 500) / 500 * 84 }
}

export default function MapOverlay({ mapNorm, mapName, tasks, memberQuests, spawn, onSetSpawn, isLeader }) {
  const [imgOk, setImgOk] = useState(true)
  const [hov, setHov]     = useState(null)
  const svgRef = useRef()
  const spawns = SPAWNS[mapNorm] || []

  const ids = [...new Set(Object.values(memberQuests).flat().map(q => q.id))]
  const relevant = tasks.filter(t => ids.includes(t.id))

  const objs = relevant.flatMap(task =>
    (task.objectives || []).filter(o => !o.optional).map(obj => ({
      obj, task, ...hashPos(obj.id + task.id),
    }))
  )

  // Nearest-first route from spawn
  let route = []
  if (spawn && objs.length) {
    const sp = spawns.find(s => s.id === spawn)
    let cur = sp ? { px: sp.x * 100, py: sp.y * 100 } : { px: 50, py: 50 }
    let rem = [...objs]
    while (rem.length) {
      const best = rem.reduce((b, p) => {
        const d = Math.hypot(p.px - cur.px, p.py - cur.py)
        return d < b.d ? { p, d } : b
      }, { p: null, d: Infinity })
      route.push(best.p)
      cur = best.p
      rem = rem.filter(p => p !== best.p)
    }
  }

  const imgSrc = MAP_IMAGES[mapNorm]

  return (
    <div>
      <div className="lbl">{mapName?.toUpperCase()} // TACTICAL OVERVIEW</div>

      <div style={{
        width: '100%',
        aspectRatio: '16/10',
        position: 'relative',
        background: '#06100a',
        border: '1px solid var(--brd)',
        borderRadius: 6,
        overflow: 'hidden',
      }}>
        {/* Real map image — loads fine when hosted outside sandbox */}
        {imgOk && imgSrc && (
          <img
            src={imgSrc}
            alt={mapName}
            onLoad={() => setImgOk(true)}
            onError={() => setImgOk(false)}
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: '100%',
              objectFit: 'cover',
              opacity: .6,
              display: 'block',
              pointerEvents: 'none',
            }}
          />
        )}

        <svg
          ref={svgRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {/* Fallback drawn terrain — only shown if image fails */}
          {!imgOk && (
            <>
              <rect x="0" y="0" width="100" height="100" fill="#0a110e" />
              <defs>
                <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                  <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#1a2a22" strokeWidth="0.3" />
                </pattern>
                <pattern id="grid5" width="50" height="50" patternUnits="userSpaceOnUse">
                  <rect width="50" height="50" fill="url(#grid)" />
                  <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#22352a" strokeWidth="0.6" />
                </pattern>
              </defs>
              <rect x="0" y="0" width="100" height="100" fill="url(#grid5)" />
              {(TERRAIN[mapNorm] || []).map((z, i) => (
                <rect key={i} x={z.x} y={z.y} width={z.w} height={z.h}
                  rx="1" fill={z.fill || '#1a2e22'} opacity={z.op || 0.6} />
              ))}
              {(TERRAIN_LABELS[mapNorm] || []).map((l, i) => (
                <text key={i} x={l.x} y={l.y} textAnchor="middle"
                  fill="#2a4a35" fontSize="3" fontFamily="Share Tech Mono" opacity="0.7">
                  {l.label}
                </text>
              ))}
            </>
          )}

          {/* Route lines between objectives */}
          {route.length > 1 && route.map((p, i) => i > 0 ? (
            <line key={i}
              x1={route[i - 1].px} y1={route[i - 1].py}
              x2={p.px} y2={p.py}
              stroke="#c9a84c" strokeWidth="0.6" strokeDasharray="1.5 0.8" opacity="0.9"
            />
          ) : null)}

          {/* Objective markers — numbered dots */}
          {objs.map(({ obj, task, px, py }, i) => {
            const isHov = hov?.obj?.id === obj.id
            const c = COLS[i % COLS.length]
            return (
              <g key={obj.id} style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHov({ obj, task })}
                onMouseLeave={() => setHov(null)}>
                {/* Drop shadow for readability over map image */}
                <circle cx={px} cy={py} r={isHov ? 2.4 : 1.8} fill="rgba(0,0,0,0.6)" />
                <circle cx={px} cy={py} r={isHov ? 2.0 : 1.4} fill={c} opacity={isHov ? 1 : .95} />
                <text x={px} y={py + 3.6} textAnchor="middle"
                  fill={c} fontSize="2.2" fontFamily="Share Tech Mono"
                  style={{ filter: 'drop-shadow(0px 1px 1px rgba(0,0,0,0.8))' }}>
                  {i + 1}
                </text>
              </g>
            )
          })}

          {/* PMC spawn markers */}
          {spawns.map(s => {
            const sx = s.x * 100
            const sy = s.y * 100
            const sel = spawn === s.id
            return (
              <g key={s.id}
                style={{ cursor: isLeader ? 'pointer' : 'default' }}
                onClick={() => { if (isLeader) onSetSpawn(sel ? null : s.id) }}>
                {/* Outer glow for selected */}
                {sel && <circle cx={sx} cy={sy} r="3.8" fill="rgba(201,168,76,0.25)" />}
                <circle cx={sx} cy={sy}
                  r={sel ? 2.4 : 1.6}
                  fill={sel ? '#c9a84c' : 'rgba(201,168,76,0.15)'}
                  stroke="#c9a84c"
                  strokeWidth={sel ? .7 : .5}
                />
                {sel && <circle cx={sx} cy={sy} r=".9" fill="#0c0e0d" />}
                <text
                  x={sx} y={sy - (sel ? 3.6 : 2.8)}
                  textAnchor="middle"
                  fill={sel ? '#e8c96a' : '#c9a84c'}
                  fontSize={sel ? '2.0' : '1.6'}
                  fontFamily="Share Tech Mono"
                  fontWeight={sel ? 'bold' : 'normal'}
                  style={{ filter: 'drop-shadow(0px 1px 2px rgba(0,0,0,0.9))' }}
                >
                  {s.label}
                </text>
              </g>
            )
          })}
        </svg>

        {/* Hover tooltip */}
        {hov && (
          <div style={{
            position: 'absolute', bottom: 8, left: 8, right: 8,
            background: 'rgba(6,16,10,0.95)',
            border: '1px solid var(--brd2)',
            borderRadius: 4, padding: '7px 10px',
            fontSize: 12, pointerEvents: 'none',
          }}>
            <div className="mono" style={{ color: 'var(--gold)', marginBottom: 2, fontSize: 10 }}>
              {hov.task.name}
            </div>
            <div style={{ color: 'var(--tx)' }}>{hov.obj.description}</div>
          </div>
        )}
      </div>

      {/* Spawn selector buttons */}
      <div style={{ marginTop: 10 }}>
        <div className="lbl">
          {isLeader
            ? 'CLICK MAP MARKER OR BUTTON TO SET YOUR SPAWN'
            : 'SPAWN LOCATION (SET BY LEADER)'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {spawns.map(s => (
            <button
              key={s.id}
              onClick={() => { if (isLeader) onSetSpawn(spawn === s.id ? null : s.id) }}
              className={spawn === s.id ? 'btn-gold' : 'btn-ghost'}
              style={{
                padding: '4px 9px', fontSize: 11,
                opacity: isLeader ? 1 : .6,
                cursor: isLeader ? 'pointer' : 'default',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {spawn && objs.length > 0 && (() => {
          const sp = spawns.find(s => s.id === spawn)
          return (
            <div className="mono" style={{
              marginTop: 8, padding: '7px 10px',
              background: 'var(--sur2)',
              border: '1px solid var(--golddim)',
              borderRadius: 4, fontSize: 11, color: 'var(--gold)',
            }}>
              ◈ ROUTE OPTIMIZED // {objs.length} OBJECTIVE{objs.length !== 1 ? 'S' : ''} // NEAREST-FIRST FROM {(sp?.label || spawn).toUpperCase()}
            </div>
          )
        })()}

        {!objs.length && (
          <p className="mono" style={{ marginTop: 8, fontSize: 11, color: 'var(--txd)' }}>
            ADD QUESTS TO SEE OBJECTIVE MARKERS ON THE MAP
          </p>
        )}
      </div>
    </div>
  )
}
