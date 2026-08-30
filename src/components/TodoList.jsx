import { useState, useMemo, useCallback, memo } from 'react'
import { normalizeMembers, objectiveProgressKey, questDoneKey } from '../partyMembers'
import { objectiveHasMapLocation, objectiveIsOnMap, objectiveTypeLabel, traderGateLabel } from '../tarkovObjectives'
import { memberColor } from '../memberColors'
import { questRailColor } from '../questColors'


function toAntifandom(url) {
  if (!url) return null
  return url.replace('escapefromtarkov.fandom.com', 'escapefromtarkov.antifandom.com')
}

// A member reads as a colour bar butted against their callsign, so a row's
// owners are scannable before the text is.
function MemberPill({ name, allMembers, done = false }) {
  const c = memberColor(name, allMembers)
  return (
    <span
      className={done ? 'owner-chip is-done' : 'owner-chip'}
      style={done ? undefined : { background: c.bg, borderColor: c.border, color: c.text }}
    >
      <span className="owner-chip-bar" style={{ background: done ? 'var(--grn)' : c.text }} />
      <span className="mono owner-chip-name">{name.slice(0, 8).toUpperCase()}</span>
    </span>
  )
}

function objsForMap(task, mapNorm) {
  const objectives = task?.objectives
  return (objectives || []).filter(o => {
    if (o.optional) return false
    if (!mapNorm) return true
    return objectiveIsOnMap(o, task, mapNorm)
  })
}

// UI-only drag ordering keys; these are deliberately separate from party
// progress keys, which are built by partyMembers.js.
function objectiveOrderKey(taskId, objectiveId) {
  return JSON.stringify([taskId, objectiveId])
}

