import { useState, useEffect } from 'react'

function getTarkovTimes() {
  const utcSecs = Date.now() / 1000
  const tarkovSecs = (utcSecs * 7) % 86400
  const rightSecs  = (tarkovSecs + 43200) % 86400
  return { left: tarkovSecs, right: rightSecs }
}

function toHHMM(secs) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function isDaytime(secs) {
  const h = secs / 3600
  return h >= 7 && h < 19
}

export default function TarkovClocks() {
  const [times, setTimes] = useState(getTarkovTimes)

  useEffect(() => {
    const id = setInterval(() => setTimes(getTarkovTimes()), 1000)
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
            {toHHMM(secs)}
          </div>
          <div className="mono" style={{ fontSize: 8, color: day ? 'var(--gold)' : '#5a7a8a', letterSpacing: '.06em' }}>
            {day ? '☀ DAY' : '☽ NIGHT'}
          </div>
        </div>
      ))}
    </div>
  )
}
