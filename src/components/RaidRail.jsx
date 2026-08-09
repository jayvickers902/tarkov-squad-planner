import { useEffect, useMemo, useRef } from 'react'
import { bearingRange, staleness, ageLabel } from '../tarkovPings'
import { CLUSTER_RADIUS_M, kindOf } from '../tarkovIntel'
import { getUserColor } from '../tarkovObjectives'
import { normalizeMembers, objectiveProgressKey, questDoneKey } from '../partyMembers'

const OBJECTIVE_LABELS = {
  visit: 'locate',
  findItem: 'find item',
  findQuestItem: 'find item',
  giveItem: 'hand in',
  giveQuestItem: 'hand in',
  extract: 'survive & extract',
  plantItem: 'place marker',
  mark: 'mark location',
  shoot: 'eliminate',
  skill: 'skill',
  buildWeapon: 'build weapon',
}

function isTaskOnMap(task, mapNorm) {
  return !task?.map || !mapNorm || task.map.normalizedName === mapNorm
}

function isObjectiveOnMap(objective, task, mapNorm) {
  if (!mapNorm) return true
  if (objective.maps?.length) return objective.maps.some(map => map.normalizedName === mapNorm)
  if (task?.map?.normalizedName) return task.map.normalizedName === mapNorm
  return true
}

function objectiveLabel(objective) {
  return OBJECTIVE_LABELS[objective.type] || objective.type?.replace(/[A-Z]/g, letter => ` ${letter.toLowerCase()}`) || 'objective'
}

