import { useEffect, useMemo, useRef, useState } from 'react'
import { bearingRange, staleness, ageLabel } from '../tarkovPings'
import { CLUSTER_RADIUS_M, kindOf } from '../tarkovIntel'
import { getUserColor, objectiveHasMapLocation } from '../tarkovObjectives'
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
      if (!task) continue

      for (const objective of task.objectives || []) {
        if (objective.optional || !objectiveHasMapLocation(objective, task, mapNorm)) continue
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

function PingCard({ card, focusPingId, onFocusPing, onHoverPing }) {
  const decay = staleness(card.age)
  const active = focusPingId === card.ping.id
  return (
    <div
      className={`ping-card raid-ping-card${active ? ' ping-card-active' : ''}`}
      style={{ opacity: Math.max(decay.opacity, 0.35), borderLeftColor: card.cadence.color }}
      role="button"
      tabIndex={0}
      onMouseEnter={() => onHoverPing(card.ping.id)}
      onMouseLeave={() => onHoverPing(null)}
      onClick={() => onFocusPing(card.ping.id)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onFocusPing(card.ping.id)
        }
      }}>
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
        {card.nearExtract && <span style={{ color: 'var(--goldtx)' }}>{card.nearExtract.dist} m from {card.nearExtract.name} extract</span>}
        {card.nearIntel && (
          <span style={{ color: kindOf(card.nearIntel.point).color }}>
            nearest {kindOf(card.nearIntel.point).short.toLowerCase()} {card.nearIntel.dist} m {card.nearIntel.dir}
            {card.nearIntel.more ? ` · ${card.nearIntel.more} more within ${CLUSTER_RADIUS_M} m` : ''}
          </span>
        )}
        {card.likelySpawn && (
          <span style={{ color: '#5de87a' }}>
            likely spawn {card.likelySpawn.dist} m{card.likelySpawn.dir ? ` ${card.likelySpawn.dir}` : ''} · last there {card.likelySpawn.ageLabel} ago
          </span>
        )}
        {card.nearby?.length > 0 && (
          <span style={{ color: 'var(--txm)' }}>
            nearby {card.nearby.map(teammate => `${teammate.user} ${teammate.dist}m ${teammate.dir}`).join(' · ')}
          </span>
        )}
      </div>
    </div>
  )
}

function LastKnownCard({ card, focusPingId, onFocusPing, onHoverPing }) {
  const active = focusPingId === card.ping.id
  return (
    <div
      className={`last-known-card${active ? ' last-known-card-active' : ''}`}
      style={{ borderLeftColor: card.color }}
      role="button"
      tabIndex={0}
      onMouseEnter={() => onHoverPing(card.ping.id)}
      onMouseLeave={() => onHoverPing(null)}
      onClick={() => onFocusPing(card.ping.id)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onFocusPing(card.ping.id)
        }
      }}>
      <div className="last-known-head">
        <span className="mono" style={{ color: card.color, fontSize: 11, letterSpacing: '.08em' }}>
          {card.ping.user.toUpperCase()}
        </span>
        <span className="mono last-known-age">{ageLabel(card.age)} AGO</span>
      </div>
      <div className="mono last-known-body">
        <span className="last-known-area">
          {card.nearArea ? `NEAR ${card.nearArea.name.toUpperCase()}` : 'AREA UNKNOWN'}
        </span>
        {card.nearArea && <span className="last-known-distance">{card.nearArea.dist} M</span>}
        {card.floor && <span>{card.floor}</span>}
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
  lastKnownCards = [],
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
  focusPingId = null,
  onFocusPing = () => {},
  onHoverPing = () => {},
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
        <div
          className="raid-rail-drag-handle"
          onPointerDown={startDrag}
          role="separator"
          tabIndex={0}
          aria-label="Resize squad rail"
          aria-orientation="horizontal"
          aria-valuemin={22}
          aria-valuemax={78}
          aria-valuenow={Math.round(mobileHeight)}
          onKeyDown={event => {
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              onMobileHeight?.(Math.min(78, mobileHeight + 5))
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              onMobileHeight?.(Math.max(22, mobileHeight - 5))
            }
          }}
        >
          <span />
        </div>
      )}
      <div className="raid-rail-title">
        <span className="mono">SQUAD</span>
        <span className="mono raid-rail-count">{pingCards.length} ECHO{pingCards.length === 1 ? '' : 'S'}</span>
      </div>

      <div className="raid-rail-scroll">
        <section className="raid-rail-section">
          <div className="mono raid-rail-heading">
            SQUAD ECHO
          </div>
          {pingCards.length > 0
            ? <div className="raid-ping-list">{pingCards.map(card => (
                <PingCard
                  key={card.ping.id}
                  card={card}
                  focusPingId={focusPingId}
                  onFocusPing={onFocusPing}
                  onHoverPing={onHoverPing}
                />
              ))}</div>
            : <div className="mono raid-rail-empty">NO SQUAD ECHO YET</div>}
        </section>

        <section className="raid-rail-section">
          <div className="mono raid-rail-heading">
            LAST KNOWN
            <span className="raid-rail-count">{lastKnownCards.length}</span>
          </div>
          {lastKnownCards.length > 0
            ? <div className="last-known-list">{lastKnownCards.map(card => (
                <LastKnownCard
                  key={card.ping.id}
                  card={card}
                  focusPingId={focusPingId}
                  onFocusPing={onFocusPing}
                  onHoverPing={onHoverPing}
                />
              ))}</div>
            : <div className="mono raid-rail-empty">NO LAST KNOWN PINGS YET</div>}
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
