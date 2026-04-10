import { useState, useEffect } from 'react'

function getTarkovTimes() {
  const realMs = Date.now()
  const dayMs  = 24 * 3600 * 1000
  const left  = ((3  * 3600000 + 7 * realMs) % dayMs) / 1000
  const right = ((15 * 3600000 + 7 * realMs) % dayMs) / 1000
  return { left, right }
}

function toHHMMSS(secs) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function isDaytime(secs) {
  const h = secs / 3600
  return h >= 7 && h < 19
}

export default function TarkovClocks() {
  const [times, setTimes] = useState(getTarkovTimes)

  useEffect(() => {
    const id = setInterval(() => setTimes(getTarkovTimes()), 100)
    return () => clearInterval(id)
  }, [])

  const leftDay  = isDaytime(times.left)
  const rightDay = isDaytime(times.right)

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
      {[
        { secs: times.left,  day: leftDay  },
        { secs: times.right, day: rightDay },
      ].map(({ secs, day }) => (
        <div key={secs} style={{
          background: 'var(--sur2)',
          border: `1px solid ${day ? 'var(--golddim)' : '#2a3d52'}`,
          borderRadius: 5,
          padding: '4px 10px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
        }}>
          <div style={{
            fontFamily: 'Share Tech Mono, monospace',
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: day ? 'var(--goldtx)' : '#8ab0cc',
            lineHeight: 1,
          }}>
            {toHHMMSS(secs)}
          </div>
          <div className="mono" style={{ fontSize: 8, color: day ? 'var(--gold)' : '#5a7a8a', letterSpacing: '.06em' }}>
            {day ? '☀ DAY' : '☽ NIGHT'}
          </div>
        </div>
      ))}
    </div>
  )
}
