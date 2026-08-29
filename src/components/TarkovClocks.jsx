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

// The two servers are always 12h apart, so exactly one of them is in daylight.
// The cells keep their fixed left/right positions — only the glyph and colour
// follow which server is actually in daylight right now.
export default function TarkovClocks() {
  const [times, setTimes] = useState(getTarkovTimes)

  useEffect(() => {
    const id = setInterval(() => setTimes(getTarkovTimes()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="tarkov-clock">
      <div className="tarkov-clock-label mono">
        <span>TARKOV</span>
        <span>TIME</span>
      </div>
      {[times.left, times.right].map((secs, i) => {
        const day = isDaytime(secs)
        return (
          <div key={i} className="tarkov-clock-cell" data-phase={day ? 'day' : 'night'}>
            <span className="tarkov-clock-glyph" aria-hidden="true">{day ? '\u2600' : '\u263E'}</span>
            <span className="mono tarkov-clock-time">{toHHMMSS(secs)}</span>
            <span className="sr-status">{day ? 'Daytime server' : 'Night server'}</span>
          </div>
        )
      })}
    </div>
  )
}
