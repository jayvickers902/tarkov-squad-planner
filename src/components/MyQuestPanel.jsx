import { useState, useMemo } from 'react'

const TYPE_LABEL = { location: 'LOCATE', item: 'FIND', mark: 'MARK', shoot: 'KILL', extract: 'EXTRACT', skill: 'SKILL' }

function objsForMap(objectives, mapNorm, taskMapNorm) {
  return (objectives || []).filter(o => {
    if (o.optional || o.type === 'giveItem' || o.type === 'giveQuestItem') return false
    if (!mapNorm) return true
    if (o.maps && o.maps.length > 0) return o.maps.some(m => m.normalizedName === mapNorm)
    if (taskMapNorm) return taskMapNorm === mapNorm
    return true
  })
}

export default function MyQuestPanel({ myQuests, tasks, progress, myName, onSubmit, mapNorm }) {
  const [pending, setPending] = useState({}) // key → boolean (unsaved local changes)

  function getEffective(key) {
    return pending[key] !== undefined ? pending[key] : (progress?.[key] || false)
  }

  function toggleObj(taskId, objId) {
    const key = `${taskId}::${objId}::${myName}`
    setPending(p => ({ ...p, [key]: !getEffective(key) }))
  }

  function toggleDone(questId) {
    const key = `__done__:${questId}::${myName}`
    setPending(p => ({ ...p, [key]: !getEffective(key) }))
  }

  const pendingCount = Object.keys(pending).length
  const hasPending = pendingCount > 0

  function handleSubmit() {
    onSubmit({ ...pending })
    setPending({})
  }

  const rows = useMemo(() => {
    const mapped = myQuests
      .map(q => {
        const task = tasks.find(t => t.id === q.id)
        if (!task) return null
        const objs = objsForMap(task.objectives, mapNorm, task.map?.normalizedName)
        // If a map is selected, hide quests with non-optional objectives but none on this map
        if (mapNorm) {
          const allObjs = (task.objectives || []).filter(o => !o.optional)
          if (allObjs.length > 0 && objs.length === 0) return null
        }
        const isMapSpecific = mapNorm
          ? (task.objectives || []).some(o => !o.optional && o.maps && o.maps.length > 0)
          : false
        return { task, objs, isMapSpecific }
      })
      .filter(Boolean)
    // Map-specific quests first, any-map quests at the bottom
    return [...mapped.filter(r => r.isMapSpecific), ...mapped.filter(r => !r.isMapSpecific)]
  }, [myQuests, tasks, mapNorm])

  if (!rows.length) {
    const hasAnyQuests = myQuests.length > 0
    return (
      <div style={{ textAlign: 'center', padding: '40px 12px' }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--txd)', letterSpacing: '.1em' }}>
          {hasAnyQuests ? 'NO QUESTS FOR THIS MAP' : 'NO QUESTS ADDED'}
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--txd)', marginTop: 6, lineHeight: 1.7 }}>
          {hasAnyQuests
            ? 'SELECT A DIFFERENT MAP OR ADD MORE QUESTS'
            : <>CLICK <span style={{ color: 'var(--gold)' }}>★ QUEST MANAGER</span> AT THE TOP TO IMPORT YOUR QUESTS</>
          }
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--goldtx)', fontWeight: 700, letterSpacing: '.08em' }}>
            MY QUESTS
          </div>
          <div className="mono" style={{ fontSize: 9, color: 'var(--txd)', marginTop: 2, letterSpacing: '.1em' }}>
            {myName.toUpperCase()} · PERSONAL VIEW
          </div>
        </div>
        <button
          onClick={handleSubmit}
          disabled={!hasPending}
          className={hasPending ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
          style={{ fontSize: 11, opacity: hasPending ? 1 : 0.35, transition: 'opacity .2s' }}
        >
          ▲ SUBMIT{hasPending ? ` (${pendingCount})` : ''}
        </button>
      </div>

      {/* Quest list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(({ task, objs, isMapSpecific }, idx) => {
          const prevMapSpecific = idx > 0 ? rows[idx - 1].isMapSpecific : true
          const showDivider = mapNorm && !isMapSpecific && prevMapSpecific && rows.some(r => r.isMapSpecific)
          const doneKey = `__done__:${task.id}::${myName}`
          const isDone = getEffective(doneKey)
          const isPendingDone = pending[doneKey] !== undefined
          const doneObjCount = objs.filter(o => getEffective(`${task.id}::${o.id}::${myName}`)).length
          const allObjsDone = objs.length > 0 && doneObjCount === objs.length

          return (
            <div key={task.id}>
            {showDivider && (
              <div className="mono" style={{ fontSize: 9, color: 'var(--txd)', letterSpacing: '.1em', paddingBottom: 5, marginBottom: 2, borderBottom: '1px solid var(--brd)' }}>
                ◆ ANY MAP
              </div>
            )}
            <div style={{
              background: 'var(--sur2)',
              border: `1px solid ${isDone || allObjsDone ? 'rgba(90,200,90,0.25)' : isPendingDone ? 'var(--golddim)' : 'var(--brd)'}`,
              borderLeft: `3px solid ${isDone || allObjsDone ? 'var(--grn)' : isPendingDone ? 'var(--gold)' : 'var(--brd)'}`,
              borderRadius: 4,
              opacity: isDone ? 0.5 : 1,
              transition: 'opacity .2s, border-color .15s',
            }}>
              {/* Quest header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                borderBottom: objs.length && !isDone ? '1px solid var(--brd)' : 'none',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600,
                    color: isDone ? 'var(--txd)' : 'var(--tx)',
                    textDecoration: isDone ? 'line-through' : 'none',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {task.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    {task.kappaRequired && (
                      <span className="mono" style={{ fontSize: 9, color: 'var(--gold)' }}>κ KAPPA</span>
                    )}
                    {objs.length > 0 && (
                      <span className="mono" style={{ fontSize: 9, color: isDone || allObjsDone ? 'var(--grn)' : 'var(--txd)' }}>
                        {doneObjCount}/{objs.length} OBJ
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => toggleDone(task.id)}
                  style={{
                    background: 'none',
                    border: `1px solid ${isDone ? 'var(--grn)' : isPendingDone ? 'var(--golddim)' : 'var(--brd2)'}`,
                    borderRadius: 3, padding: '2px 8px', cursor: 'pointer',
                    fontSize: 10, fontFamily: 'Share Tech Mono',
                    color: isDone ? 'var(--grn)' : isPendingDone ? 'var(--gold)' : 'var(--txd)',
                    letterSpacing: '.04em', flexShrink: 0, transition: 'all .15s',
                  }}
                >
                  {isDone ? 'UNDO' : '✓ DONE'}
                </button>
              </div>

              {/* Objectives */}
              {!isDone && objs.map((obj, i) => {
                const key = `${task.id}::${obj.id}::${myName}`
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
                        fontSize: 11, lineHeight: 1.4,
                        color: checked ? 'var(--txd)' : 'var(--tx)',
                        textDecoration: checked ? 'line-through' : 'none',
                      }}>
                        {obj.description}
                      </div>
                    </div>

                    <span className="mono" style={{
                      fontSize: 9, flexShrink: 0, marginTop: 2, letterSpacing: '.06em',
                      color: checked ? 'var(--txd)' : 'var(--txm)',
                      background: 'var(--sur)', border: '1px solid var(--brd)',
                      borderRadius: 2, padding: '1px 4px',
                    }}>
                      {TYPE_LABEL[obj.type] || obj.type?.toUpperCase() || '?'}
                    </span>
                  </div>
                )
              })}
            </div>
            </div>
          )
        })}
      </div>

      {/* Pending banner */}
      {hasPending && (
        <div style={{
          marginTop: 10, padding: '7px 10px',
          background: 'rgba(201,168,76,0.06)', border: '1px solid var(--golddim)', borderRadius: 4,
        }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--gold)', letterSpacing: '.04em' }}>
            {pendingCount} UNSAVED CHANGE{pendingCount !== 1 ? 'S' : ''} — HIT SUBMIT TO SHARE WITH PARTY
          </div>
        </div>
      )}
    </div>
  )
}
