import { useState, useEffect, useMemo } from 'react'
import { useBossSpawns, useKeys } from '../useTarkov'
import { getRestGoonReports } from '../tarkovRest'
import { loadPrebaked } from '../data/prebaked'
import { RED_REBEL_MAPS } from '../constants'
import { useIntel } from '../useIntel'
import { useMapLoot } from '../useMapLoot'
import { useIntelChecklist } from '../useIntelChecklist'
import { curatedLootPoints, mergeIntelSources, countByKind, INTEL_KINDS, bestCluster, RING_RADII_M } from '../tarkovIntel'
import { findMember, objectiveProgressKey, progressOwnerId, progressQuestId } from '../partyMembers'
import BossCard from './BossCard'
import useDialogFocus from '../useDialogFocus'

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

function summarizeExits(data, mapNorm) {
  const map = Array.isArray(data) ? data.find(entry => entry?.normalizedName === mapNorm) : null
  const extracts = Array.isArray(map?.extracts) ? map.extracts : []
  if (!extracts.length) return null
  const counts = extracts.reduce((result, extract) => {
    if (extract.faction === 'pmc') result.pmc += 1
    else if (extract.faction === 'scav') result.scav += 1
    else result.shared += 1
    const switchIds = Array.isArray(extract.switchIds)
      ? extract.switchIds
      : extract.switchIds ? [extract.switchIds] : []
    if (switchIds.length > 0) result.gated += 1
    return result
  }, { pmc: 0, scav: 0, shared: 0, gated: 0 })
  return { total: extracts.length, ...counts }
}

function formatGoonAge(timestamp) {
  const ageMs = Date.now() - Number(timestamp)
  if (!Number.isFinite(ageMs)) return null
  const ageMinutes = Math.max(0, Math.floor(ageMs / 60000))
  if (ageMinutes < 1) return 'LESS THAN 1 MIN AGO'
  if (ageMinutes < 60) return `${ageMinutes} MIN AGO`
  const ageHours = Math.floor(ageMinutes / 60)
  if (ageHours < 24) return `${ageHours} H AGO`
  return `${Math.floor(ageHours / 24)} D AGO`
}

function BossColumn({ label, bosses }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {label && <div className="mono" style={{ fontSize: 9, color: 'var(--txm)', letterSpacing: '.08em', marginBottom: 4 }}>{label}</div>}
      {!bosses.length ? (
        <div className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>NO BOSSES{label ? '' : ' ON THIS MAP'}</div>
      ) : (
        bosses.map((boss, index) => <BossCard key={`${boss.normalizedName || boss.name}-${index}`} boss={boss} compact />)
      )}
    </div>
  )
}

