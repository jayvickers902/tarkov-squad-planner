import { useState, useEffect, useMemo } from 'react'
import { useBossSpawns, useKeys } from '../useTarkov'
import { RED_REBEL_MAPS } from '../constants'

function toAntifandom(url) {
  if (!url) return null
  return url.replace('escapefromtarkov.fandom.com', 'escapefromtarkov.antifandom.com')
}

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
  return h >= 6 && h < 21
}

function SpawnBar({ chance }) {
  const pct = Math.round(chance * 100)
  const color = pct >= 75 ? '#c94c4c' : pct >= 50 ? '#c9944c' : pct >= 25 ? '#c9c44c' : '#4caa6a'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ flex: 1, height: 3, background: 'var(--brd2)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span className="mono" style={{ fontSize: 10, color, minWidth: 28, textAlign: 'right', flexShrink: 0 }}>{pct}%</span>
    </div>
  )
}

export default function StartRaidModal({ party, myName, tasks, onClose }) {
  const [times, setTimes] = useState(getTarkovTimes)
  const { getBossesForMap, loading: bossLoading } = useBossSpawns()

  useEffect(() => {
    const id = setInterval(() => setTimes(getTarkovTimes()), 1000)
    return () => clearInterval(id)
  }, [])

  const mapNorm = party.map_norm
  const mapName = party.map_name
  const isFactory = mapNorm === 'factory'
  const { allKeys } = useKeys(mapNorm)
  const keyIconMap = useMemo(() => Object.fromEntries(allKeys.map(k => [k.id, k.iconLink || null])), [allKeys])
  const dayBosses   = mapNorm ? getBossesForMap(isFactory ? 'factory' : mapNorm) : []
  const nightBosses = isFactory ? getBossesForMap('night-factory') : []
  const bosses = isFactory ? [...dayBosses, ...nightBosses] : dayBosses

  const myQuests = party.members?.[myName] || []

  const completedQuestIds = useMemo(() => new Set(
    Object.entries(party.progress || {})
      .filter(([k, v]) => k.startsWith('__done__:') && k.endsWith(`::${myName}`) && v)
      .map(([k]) => k.slice(9, k.lastIndexOf('::')))
  ), [party.progress, myName])

  const myMapQuests = useMemo(() => {
    return myQuests
      .filter(q => !completedQuestIds.has(q.id))
      .map(q => tasks.find(t => t.id === q.id))
      .filter(t => t && t.map?.normalizedName === mapNorm)
  }, [myQuests, tasks, mapNorm, completedQuestIds]) // eslint-disable-line

  const myItems = useMemo(() => {
    const progress = party.progress || {}
    const itemMap = {}
    myQuests.forEach(q => {
      const task = tasks.find(t => t.id === q.id)
      if (!task) return
      task.objectives?.forEach(obj => {
        if (obj.optional) return
        if (progress[`${task.id}::${obj.id}::${myName}`]) return
        const isPlant = obj.type === 'plantItem' && obj.item
        const isMark  = obj.type === 'mark' && obj.markerItem
        const onMap = obj.maps?.length > 0
          ? obj.maps.some(m => m.normalizedName === mapNorm)
          : task.map?.normalizedName === mapNorm
        if (!onMap) return
        if (isPlant || isMark) {
          const item  = isPlant ? obj.item : obj.markerItem
          const count = isPlant ? (obj.count || 1) : 1
          if (itemMap[item.id]) {
            itemMap[item.id].count += count
          } else {
            itemMap[item.id] = { name: item.name, iconLink: item.iconLink || null, count, isKey: false }
          }
        }
        // Keys required to access/complete objectives on this map
        // requiredKeys is [[Item]] — each inner array is a set of alternatives for one lock
        if (obj.requiredKeys?.length) {
          obj.requiredKeys.forEach(alternatives => {
            if (!alternatives?.length) return
            alternatives.forEach(keyItem => {
              if (!keyItem?.id) return
              const rk = `rk::${keyItem.id}`
              if (!itemMap[rk]) {
                itemMap[rk] = {
                  name: keyItem.name,
                  iconLink: keyItem.iconLink || keyIconMap[keyItem.id] || null,
                  count: 1,
                  isKey: true,
                  questName: task.name,
                }
              }
            })
          })
        }
      })
    })
    return Object.values(itemMap)
  }, [myQuests, tasks, mapNorm, party.progress, myName, keyIconMap]) // eslint-disable-line

  const hasCliffDescent = RED_REBEL_MAPS.has(mapNorm)
  const leftDay  = isDaytime(times.left)
  const rightDay = isDaytime(times.right)

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.78)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="card fade-in" style={{
        width: '100%', maxWidth: 480,
        maxHeight: '90vh', overflow: 'auto',
        display: 'flex', flexDirection: 'column',
        padding: 0,
      }}>

        {/* Header */}
        <div style={{ position: 'relative', height: 76, overflow: 'hidden', flexShrink: 0, borderRadius: '4px 4px 0 0' }}>
          <img
            src="/splash.jpg" alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 30%', display: 'block' }}
          />
          <div style={{
            position: 'absolute', inset: 0,
            background: `
              linear-gradient(to right,  #0c0e0d 0%, transparent 35%, transparent 65%, #0c0e0d 100%),
              linear-gradient(to bottom, #0c0e0d 0%, transparent 30%, transparent 60%, #0c0e0d 100%)
            `,
          }} />
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
          }}>
            <div className="mono" style={{ fontSize: 9, color: 'var(--gold)', letterSpacing: '.18em', textShadow: '0 0 4px #000, 0 1px 3px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000' }}>◆ INSERTING INTO</div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '.12em', lineHeight: 1, color: 'var(--goldtx)', textShadow: '0 0 4px #000, 0 1px 4px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000' }}>
              {(mapName || 'UNKNOWN').toUpperCase()}
            </div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--txm)', letterSpacing: '.14em', textShadow: '0 0 4px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000' }}>START RAID</div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Clocks + Bosses */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {[
                { label: 'LEFT',  secs: times.left,  day: leftDay  },
                { label: 'RIGHT', secs: times.right, day: rightDay },
              ].map(({ label, secs, day }) => (
                <div key={label} style={{
                  background: 'var(--sur2)',
                  border: `1px solid ${day ? 'var(--golddim)' : 'var(--brd2)'}`,
                  borderRadius: 4, padding: '5px 8px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                }}>
                  <div className="mono" style={{ fontSize: 8, color: 'var(--txm)', letterSpacing: '.06em' }}>{label}</div>
                  <div style={{
                    fontFamily: 'Orbitron, Share Tech Mono, monospace',
                    fontSize: 18, fontWeight: 700, letterSpacing: '.1em',
                    color: day ? 'var(--goldtx)' : '#8ab0cc', lineHeight: 1,
                  }}>
                    {toHHMM(secs)}
                  </div>
                  <div className="mono" style={{ fontSize: 8, color: day ? 'var(--gold)' : '#5a7a8a' }}>
                    {day ? '☀ DAY' : '☽ NIGHT'}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 9, color: 'var(--gold)', letterSpacing: '.1em', marginBottom: 5 }}>◆ BOSS SPAWNS</div>
              {bossLoading ? (
                <div className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>LOADING...</div>
              ) : !bosses.length ? (
                <div className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>NO BOSSES ON THIS MAP</div>
              ) : bosses.map(b => (
                <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  {b.portrait
                    ? <img src={b.portrait} alt={b.name} style={{ width: 26, height: 26, borderRadius: 2, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--brd2)' }} />
                    : <div style={{ width: 26, height: 26, background: 'var(--sur3)', border: '1px solid var(--brd2)', borderRadius: 2, flexShrink: 0 }} />
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {b.name}
                    </div>
                    <SpawnBar chance={b.spawnChance} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cliff descent */}
          {hasCliffDescent && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px',
              background: 'rgba(201,168,76,0.06)', border: '1px solid var(--golddim)', borderRadius: 4,
            }}>
              <span style={{ fontSize: 14 }}>⛏</span>
              <span style={{ fontSize: 14 }}>🪢</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--goldtx)', letterSpacing: '.04em' }}>
                CLIFF DESCENT — BRING RED REBEL ICE PICK + PARACORD
              </span>
            </div>
          )}

          {/* My quests on this map */}
          <div>
            <div className="lbl" style={{ marginBottom: 6 }}>MY QUESTS ON THIS MAP</div>
            {myMapQuests.length === 0 ? (
              <div className="mono" style={{ fontSize: 11, color: 'var(--txd)' }}>— NO QUESTS ON THIS MAP</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {myMapQuests.map(task => (
                  <div key={task.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 9px',
                    background: 'var(--sur2)', border: '1px solid var(--brd)',
                    borderLeft: '3px solid var(--golddim)', borderRadius: 3,
                  }}>
                    {task.trader?.imageLink ? (
                      <img
                        src={task.trader.imageLink}
                        alt={task.trader.name}
                        title={task.trader.name}
                        style={{ width: 32, height: 32, borderRadius: 3, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--brd2)' }}
                      />
                    ) : task.trader ? (
                      <div style={{ width: 32, height: 32, borderRadius: 3, background: 'var(--sur3)', border: '1px solid var(--brd2)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span className="mono" style={{ fontSize: 8, color: 'var(--txd)' }}>{task.trader.name.slice(0, 3).toUpperCase()}</span>
                      </div>
                    ) : null}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {toAntifandom(task.wikiLink) ? (
                        <a href={toAntifandom(task.wikiLink)} target="_blank" rel="noreferrer"
                          style={{ fontSize: 12, fontFamily: 'Rajdhani, sans-serif', fontWeight: 600, color: 'var(--goldtx)', lineHeight: 1.2, textDecoration: 'none' }}
                          onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                          onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                          {task.name}
                        </a>
                      ) : (
                        <div style={{ fontSize: 12, fontFamily: 'Rajdhani, sans-serif', fontWeight: 600, color: 'var(--tx)', lineHeight: 1.2 }}>
                          {task.name}
                        </div>
                      )}
                      {task.trader && (
                        <div className="mono" style={{ fontSize: 9, color: 'var(--txd)', marginTop: 1 }}>{task.trader.name}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Items to bring */}
          {myItems.length > 0 && (
            <div>
              <div className="lbl" style={{ marginBottom: 6 }}>ITEMS TO BRING</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {myItems.map(item => (
                  <div key={item.name} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 9px',
                    background: 'var(--sur2)',
                    border: '1px solid var(--brd)',
                    borderLeft: item.isKey ? '3px solid var(--gold)' : '1px solid var(--brd)',
                    borderRadius: 3,
                  }}>
                    {item.iconLink && (
                      <img src={item.iconLink} alt="" style={{
                        width: 32, height: 32, objectFit: 'contain', flexShrink: 0,
                        imageRendering: 'pixelated',
                        background: 'var(--sur)', border: '1px solid var(--brd2)', borderRadius: 2,
                      }} />
                    )}
                    <span className="mono" style={{ fontSize: 12, color: 'var(--goldtx)', fontWeight: 700, flexShrink: 0 }}>
                      {item.count}x
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, fontFamily: 'Rajdhani, sans-serif', fontWeight: 600, color: 'var(--tx)' }}>
                          {item.name}
                        </span>
                        {item.isKey && (
                          <span className="mono" style={{ fontSize: 9, color: 'var(--goldtx)', background: 'rgba(201,168,76,0.12)', border: '1px solid var(--golddim)', borderRadius: 3, padding: '1px 5px', letterSpacing: '.06em', flexShrink: 0 }}>KEY</span>
                        )}
                      </div>
                      {item.isKey && item.questName && (
                        <div className="mono" style={{ fontSize: 9, color: 'var(--txd)', marginTop: 1 }}>{item.questName}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{ padding: '0 16px 14px', flexShrink: 0 }}>
          <button
            className="btn-gold"
            style={{ width: '100%', padding: '11px', fontSize: 15, letterSpacing: '.1em' }}
            onClick={onClose}
          >
            OK — LET'S GO
          </button>
        </div>

      </div>
    </div>
  )
}
