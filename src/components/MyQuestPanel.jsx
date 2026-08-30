import { useState, useMemo, useEffect } from 'react'
import { objectiveProgressKey, questDoneKey } from '../partyMembers'
import { objectiveIsOnMap, objectiveTypeLabel, traderGateLabel } from '../tarkovObjectives'
import { classifyObjective, classifyTask } from '../questShare'
import { useQuestShareOverrides } from '../useQuestShareOverrides'
import { questRailColor } from '../questColors'
import { mapReferenceArt } from '../mapBanners'
import Icon from './Icon'


// Shown when this map has nothing left for the player but their list is not
// empty — the map art keeps the panel from reading as an error.
function NothingElseHere({ mapNorm, mapLabel, onOpenQuestManager }) {
  const art = mapReferenceArt(mapNorm)
  return (
    <div className="quest-empty-card">
      <div className="quest-empty-art" style={art ? { backgroundImage: `url('${art}')` } : undefined} aria-hidden="true" />
      <div className="quest-empty-scrim" aria-hidden="true" />
      <div className="quest-empty-copy">
        <div className="mono quest-empty-title">NOTHING ELSE ON {mapLabel}</div>
        <p className="quest-empty-note">Your remaining quests sit on other maps. Import a fresh quest log or pull one from the manager.</p>
        <div>
          <button type="button" className="quest-empty-action" onClick={onOpenQuestManager}>
            <Icon name="star" size="sm" /> QUEST MANAGER
          </button>
        </div>
      </div>
    </div>
  )
}


function objsForMap(task, mapNorm) {
  const objectives = task?.objectives
  return (objectives || []).filter(o => {
    if (o.optional || o.type === 'giveItem' || o.type === 'giveQuestItem') return false
    if (!mapNorm) return true
    return objectiveIsOnMap(o, task, mapNorm)
  })
}