export default function StartRaidModal({ party, myUserId, tasks, onClose, onCancel = onClose }) {
  const dialogRef = useDialogFocus(true, onCancel)
  const [times, setTimes] = useState(getTarkovTimes)
  const [exitSummary, setExitSummary] = useState(null)
  const [goonReports, setGoonReports] = useState([])
  const { getBossesForMap, loading: bossLoading } = useBossSpawns()

  useEffect(() => {
    const id = setInterval(() => setTimes(getTarkovTimes()), 1000)
    return () => clearInterval(id)
  }, [])

  const mapNorm = party.map_norm

  useEffect(() => {
    let active = true
    setExitSummary(null)
    loadPrebaked('zones').then(prebaked => {
      if (active) setExitSummary(summarizeExits(prebaked?.data, mapNorm))
    })
    return () => { active = false }
  }, [mapNorm])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    getRestGoonReports(controller.signal)
      .then(result => {
        if (!active || result?.fromCache !== false || !Array.isArray(result?.data)) return
        setGoonReports(result.data)
      })
      .catch(error => {
        if (active && error?.name !== 'AbortError') console.warn('live Goons report unavailable', error)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [])

  const mapName = party.map_name
  const isFactory = mapNorm === 'factory'
  const { allKeys } = useKeys(mapNorm)
  const keyIconMap = useMemo(() => Object.fromEntries(allKeys.map(k => [k.id, k.iconLink || null])), [allKeys])
  const dayBosses   = mapNorm ? getBossesForMap(isFactory ? 'factory' : mapNorm) : []
  const nightBosses = isFactory ? getBossesForMap('night-factory') : []
  const bosses = isFactory ? [...dayBosses, ...nightBosses] : dayBosses
  const goonReport = goonReports
    .filter(report => report?.normalizedName === mapNorm && Number.isFinite(Number(report.timestamp)))
    .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))[0]
  const goonAge = goonReport ? formatGoonAge(goonReport.timestamp) : null

  // Pre-raid intel brief — "6 document spawns on Customs", known before you load
  // in, which is the one moment the count is actually actionable.
  const { intelPoints } = useIntel(mapNorm)
  const { lootRows } = useMapLoot(mapNorm)
  const { foundToday } = useIntelChecklist(mapNorm, party.progress?.['__raid_start__'] ?? null)
  const allIntel = useMemo(
    () => mergeIntelSources(intelPoints, curatedLootPoints(lootRows, mapNorm)),
    [intelPoints, lootRows, mapNorm],
  )
  const intelCounts = useMemo(() => countByKind(allIntel), [allIntel])
  const intelTotal = intelCounts.folder + intelCounts.case + intelCounts.document
  // The pre-raid half of the planning rings: the tightest group on this map,
  // quoted at the same radius the map's default ring uses so the number the
  // brief gives is the number the gold ring will show.
  const intelCluster = useMemo(
    () => (intelTotal > 1 ? bestCluster(allIntel, RING_RADII_M[0]) : null),
    [allIntel, intelTotal],
  )

  const myQuests = findMember(party.members, myUserId)?.quests || []

  const completedQuestIds = useMemo(() => new Set(
    Object.entries(party.progress || {})
      .filter(([k, v]) => k.startsWith('__done__:') && progressOwnerId(k) === myUserId && v)
      .map(([k]) => progressQuestId(k))
  ), [party.progress, myUserId])

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
        if (progress[objectiveProgressKey(task.id, obj.id, myUserId)]) return
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
  }, [myQuests, tasks, mapNorm, party.progress, myUserId, keyIconMap]) // eslint-disable-line

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
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        ref={dialogRef}
        className="card fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-raid-title"
        aria-describedby="start-raid-description"
        tabIndex={-1}
        style={{
        width: '100%', maxWidth: 480,
        maxHeight: '90vh', overflow: 'auto',
        display: 'flex', flexDirection: 'column',
        padding: 0,
        }}
      >

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
            <div id="start-raid-title" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '.12em', lineHeight: 1, color: 'var(--goldtx)', textShadow: '0 0 4px #000, 0 1px 4px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000' }}>
              {(mapName || 'UNKNOWN').toUpperCase()}
            </div>
            <div id="start-raid-description" className="mono" style={{ fontSize: 9, color: 'var(--txm)', letterSpacing: '.14em', textShadow: '0 0 4px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000' }}>REVIEW YOUR RAID BRIEF</div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Clocks */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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

            <div>
              <div className="mono" style={{ fontSize: 9, color: 'var(--gold)', letterSpacing: '.1em', marginBottom: 5 }}>◆ BOSS SPAWNS</div>
              {bossLoading ? (
                <div className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>LOADING...</div>
              ) : isFactory ? (
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <BossColumn label="FACTORY (DAY)" bosses={dayBosses} />
                  <BossColumn label="NIGHT FACTORY" bosses={nightBosses} />
                </div>
              ) : (
                <BossColumn bosses={bosses} />
              )}
              {exitSummary && (
                <div className="mono" style={{ marginTop: 8, fontSize: 9, color: 'var(--txm)', lineHeight: 1.35 }}>
                  ↳ {exitSummary.total} EXITS — {exitSummary.pmc} PMC · {exitSummary.scav} SCAV · {exitSummary.shared} BOTH · {exitSummary.gated} NEEDS A SWITCH
                </div>
              )}
              {goonAge && (
                <div className="mono" style={{ marginTop: 6, fontSize: 9, color: '#d69b5a', lineHeight: 1.35 }}>
                  ⚠ GOONS REPORTED HERE — {goonAge} · COMMUNITY REPORT
                </div>
              )}
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

          {/* Intel brief */}
          {intelTotal > 0 && (
            <div className="mono intel-brief">
              <span style={{ color: 'var(--goldtx)', letterSpacing: '.1em' }}>▤ INTEL SPAWNS</span>
              {intelCounts.folder > 0 && (
                <span style={{ color: INTEL_KINDS.folder.color }}>{intelCounts.folder} FOLDER</span>
              )}
              {intelCounts.case > 0 && (
                <span style={{ color: INTEL_KINDS.case.color }}>{intelCounts.case} CASE</span>
              )}
              {intelCounts.document > 0 && (
                <span style={{ color: INTEL_KINDS.document.color }}>{intelCounts.document} DOCUMENT</span>
              )}
              <span style={{ color: 'var(--txd)' }}>— ENABLE THE INTEL LAYER ON THE MAP</span>
              {intelCluster && intelCluster.count > 1 && (
                <span style={{ color: 'var(--goldtx)' }}>
                  · TIGHTEST GROUP {intelCluster.count} WITHIN {RING_RADII_M[0]} M — TURN ON ◎ RINGS TO SEE IT
                </span>
              )}
              {foundToday > 0 && (
                <span style={{ color: 'var(--txd)', marginLeft: 'auto' }}>{foundToday} CHECKED TODAY</span>
              )}
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
            data-autofocus
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