const QuestCard = memo(function QuestCard({
  task, owners, objs, doneCount, starred, allDone, completed, canAct, dimmed,
  isOpen, onToggleExpand, onToggleStar, onSkip, members, progress, memberIdsByName,
}) {
  const pct = objs.length ? (doneCount / objs.length) * 100 : 0
  const loyalty = traderGateLabel(task)
  const rail = questRailColor(task.id)

  return (
    <div style={{
      background: 'var(--sur2)',
      border: `1px solid ${starred && !allDone && !completed && !dimmed ? 'var(--golddim)' : 'var(--brd)'}`,
      borderLeft: `3px solid ${completed || allDone ? 'var(--grn)' : dimmed ? 'var(--brd)' : starred ? 'var(--gold)' : rail}`,
      borderRadius: 4,
      opacity: completed || allDone || dimmed ? .4 : 1,
      transition: 'opacity .2s, border-color .15s',
    }}>

      {/* Quest header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', cursor: 'pointer' }}
        onClick={() => onToggleExpand(task.id)}>

        {/* Star */}
        {canAct ? (
          <button
            onClick={e => { e.stopPropagation(); onToggleStar(task.id) }}
            title="Star — pins to top for everyone"
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0,
              fontSize: 14, lineHeight: 1,
              color: starred ? 'var(--gold)' : 'var(--txd)',
              transition: 'color .15s',
            }}>★</button>
        ) : (
          starred
            ? <span style={{ fontSize: 14, color: 'var(--golddim)', flexShrink: 0, lineHeight: 1 }}>★</span>
            : <span style={{ width: 14, flexShrink: 0 }} />
        )}

        {/* Quest name + owners */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              fontSize: 13, fontFamily: 'Rajdhani, sans-serif', fontWeight: 600,
              color: completed || allDone || dimmed ? 'var(--txm)' : 'var(--tx)',
              textDecoration: completed || allDone ? 'line-through' : 'none',
              letterSpacing: '.03em',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{task.name}</div>
            {task.kappaRequired && (
              <span className="mono" title="Required for Kappa" style={{
                fontSize: 'var(--fs-xs)', padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                background: 'rgba(201,168,76,0.15)', border: '1px solid var(--golddim)',
                color: 'var(--gold)', letterSpacing: '.06em',
              }}>κ</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
            {owners.map(o => <MemberPill key={o} name={o} allMembers={members} />)}
            {task.trader?.imageLink && (
              <img src={task.trader.imageLink} alt={task.trader.name} title={task.trader.name} style={{ width: 18, height: 18, borderRadius: 2, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--brd)', opacity: completed || allDone ? 0.4 : 0.8 }} />
            )}
            {loyalty && <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txm)' }}>{loyalty}</span>}
          </div>
        </div>

        {/* Skip button — only for quest owner, not on completed/allDone */}
        {canAct && !completed && !allDone && (
          <div style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              onClick={() => onSkip(task.id)}
              title={dimmed ? 'Un-skip' : 'Skip for now'}
              style={{
                background: 'none', border: '1px solid var(--brd2)', borderRadius: 3,
                padding: '2px 7px', cursor: 'pointer', fontSize: 'var(--fs-xs)', fontFamily: 'Share Tech Mono',
                color: dimmed ? 'var(--gold)' : 'var(--txd)', letterSpacing: '.04em', transition: 'all .15s',
              }}>{dimmed ? 'UNSKIP' : '⊘ SKIP'}</button>
          </div>
        )}

        {/* Progress */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="mono" style={{ fontSize: 'var(--fs-sm)', color: completed || allDone ? 'var(--grn)' : 'var(--txm)' }}>
            {doneCount}/{objs.length}
          </div>
          <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)' }}>
            {completed || allDone ? 'DONE' : `${Math.round(pct)}%`}
          </div>
        </div>

        <div className="mono" style={{ color: 'var(--txd)', fontSize: 'var(--fs-xs)', flexShrink: 0 }}>
          {isOpen ? '▲' : '▼'}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 2, background: 'var(--brd)' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: completed || allDone ? 'var(--grn)' : 'var(--gold)',
          transition: 'width .3s',
        }} />
      </div>

      {/* Expanded objectives */}
      {isOpen && (
        <div style={{ padding: '6px 10px 10px' }} className="fade-in">
          <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)', letterSpacing: '.1em', marginBottom: 6, paddingBottom: 5, borderBottom: '1px solid var(--brd)' }}>OBJECTIVES</div>
          {objs.map(obj => {
            const doneBy = owners.filter(m => progress?.[objectiveProgressKey(task.id, obj.id, memberIdsByName.get(m))])
            const allDoneObj = doneBy.length === owners.length && owners.length > 0
            return (
              <div key={obj.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 9,
                padding: '6px 0', borderBottom: '1px solid var(--brd)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 'var(--fs-sm)',
                    color: allDoneObj ? 'var(--txd)' : 'var(--tx)',
                    textDecoration: allDoneObj ? 'line-through' : 'none',
                    lineHeight: 1.4,
                  }}>{obj.description}</div>
                  {owners.length > 1 && (
                    <div style={{ display: 'flex', gap: 3, marginTop: 3, flexWrap: 'wrap' }}>
                      {owners.map(m => {
                        const done = doneBy.includes(m)
                        return <MemberPill key={m} name={m} allMembers={members} done={done} />
                      })}
                    </div>
                  )}
                </div>
                <span className="mono" style={{
                  fontSize: 'var(--fs-xs)', flexShrink: 0, marginTop: 2, letterSpacing: '.06em',
                  color: allDoneObj ? 'var(--txd)' : 'var(--txm)',
                  background: 'var(--sur)', border: '1px solid var(--brd)',
                  borderRadius: 2, padding: '1px 5px',
                }}>
                  {objectiveTypeLabel(obj.type)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})

export default function TodoList({ tasks, memberQuests = [], progress, onToggleStar, questOrder, initialSkipped, starredQuests, myUserId, mapNorm }) {
  const [filter, setFilter]     = useState('all')
  const [kappaOnly, setKappaOnly] = useState(false)
  const [expanded, setExpanded] = useState({})
  const [skipped, setSkipped]   = useState(() => initialSkipped ? new Set(initialSkipped) : new Set())
  const [viewMode, setViewMode] = useState('objectives') // 'quests' | 'objectives'
  const [objOrder, setObjOrder]         = useState([])
  const [dragObjKey, setDragObjKey]     = useState(null)
  const [dragOverObjKey, setDragOverObjKey] = useState(null)
  const memberRows = normalizeMembers(memberQuests)
  const members = memberRows.map(member => member.callsign)
  const memberIdsByName = new Map(memberRows.map(member => [member.callsign, member.user_id]))

  const handleToggleExpand = useCallback((taskId) => {
    setExpanded(e => ({ ...e, [taskId]: !e[taskId] }))
  }, [])

  const handleSkip = useCallback((questId) => {
    setSkipped(prev => {
      const next = new Set(prev)
      next.has(questId) ? next.delete(questId) : next.add(questId)
      return next
    })
  }, [])

  const questRows = useMemo(() => {
    const allQuestEntries = memberRows.flatMap(member => member.quests)
    const ids = [...new Set(allQuestEntries.map(q => q.id))]
    return ids
      .map(id => {
        const matchedTask = tasks.find(t => t.id === id)
        // A missing task in a map-scoped list is an off-map quest, not missing
        // quest data. Rendering the generic fallback here creates the empty
        // cards with no trader portrait or objective details.
        if (mapNorm && !matchedTask) return null
        return matchedTask || {
          id,
          name: allQuestEntries.find(q => q.id === id)?.name || id,
          objectives: [],
          trader: null,
          incompleteData: true,
        }
      })
      .filter(Boolean)
      .map(task => {
        const owners    = memberRows.filter(member => member.quests.find(q => q.id === task.id)).map(member => member.callsign)
        const objs      = objsForMap(task, mapNorm)
        const doneCount = objs.filter(o =>
          owners.length > 0 && owners.every(m => progress?.[objectiveProgressKey(task.id, o.id, memberIdsByName.get(m))])
        ).length
        const starred   = starredQuests?.[task.id] || false
        const allDone   = objs.length > 0 && doneCount === objs.length
        const completed = owners.length > 0 && owners.every(m => progress?.[questDoneKey(task.id, memberIdsByName.get(m))])
        const canAct    = owners.some(m => memberIdsByName.get(m) === myUserId)
        // True only when the quest has an objective with an actual map position.
        // Map metadata alone is not enough for the MAP OBJECTIVES view.
        const isMapSpecific  = mapNorm
          ? (task.objectives || []).some(o => !o.optional && objectiveHasMapLocation(o, task, mapNorm))
          : false
        return { task, owners, objs, doneCount, starred, allDone, completed, canAct, isMapSpecific }
      })
      .filter(r => {
        if (!mapNorm) return true
        // Hide quests that have objectives but none on this map
        const allObjs = (r.task.objectives || []).filter(o => !o.optional)
        return allObjs.length === 0 || r.objs.length > 0
      })
  }, [tasks, memberRows, progress, starredQuests, myUserId, mapNorm])

  const sortedRows = useMemo(() => {
    if (!questOrder || !questOrder.length) {
      return [...questRows].sort((a, b) => b.owners.length - a.owners.length)
    }
    const orderMap = new Map(questOrder.map((id, i) => [id, i]))
    return [...questRows].sort((a, b) => {
      const ai = orderMap.has(a.task.id) ? orderMap.get(a.task.id) : Infinity
      const bi = orderMap.has(b.task.id) ? orderMap.get(b.task.id) : Infinity
      return ai - bi
    })
  }, [questRows, questOrder])

  // Split into active, skipped, completed
  const activeRows    = sortedRows.filter(r => !r.completed && !skipped.has(r.task.id))
  const skippedRows   = sortedRows.filter(r => !r.completed && skipped.has(r.task.id))
  const completedRows = sortedRows.filter(r => r.completed)

  function handleObjDragOver(e, key) {
    e.preventDefault()
    if (key !== dragObjKey) setDragOverObjKey(key)
  }

  function handleObjDrop(e, targetKey) {
    e.preventDefault()
    if (!dragObjKey || dragObjKey === targetKey) { setDragObjKey(null); setDragOverObjKey(null); return }
    const keys = sortedObjRows.map(r => objectiveOrderKey(r.task.id, r.obj.id))
    const fromIdx = keys.indexOf(dragObjKey)
    const toIdx   = keys.indexOf(targetKey)
    keys.splice(fromIdx, 1)
    keys.splice(toIdx, 0, dragObjKey)
    setObjOrder(keys)
    setDragObjKey(null); setDragOverObjKey(null)
  }

  function sendObjToTop(key) {
    const keys = sortedObjRows.map(r => objectiveOrderKey(r.task.id, r.obj.id))
    const idx = keys.indexOf(key)
    if (idx <= 0) return
    keys.splice(idx, 1)
    keys.unshift(key)
    setObjOrder(keys)
  }

  function handleObjDragEnd() {
    setDragObjKey(null); setDragOverObjKey(null)
  }

  function applyFilter(rows) {
    return rows.filter(row => {
      if (kappaOnly && !row.task.kappaRequired) return false
      if (filter === 'starred') return row.starred
      if (filter === 'everyone') return row.owners.length > 1
      if (members.includes(filter)) return row.owners.includes(filter)
      return true
    })
  }

  const filteredActive    = applyFilter(activeRows)
  const filteredSkipped   = applyFilter(skippedRows)
  const filteredCompleted = applyFilter(completedRows)

  // Flat list of map-specific objectives for the objectives view
  const objectiveRows = filteredActive
    .flatMap(r => r.objs
      .filter(obj => objectiveHasMapLocation(obj, r.task, mapNorm))
      .map(obj => ({
      obj, task: r.task, owners: r.owners,
      doneByMembers: r.owners.filter(m => progress?.[objectiveProgressKey(r.task.id, obj.id, memberIdsByName.get(m))]),
      })))
    .filter(row => row.obj.type !== 'giveItem' && row.obj.type !== 'giveQuestItem')

  const sortedObjRows = (() => {
    const isDone = r => r.doneByMembers.length === r.owners.length && r.owners.length > 0
    if (!objOrder.length) return [...objectiveRows].sort((a, b) => isDone(a) - isDone(b) || b.owners.length - a.owners.length)
    const orderMap = new Map(objOrder.map((k, i) => [k, i]))
    return [...objectiveRows].sort((a, b) => {
      const aDone = isDone(a)
      const bDone = isDone(b)
      if (aDone !== bDone) return aDone - bDone
      const ak = objectiveOrderKey(a.task.id, a.obj.id)
      const bk = objectiveOrderKey(b.task.id, b.obj.id)
      const ai = orderMap.has(ak) ? orderMap.get(ak) : Infinity
      const bi = orderMap.has(bk) ? orderMap.get(bk) : Infinity
      return ai - bi
    })
  })()

  const totalObjs = activeRows.reduce((s, r) => s + r.objs.length, 0)
  const doneObjs  = activeRows.reduce((s, r) => s + r.doneCount, 0)
  const pctDone   = totalObjs ? Math.round((doneObjs / totalObjs) * 100) : 0

  if (!questRows.length) return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txd)', letterSpacing: '.1em' }}>NO QUESTS SELECTED</div>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--txd)', marginTop: 8 }}>ADD QUESTS IN THE QUESTS TAB TO BUILD YOUR TODO LIST</div>
    </div>
  )

  const sharedCardProps = {
    onToggleExpand: handleToggleExpand,
    onToggleStar,
    onSkip: handleSkip,
    members,
    progress,
    memberIdsByName,
  }

  return (
    <div>
      {/* Header + overall progress */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div>
            <h3 style={{ fontSize: 18, color: 'var(--goldtx)', lineHeight: 1 }}>SQUAD OBJECTIVES</h3>
            <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)', letterSpacing: '.1em', marginTop: 3 }}>PARTY-WIDE VIEW</div>
          </div>
          <span className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txm)' }}>
            {doneObjs}/{totalObjs} DONE · {pctDone}%
          </span>
        </div>
        <div style={{ height: 3, background: 'var(--brd)', borderRadius: 2 }}>
          <div style={{
            height: '100%', width: `${pctDone}%`,
            background: pctDone === 100 ? 'var(--grn)' : 'var(--gold)',
            borderRadius: 2, transition: 'width .4s',
          }} />
        </div>
      </div>

      {/* View mode toggle */}
      <div className="obj-scope-toggle">
        <button
          type="button"
          className={viewMode === 'objectives' ? 'obj-scope-btn is-active' : 'obj-scope-btn'}
          aria-pressed={viewMode === 'objectives'}
          onClick={() => setViewMode('objectives')}>
          MAP OBJECTIVES
        </button>
        <button
          type="button"
          className={viewMode === 'quests' ? 'obj-scope-btn is-active' : 'obj-scope-btn'}
          aria-pressed={viewMode === 'quests'}
          onClick={() => setViewMode('quests')}>
          QUESTS
        </button>
      </div>

      {/* Filter bar */}
      <div className="obj-filter-bar">
        <button onClick={() => setFilter('all')} className={filter === 'all' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}>ALL</button>
        <button onClick={() => setFilter('starred')}
          className={filter === 'starred' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
          style={{ color: filter !== 'starred' ? 'var(--gold)' : undefined }}>
          ★ STARRED
        </button>
        <button
          onClick={() => setKappaOnly(v => !v)}
          className={kappaOnly ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
          style={{ color: !kappaOnly ? 'var(--gold)' : undefined }}
          title="Show only Kappa-required quests">
          κ KAPPA
        </button>
        {members.length > 1 && (
          <button
            onClick={() => setFilter(f => f === 'everyone' ? 'all' : 'everyone')}
            className={filter === 'everyone' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
            title="Show only quests shared by multiple party members">
            EVERYONE
          </button>
        )}
        {members.map(m => {
          const c = memberColor(m, members)
          const active = filter === m
          return (
            <button
              key={m}
              type="button"
              className="obj-filter-member"
              aria-pressed={active}
              onClick={() => setFilter(active ? 'all' : m)}
              style={active ? { background: c.bg, borderColor: c.border, color: c.text } : undefined}
            >
              <span className="obj-filter-member-rail" style={{ background: c.text }} aria-hidden="true" />
              {m.slice(0, 10).toUpperCase()}
            </button>
          )
        })}
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)', color: 'var(--txd)' }}>
          {viewMode === 'objectives'
            ? `${objectiveRows.length} OBJ${objectiveRows.length !== 1 ? 'S' : ''}`
            : `${filteredActive.length + filteredSkipped.length} QUEST${filteredActive.length + filteredSkipped.length !== 1 ? 'S' : ''}`}
        </span>
      </div>

      {/* Objectives view */}
      {viewMode === 'objectives' && (
        !mapNorm ? (
          <div style={{ textAlign: 'center', padding: '40px 24px' }}>
            <div className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txd)', letterSpacing: '.1em' }}>SELECT A MAP</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--txd)', marginTop: 8 }}>MAP-SPECIFIC OBJECTIVES WILL APPEAR HERE</div>
          </div>
        ) : objectiveRows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 24px' }}>
            <div className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txd)', letterSpacing: '.1em' }}>NO MAP-LOCATED OBJECTIVES</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--txd)', marginTop: 8 }}>NO FILTERED QUESTS HAVE OBJECTIVES WITH MAP LOCATIONS</div>
          </div>
        ) : (
          <div className="obj-rows">
            {sortedObjRows.map((row, idx) => {
              const key = objectiveOrderKey(row.task.id, row.obj.id)
              const isDraggingThis = dragObjKey === key
              const isDragOverThis = dragOverObjKey === key
              const allOwnersDone = row.doneByMembers.length === row.owners.length && row.owners.length > 0
              const rail = allOwnersDone ? 'var(--grn)' : questRailColor(row.task.id)
              const isTop = sortedObjRows[0] && objectiveOrderKey(sortedObjRows[0].task.id, sortedObjRows[0].obj.id) === key
              const wiki = toAntifandom(row.task.wikiLink)
              return (
                <div
                  key={key}
                  className={`obj-row${isDragOverThis ? ' is-drop-target' : ''}${allOwnersDone ? ' is-done' : ''}${isDraggingThis ? ' is-dragging' : ''}`}
                  data-stripe={idx % 2 === 0 ? 'odd' : 'even'}
                  style={{ borderLeftColor: rail }}
                  draggable
                  onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragObjKey(key) }}
                  onDragOver={e => handleObjDragOver(e, key)}
                  onDrop={e => handleObjDrop(e, key)}
                  onDragEnd={handleObjDragEnd}
                >
                  {/* Send to top */}
                  <button
                    type="button"
                    className={isTop ? 'obj-row-promote is-top' : 'obj-row-promote'}
                    onClick={e => { e.stopPropagation(); sendObjToTop(key) }}
                    title="Send to top"
                    aria-label={`Send ${row.obj.description} to top`}
                  >&#8593;</button>

                  {/* Drag grip */}
                  <span
                    className="obj-row-grip"
                    title="Drag to reorder"
                    aria-hidden="true"
                    onClick={e => e.stopPropagation()}
                  >&#10303;</span>

                  <div className="obj-row-body">
                    <div className="obj-row-desc">
                      {wiki ? (
                        <a href={`${wiki}#Objectives`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                          {row.obj.description}
                        </a>
                      ) : row.obj.description}
                    </div>
                    <div className="obj-row-meta">
                      <span className="mono obj-pill obj-pill-quest" title={row.task.name}>
                        <span className="obj-pill-swatch" style={{ background: questRailColor(row.task.id) }} aria-hidden="true" />
                        {wiki ? (
                          <a href={wiki} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{row.task.name}</a>
                        ) : row.task.name}
                      </span>
                      <span className="mono obj-pill">{objectiveTypeLabel(row.obj.type)}</span>
                      {row.owners.length > 1 && (
                        <span className="mono obj-pill obj-pill-shared" title={`${row.owners.length} party members need this objective`}>
                          &times;{row.owners.length} SHARED
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Member completion chips */}
                  <div className="obj-row-owners">
                    {row.owners.map(m => (
                      <MemberPill key={m} name={m} allMembers={members} done={row.doneByMembers.includes(m)} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* Map-specific quest rows */}
      {viewMode === 'quests' && (() => {
        const mapActive   = filteredActive.filter(r => r.isMapSpecific)
        const anyActive   = filteredActive.filter(r => !r.isMapSpecific)
        const mapSkipped  = filteredSkipped.filter(r => r.isMapSpecific)
        const anySkipped  = filteredSkipped.filter(r => !r.isMapSpecific)

        return (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {mapActive.map(row => (
                <QuestCard key={row.task.id} {...row} dimmed={false} isOpen={expanded[row.task.id] || false} {...sharedCardProps} />
              ))}
            </div>

            {filteredActive.length === 0 && filteredSkipped.length === 0 && filteredCompleted.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <div className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txd)' }}>NO QUESTS MATCH THIS FILTER</div>
              </div>
            )}

            {/* Skipped — map-specific */}
            {mapSkipped.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)', letterSpacing: '.1em', marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--brd)' }}>
                  ⊘ SKIPPED ({mapSkipped.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {mapSkipped.map(row => (
                    <QuestCard key={row.task.id} {...row} dimmed={true} isOpen={expanded[row.task.id] || false} {...sharedCardProps} />
                  ))}
                </div>
              </div>
            )}

            {/* Any-map section */}
            {(anyActive.length > 0 || anySkipped.length > 0) && (
              <div style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--brd)' }}>
                  <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txm)', letterSpacing: '.1em' }}>
                    ◆ NON-MAP SPECIFIC ({anyActive.length + anySkipped.length})
                  </div>
                  <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)', letterSpacing: '.06em' }}>
                    — CAN BE DONE ON ANY MAP
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {anyActive.map(row => (
                    <QuestCard key={row.task.id} {...row} dimmed={false} isOpen={expanded[row.task.id] || false} {...sharedCardProps} />
                  ))}
                </div>
                {anySkipped.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)', letterSpacing: '.1em', marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--brd)' }}>
                      ⊘ SKIPPED ({anySkipped.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {anySkipped.map(row => (
                        <QuestCard key={row.task.id} {...row} dimmed={true} isOpen={expanded[row.task.id] || false} {...sharedCardProps} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )
      })()}

      {/* Completed section */}
      {viewMode === 'quests' && filteredCompleted.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--grn)', letterSpacing: '.1em', marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--brd)' }}>
            ✓ COMPLETED ({filteredCompleted.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filteredCompleted.map(row => (
              <QuestCard key={row.task.id} {...row} dimmed={false} isOpen={expanded[row.task.id] || false} {...sharedCardProps} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