export default function MyQuestPanel({ myQuests, tasks, progress, userObjProgress, myUserId, myName, onSubmit, onQuestComplete, onOpenQuestManager, mapNorm, mapName, loading, settings = {}, onSetSetting }) {
  const [pending, setPending] = useState({}) // key → boolean (unsaved local changes)
  const { overrides } = useQuestShareOverrides()

  const [questOrder, setQuestOrder] = useState(() => {
    const saved = myUserId ? settings.quest_order?.[myUserId] : null
    if (saved && Array.isArray(saved)) return saved
    return myQuests.map(q => q.id)
  })

  // Persist order through the user-settings abstraction whenever it changes.
  useEffect(() => {
    if (!myUserId || !onSetSetting) return
    onSetSetting('quest_order', { ...(settings.quest_order || {}), [myUserId]: questOrder })
  }, [questOrder, myUserId, onSetSetting]) // settings is read from the latest callback closure

  // Sync questOrder when myQuests changes — new quests bubble to front
  useEffect(() => {
    setQuestOrder(prev => {
      const currentIds = new Set(myQuests.map(q => q.id))
      const cleaned = prev.filter(id => currentIds.has(id))
      const existingSet = new Set(cleaned)
      const newIds = myQuests.filter(q => !existingSet.has(q.id)).map(q => q.id)
      return [...newIds, ...cleaned]
    })
  }, [myQuests])

  function getEffective(key) {
    if (pending[key] !== undefined) return pending[key]
    if (progress?.[key] !== undefined) return progress[key]
    return userObjProgress?.[key] || false
  }

  function toggleObj(taskId, objId) {
    const key = objectiveProgressKey(taskId, objId, myUserId)
    setPending(p => ({ ...p, [key]: !getEffective(key) }))
  }

  function toggleDone(questId) {
    const key = questDoneKey(questId, myUserId)
    setPending(p => ({ ...p, [key]: !getEffective(key) }))
  }

  const pendingCount = Object.keys(pending).length
  const hasPending = pendingCount > 0

  function handleSubmit() {
    onSubmit({ ...pending })
    // Find quests that are now complete (done button OR all objectives checked)
    rows.forEach(({ task, objs }) => {
      const doneKey = questDoneKey(task.id, myUserId)
      const effectiveDone = pending[doneKey] !== undefined ? pending[doneKey] : (progress?.[doneKey] || false)
      const allObjsDone = objs.length > 0 && objs.every(o => {
        const k = objectiveProgressKey(task.id, o.id, myUserId)
        return pending[k] !== undefined ? pending[k] : (progress?.[k] || false)
      })
      if (effectiveDone || allObjsDone) onQuestComplete?.(task.id)
    })
    setPending({})
  }

  const rows = useMemo(() => {
    const byOrder = (a, b) => {
      const ai = questOrder.indexOf(a.task.id), bi = questOrder.indexOf(b.task.id)
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1; if (bi === -1) return -1
      return ai - bi
    }
    const mapped = myQuests
      .map(q => {
        const matchedTask = tasks.find(t => t.id === q.id)
        // `tasks` is already scoped to the selected map. If a quest is absent
        // from that list, it belongs on another map; do not turn it into an
        // objective-less placeholder card. Keep the fallback only for the
        // unscoped view, where genuinely incomplete imported data is useful.
        if (mapNorm && !matchedTask) return null
        const task = matchedTask || {
          id: q.id,
          name: q.name || q.id,
          objectives: [],
          trader: null,
          incompleteData: true,
        }
        const objs = objsForMap(task, mapNorm)
        // If a map is selected, hide quests with non-optional objectives but none on this map
        if (mapNorm) {
          const allObjs = (task.objectives || []).filter(o => !o.optional)
          if (allObjs.length > 0 && objs.length === 0) return null
        }
        const isMapSpecific = mapNorm
          ? (task.objectives || []).some(o => !o.optional && o.maps && o.maps.length > 0)
          : false
        const doneKey = questDoneKey(task.id, myUserId)
        const isDone = pending[doneKey] !== undefined ? pending[doneKey] : (progress?.[doneKey] || false)
        const doneObjCount = objs.filter(o => {
          const k = objectiveProgressKey(task.id, o.id, myUserId)
          return pending[k] !== undefined ? pending[k] : (progress?.[k] || false)
        }).length
        const allObjsDone = objs.length > 0 && doneObjCount === objs.length
        const isComplete = isDone || allObjsDone
        return { task, objs, isMapSpecific, isComplete }
      })
      .filter(Boolean)
    // Sort: map-specific incomplete → any-map incomplete → map-specific complete → any-map complete
    // Within each section, respect questOrder (most recently added first)
    return [
      ...mapped.filter(r => r.isMapSpecific && !r.isComplete).sort(byOrder),
      ...mapped.filter(r => !r.isMapSpecific && !r.isComplete).sort(byOrder),
      ...mapped.filter(r => r.isMapSpecific && r.isComplete).sort(byOrder),
      ...mapped.filter(r => !r.isMapSpecific && r.isComplete).sort(byOrder),
    ]
  }, [myQuests, tasks, mapNorm, pending, progress, myUserId, questOrder])

  function moveToTop(questId, sectionRows) {
    setQuestOrder(prev => {
      const sectionIds = sectionRows.map(r => r.task.id)
      const newOrder = prev.filter(id => id !== questId)
      const firstId = sectionIds.find(id => id !== questId)
      if (!firstId) return [questId, ...newOrder]
      const firstIdx = newOrder.indexOf(firstId)
      if (firstIdx === -1) return [questId, ...newOrder]
      newOrder.splice(firstIdx, 0, questId)
      return newOrder
    })
  }

  function moveToBottom(questId, sectionRows) {
    setQuestOrder(prev => {
      const sectionIds = sectionRows.map(r => r.task.id)
      const newOrder = prev.filter(id => id !== questId)
      const lastId = [...sectionIds].reverse().find(id => id !== questId)
      if (!lastId) return [...newOrder, questId]
      const lastIdx = newOrder.indexOf(lastId)
      if (lastIdx === -1) return [...newOrder, questId]
      newOrder.splice(lastIdx + 1, 0, questId)
      return newOrder
    })
  }

  const mapLabel = (mapName || mapNorm || 'THIS MAP').toUpperCase()

  if (!rows.length) {
    const hasAnyQuests = myQuests.length > 0
    if (!hasAnyQuests && loading) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '32px 24px', justifyContent: 'center' }}>
          <div style={{ width: 20, height: 20, border: '2px solid var(--brd)', borderTop: '2px solid var(--gold)', borderRadius: '50%', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
          <span className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txm)' }}>SYNCING...</span>
        </div>
      )
    }
    if (hasAnyQuests) {
      return <NothingElseHere mapNorm={mapNorm} mapLabel={mapLabel} onOpenQuestManager={onOpenQuestManager} />
    }
    return (
      <div>
        <div style={{ textAlign: 'center', padding: '40px 24px' }}>
        <div className="mono" style={{ fontSize: 13, color: 'var(--goldtx)', letterSpacing: '.1em', marginBottom: 10 }}>NO QUESTS ADDED</div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--txm)', lineHeight: 1.7 }}>
          Import your quest list to fill this out.
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
            <button onClick={onOpenQuestManager} className="btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--gold)', borderColor: 'var(--golddim)' }}>
              <Icon name="star" size="sm" /> QUEST MANAGER
            </button>
          </div>
        </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--goldtx)', fontWeight: 700, letterSpacing: '.08em' }}>
            MY QUESTS
          </div>
          <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)', marginTop: 2, letterSpacing: '.1em' }}>
            {myName.toUpperCase()} · PERSONAL VIEW
          </div>
        </div>
        <button
          onClick={handleSubmit}
          disabled={!hasPending}
          className={hasPending ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
          style={{ fontSize: 'var(--fs-sm)', opacity: hasPending ? 1 : 0.35, transition: 'opacity .2s' }}
        >
          ▲ SUBMIT{hasPending ? ` (${pendingCount})` : ''}
        </button>
      </div>

      {/* Quest list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(({ task, objs, isMapSpecific, isComplete }, idx) => {
          const prev = idx > 0 ? rows[idx - 1] : null
          const showAnyMapDivider = mapNorm && !isMapSpecific && !isComplete && (!prev || prev.isMapSpecific || prev.isComplete) && rows.some(r => r.isMapSpecific)
          const showCompletedDivider = isComplete && (!prev || !prev.isComplete)
          const doneKey = questDoneKey(task.id, myUserId)
          const isDone = getEffective(doneKey)
          const isPendingDone = pending[doneKey] !== undefined
          const doneObjCount = objs.filter(o => getEffective(objectiveProgressKey(task.id, o.id, myUserId))).length
          const allObjsDone = objs.length > 0 && doneObjCount === objs.length
          // Section peers for move-to-top/bottom (same isMapSpecific + isComplete group)
          const sectionRows = rows.filter(r => r.isMapSpecific === isMapSpecific && r.isComplete === isComplete)
          const sectionIdx = sectionRows.findIndex(r => r.task.id === task.id)
          const taskShare = classifyTask(task, overrides)
          const loyalty = traderGateLabel(task)

          return (
            <div key={task.id}>
            {showAnyMapDivider && (
              <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)', letterSpacing: '.1em', paddingBottom: 5, marginBottom: 2, borderBottom: '1px solid var(--brd)' }}>
                ◆ ANY MAP
              </div>
            )}
            {showCompletedDivider && (
              <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)', letterSpacing: '.1em', paddingBottom: 5, marginBottom: 2, borderBottom: '1px solid var(--brd)' }}>
                ✓ COMPLETED
              </div>
            )}
            <div style={{
              background: 'var(--sur2)',
              border: `1px solid ${isDone || allObjsDone ? 'rgba(90,200,90,0.25)' : isPendingDone ? 'var(--golddim)' : 'var(--brd)'}`,
              borderLeft: `3px solid ${isDone || allObjsDone ? 'var(--grn)' : isPendingDone ? 'var(--gold)' : questRailColor(task.id)}`,
              borderRadius: 4,
              opacity: isDone ? 0.5 : 1,
              transition: 'opacity .2s, border-color .15s',
            }}>
              {/* Quest header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                borderBottom: objs.length && !isDone ? '1px solid var(--brd)' : 'none',
              }}>
                {task.trader?.imageLink
                  ? <img src={task.trader.imageLink} alt={task.trader.name} title={task.trader.name} style={{ width: 28, height: 28, borderRadius: 3, objectFit: 'cover', flexShrink: 0, opacity: isDone ? 0.4 : 1, border: '1px solid var(--brd)' }} />
                  : <span className="quest-card-trader-slot" aria-hidden="true" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 'var(--fs-sm)', fontWeight: 600,
                    color: isDone ? 'var(--txd)' : 'var(--tx)',
                    textDecoration: isDone ? 'line-through' : 'none',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {task.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    {task.kappaRequired && (
                      <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--gold)' }}>κ KAPPA</span>
                    )}
                    {taskShare === 'shared' && (
                      <span className="quest-share-badge" title="Shareability is inferred from the objective type; the game does not publish this verdict.">SQUAD</span>
                    )}
                    {objs.length > 0 && (
                      <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: isDone || allObjsDone ? 'var(--grn)' : 'var(--txd)' }}>
                        {doneObjCount}/{objs.length} OBJ
                      </span>
                    )}
                    {loyalty && <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txm)' }}>{loyalty}</span>}
                  </div>
                </div>
                {/* Move to top / bottom within section */}
                {sectionRows.length > 1 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
                    <button
                      onClick={() => moveToTop(task.id, sectionRows)}
                      title="Move to top"
                      aria-label={`Move ${task.name} to top`}
                      disabled={sectionIdx === 0}
                      style={{
                        background: 'none', border: 'none', padding: '1px 4px',
                        cursor: sectionIdx === 0 ? 'default' : 'pointer',
                        fontSize: 'var(--fs-xs)', lineHeight: 1,
                        color: sectionIdx === 0 ? 'var(--brd2)' : 'var(--txd)',
                        transition: 'color .15s',
                      }}>▲</button>
                    <button
                      onClick={() => moveToBottom(task.id, sectionRows)}
                      title="Move to bottom"
                      aria-label={`Move ${task.name} to bottom`}
                      disabled={sectionIdx === sectionRows.length - 1}
                      style={{
                        background: 'none', border: 'none', padding: '1px 4px',
                        cursor: sectionIdx === sectionRows.length - 1 ? 'default' : 'pointer',
                        fontSize: 'var(--fs-xs)', lineHeight: 1,
                        color: sectionIdx === sectionRows.length - 1 ? 'var(--brd2)' : 'var(--txd)',
                        transition: 'color .15s',
                      }}>▼</button>
                  </div>
                )}
                <button
                  onClick={() => toggleDone(task.id)}
                  aria-label={`${isDone ? 'Undo completion of' : 'Mark complete'} ${task.name}`}
                  style={{
                    background: 'none',
                    border: `1px solid ${isDone ? 'var(--grn)' : isPendingDone ? 'var(--golddim)' : 'var(--brd2)'}`,
                    borderRadius: 3, padding: '2px 8px', cursor: 'pointer',
                    fontSize: 'var(--fs-xs)', fontFamily: 'Share Tech Mono',
                    color: isDone ? 'var(--grn)' : isPendingDone ? 'var(--gold)' : 'var(--txd)',
                    letterSpacing: '.04em', flexShrink: 0, transition: 'all .15s',
                  }}
                >
                  {isDone ? 'UNDO' : '✓ DONE'}
                </button>
              </div>

              {/* Objectives */}
              {!isDone && objs.map((obj, i) => {
                const key = objectiveProgressKey(task.id, obj.id, myUserId)
                const checked = getEffective(key)
                const isPendingObj = pending[key] !== undefined
                const isLast = i === objs.length - 1

                return (
                  <div
                    key={obj.id}
                    onClick={() => toggleObj(task.id, obj.id)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 9,
                      padding: '5px 10px',
                      borderBottom: isLast ? 'none' : '1px solid var(--brd)',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Checkbox */}
                    <div style={{
                      width: 13, height: 13, flexShrink: 0, marginTop: 2,
                      border: `1px solid ${checked ? 'var(--grn)' : isPendingObj ? 'var(--gold)' : 'var(--brd2)'}`,
                      borderRadius: 3,
                      background: checked ? 'var(--grn)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all .15s',
                    }}>
                      {checked && <div style={{ width: 5, height: 5, background: 'var(--bg)', borderRadius: 1 }} />}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 'var(--fs-sm)', lineHeight: 1.4,
                        color: checked ? 'var(--txd)' : 'var(--tx)',
                        textDecoration: checked ? 'line-through' : 'none',
                      }}>
                        {obj.description}
                      </div>
                    </div>

                    <span className="mono" style={{
                      fontSize: 'var(--fs-xs)', flexShrink: 0, marginTop: 2, letterSpacing: '.06em',
                      color: checked ? 'var(--txd)' : 'var(--txm)',
                      background: 'var(--sur)', border: '1px solid var(--brd)',
                      borderRadius: 2, padding: '1px 4px',
                    }}>
                      {objectiveTypeLabel(obj.type)}
                    </span>
                    {classifyObjective(obj, task, overrides) === 'squad' && (
                      <span className="quest-share-badge" title="Shareability is inferred from the objective type; the game does not publish this verdict.">SQUAD</span>
                    )}
                  </div>
                )
              })}
            </div>
            </div>
          )
        })}
      </div>

      {mapNorm && rows.length < myQuests.length && (
        <NothingElseHere mapNorm={mapNorm} mapLabel={mapLabel} onOpenQuestManager={onOpenQuestManager} />
      )}

      {/* Pending banner */}
      {hasPending && (
        <div style={{
          marginTop: 10, padding: '7px 10px',
          background: 'rgba(201,168,76,0.06)', border: '1px solid var(--golddim)', borderRadius: 4,
        }}>
          <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--gold)', letterSpacing: '.04em' }}>
            {pendingCount} UNSAVED CHANGE{pendingCount !== 1 ? 'S' : ''} — HIT SUBMIT TO SHARE WITH PARTY
          </div>
        </div>
      )}
    </div>
  )
}