function memberIndex(name, members) {
  const index = members.indexOf(name)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

function buildObjectiveRows({ tasks, memberQuests, memberNames, memberIds, progress, starredQuests, mapNorm, pins, myPing }) {
  const taskById = new Map((tasks || []).map(task => [task.id, task]))
  const memberRows = normalizeMembers(memberQuests)
  const pinsByObjective = new Map()
  for (const pin of pins || []) {
    const key = `${pin.memberName}::${pin.key}`
    const list = pinsByObjective.get(key) || []
    list.push(pin)
    pinsByObjective.set(key, list)
  }

  const rows = []
  for (const member of memberRows) {
    const memberName = member.callsign
    const questEntries = member.quests
    const seen = new Set()
    for (const questEntry of questEntries) {
      const questId = questEntry?.id ?? questEntry
      const task = taskById.get(questId)
      if (!task || !isTaskOnMap(task, mapNorm)) continue

      for (const objective of task.objectives || []) {
        if (objective.optional || !isObjectiveOnMap(objective, task, mapNorm)) continue
        const rowKey = objectiveProgressKey(task.id, objective.id, member.user_id)
        if (seen.has(rowKey)) continue
        seen.add(rowKey)
        if (progress?.[questDoneKey(task.id, member.user_id)]) continue

        const focusKey = `${task.id}::${objective.id}`
        const locationPins = pinsByObjective.get(`${memberName}::${focusKey}`) || []
        const ranges = myPing
          ? locationPins.map(pin => bearingRange(myPing, { x: pin.lng, z: pin.lat })).filter(Boolean)
          : []
        const range = ranges.length
          ? ranges.reduce((best, current) => current.dist < best.dist ? current : best)
          : null

        rows.push({
          key: rowKey,
          focusKey,
          memberName,
          memberColor: getUserColor(memberName, memberNames, member.user_id, memberIds),
          questName: task.name,
          description: objective.description || '',
          action: objectiveLabel(objective),
          starred: !!starredQuests?.[task.id],
          hasLocation: locationPins.length > 0,
          pinCount: locationPins.length,
          range,
          memberOrder: memberIndex(memberName, memberNames),
        })
      }
    }
  }

  return rows.sort((a, b) => {
    if (myPing) {
      const aDistance = a.range?.dist ?? Number.MAX_SAFE_INTEGER
      const bDistance = b.range?.dist ?? Number.MAX_SAFE_INTEGER
      if (aDistance !== bDistance) return aDistance - bDistance
    } else if (a.starred !== b.starred) {
      return a.starred ? -1 : 1
    }
    if (a.starred !== b.starred) return a.starred ? -1 : 1
    return a.memberOrder - b.memberOrder || a.questName.localeCompare(b.questName)
  })
}

function PingCard({ card }) {
  const decay = staleness(card.age)
  return (
    <div className="ping-card raid-ping-card" style={{ opacity: Math.max(decay.opacity, 0.35), borderLeftColor: card.cadence.color }}>
      <div className="ping-card-head">
        <span className="mono" style={{ color: card.color, fontSize: 11, letterSpacing: '.08em' }}>{card.ping.user.toUpperCase()}</span>
        <span className="mono" style={{ color: card.cadence.color, fontSize: 10, letterSpacing: '.08em' }}>{card.cadence.label}</span>
        <span className="mono" style={{ color: decay.color, fontSize: 10, marginLeft: 'auto' }}>{ageLabel(card.age)}</span>
      </div>
      <div className="mono raid-ping-body">
        {card.fromMe && <span>{card.fromMe.dist} m {card.fromMe.dir} of you</span>}
        <span>{card.floor || `elev ${card.elev}`}</span>
        {card.motion && <span>moving {card.motion.dir} {card.motion.speed} m/s</span>}
        {card.nearObj && <span>{card.nearObj.dist} m from {card.nearObj.questName}</span>}
        {card.nearKey && <span>{card.nearKey.dist} m from {card.nearKey.name}</span>}
        {card.nearIntel && (
          <span style={{ color: kindOf(card.nearIntel.point).color }}>
            nearest {kindOf(card.nearIntel.point).short.toLowerCase()} {card.nearIntel.dist} m {card.nearIntel.dir}
            {card.nearIntel.more ? ` · ${card.nearIntel.more} more within ${CLUSTER_RADIUS_M} m` : ''}
          </span>
        )}
      </div>
    </div>
  )
}

function ObjectiveRow({ row, focusKey, onHoverFocus, onToggleFocus }) {
  const active = focusKey === row.focusKey
  const distanceLabel = !row.hasLocation
    ? 'no location'
    : row.range
    ? `${row.range.dist}m ${row.range.dir}`
    : '—'

  return (
    <div
      className={`obj-row${active ? ' obj-row-active' : ''}${row.hasLocation ? '' : ' obj-row-no-location'}`}
      style={{ borderLeftColor: row.memberColor }}
      title={row.description || undefined}
      role={row.hasLocation ? 'button' : undefined}
      tabIndex={row.hasLocation ? 0 : undefined}
      onMouseEnter={() => row.hasLocation && onHoverFocus(row.focusKey)}
      onMouseLeave={() => row.hasLocation && onHoverFocus(null)}
      onClick={() => row.hasLocation && onToggleFocus(row.focusKey)}
      onKeyDown={event => {
        if (row.hasLocation && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onToggleFocus(row.focusKey)
        }
      }}>
      <span className="obj-row-mark" style={{ color: row.memberColor }}>◆</span>
      <span className="mono obj-row-member" style={{ color: row.memberColor }}>{row.memberName.slice(0, 8).toUpperCase()}</span>
      <span className="obj-row-quest">{row.questName}</span>
      <span className="obj-row-separator">·</span>
      <span className="obj-row-action">{row.action}</span>
      <span className="mono obj-row-distance">[{distanceLabel}]</span>
    </div>
  )
}

export default function RaidRail({
  isMobile,
  mobileHeight = 35,
  onMobileHeight,
  pingCards = [],
  tasks = [],
  memberQuests = [],
  memberNames = [],
  memberIds = [],
  progress = {},
  starredQuests = {},
  mapNorm,
  objectivePins = [],
  myPing = null,
  loadingTasks = false,
  focusKey = null,
  onHoverFocus,
  onToggleFocus,
}) {
  const dragRef = useRef(null)
  const rows = useMemo(() => buildObjectiveRows({
    tasks, memberQuests, memberNames, memberIds, progress, starredQuests, mapNorm, pins: objectivePins, myPing,
  }), [tasks, memberQuests, memberNames, memberIds, progress, starredQuests, mapNorm, objectivePins, myPing])

  useEffect(() => {
    if (!isMobile || !onMobileHeight) return undefined
    function onMove(event) {
      if (!dragRef.current) return
      const next = ((window.innerHeight - event.clientY) / window.innerHeight) * 100
      onMobileHeight(Math.min(78, Math.max(22, next)))
    }
    function onUp() {
      dragRef.current = null
      document.body.style.removeProperty('user-select')
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.removeProperty('user-select')
    }
  }, [isMobile, onMobileHeight])

  function startDrag(event) {
    if (!isMobile) return
    dragRef.current = { y: event.clientY, height: mobileHeight }
    document.body.style.userSelect = 'none'
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  return (
    <aside className={`raid-rail${isMobile ? ' raid-rail-mobile' : ''}`} style={isMobile ? { height: `${mobileHeight}%` } : undefined}>
      {isMobile && (
        <div className="raid-rail-drag-handle" onPointerDown={startDrag} aria-label="Drag squad rail">
          <span />
        </div>
      )}
      <div className="raid-rail-title">
        <span className="mono">SQUAD</span>
        <span className="mono raid-rail-count">{pingCards.length} PING{pingCards.length === 1 ? '' : 'S'}</span>
      </div>

      <div className="raid-rail-scroll">
        <section className="raid-rail-section">
          <div className="mono raid-rail-heading">POSITION PINGS</div>
          {pingCards.length > 0
            ? <div className="raid-ping-list">{pingCards.map(card => <PingCard key={card.ping.id} card={card} />)}</div>
            : <div className="mono raid-rail-empty">NO POSITION PINGS YET</div>}
        </section>

        <section className="raid-rail-section">
          <div className="mono raid-rail-heading">
            OBJECTIVES
            <span className="raid-rail-count">{rows.length}</span>
          </div>
          {loadingTasks
            ? <div className="mono raid-rail-empty">LOADING...</div>
            : rows.length > 0
            ? <div className="obj-list">{rows.map(row => (
                <ObjectiveRow
                  key={row.key}
                  row={row}
                  focusKey={focusKey}
                  onHoverFocus={onHoverFocus}
                  onToggleFocus={onToggleFocus}
                />
              ))}</div>
            : <div className="mono raid-rail-empty">NO ACTIVE OBJECTIVES</div>}
        </section>
      </div>
    </aside>
  )
}
