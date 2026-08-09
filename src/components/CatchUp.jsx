import { useEffect, useMemo, useRef, useState } from 'react'
import { buildQuestGraph, impliedComplete, tasksByTrader, unlockedFrom } from '../questGraph'

function storageKey(userId) {
  return userId ? `tsp.catchup.picks.${userId}` : null
}

function readPicks(userId) {
  const key = storageKey(userId)
  if (!key) return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, taskId]) => typeof taskId === 'string'))
  } catch {
    return {}
  }
}

function taskMapName(task) {
  return task.map?.normalizedName
    ? task.map.normalizedName.replace(/-/g, ' ').toUpperCase()
    : 'ANY MAP'
}

export default function CatchUp({ allTasks, userQuests, onBulkAdd, userId }) {
  const [open, setOpen] = useState(false)
  const [picks, setPicks] = useState(() => readPicks(userId))
  const [maxLevel, setMaxLevel] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const previousAvailableIds = useRef(new Set())

  const graph = useMemo(() => buildQuestGraph(allTasks), [allTasks])
  const groups = useMemo(() => tasksByTrader(graph), [graph])
  const savedIds = useMemo(() => new Set(userQuests.map(quest => quest.quest_id)), [userQuests])
  const pickedIds = useMemo(() => Object.values(picks), [picks])
  const implied = useMemo(() => impliedComplete(graph, pickedIds), [graph, pickedIds])
  const maxLevelValue = maxLevel === '' ? undefined : Number(maxLevel)
  const available = useMemo(() => {
    return unlockedFrom(graph, implied, { maxLevel: maxLevelValue })
      .filter(task => !savedIds.has(task.id))
  }, [graph, implied, maxLevelValue, savedIds])
  const selectedTasks = useMemo(
    () => available.filter(task => selectedIds.has(task.id)),
    [available, selectedIds],
  )
  const graphReady = useMemo(
    () => allTasks.some(task => Array.isArray(task.taskRequirements) && task.taskRequirements.length > 0),
    [allTasks],
  )

  useEffect(() => {
    setPicks(readPicks(userId))
    previousAvailableIds.current = new Set()
    setSelectedIds(new Set())
  }, [userId])

  useEffect(() => {
    const key = storageKey(userId)
    if (!key) return
    try {
      localStorage.setItem(key, JSON.stringify(picks))
    } catch {
      // Storage is an optional convenience; the panel remains usable without it.
    }
  }, [picks, userId])

  useEffect(() => {
    const availableIds = new Set(available.map(task => task.id))
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => availableIds.has(id)))
      for (const id of availableIds) {
        if (!previousAvailableIds.current.has(id)) next.add(id)
      }
      return next
    })
    previousAvailableIds.current = availableIds
  }, [available])

  function handlePick(trader, taskId) {
    setPicks(prev => {
      const next = { ...prev }
      if (taskId) next[trader] = taskId
      else delete next[trader]
      return next
    })
  }

  function toggleSelected(taskId) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  function reset() {
    setPicks({})
  }

  function confirm() {
    if (selectedTasks.length === 0) return
    onBulkAdd(selectedTasks.map(task => ({
      id: task.id,
      name: task.name,
      mapNorm: task.map?.normalizedName ?? null,
    })))
    setOpen(false)
  }

  if (!graphReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn-ghost btn-sm"
          disabled
          style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 5, opacity: .55 }}
        >
          <span style={{ fontSize: 14 }}>⊕</span> CATCH ME UP
        </button>
        <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>
          QUEST PREREQUISITE DATA NOT LOADED YET
        </span>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        className="btn-ghost btn-sm"
        onClick={() => setOpen(true)}
        style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}
      >
        <span style={{ fontSize: 14 }}>⊕</span> CATCH ME UP
      </button>
    )
  }

  return (
    <div className="card" style={{ flex: '1 1 100%', padding: 16, marginBottom: 16, border: '1px solid var(--golddim)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div className="lbl" style={{ color: 'var(--gold)' }}>CATCH ME UP</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--txm)', marginTop: 2 }}>
            PICK THE LAST QUEST YOU FINISHED FOR EACH TRADER — WE&apos;LL WORK OUT THE REST
          </div>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close catch-up"
          style={{ background: 'none', border: 'none', color: 'var(--txd)', fontSize: 18, cursor: 'pointer', padding: 0 }}
        >×</button>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label className="mono" style={{ display: 'block', fontSize: 10, color: 'var(--txm)', marginBottom: 5 }}>
          PMC LEVEL (OPTIONAL)
        </label>
        <input
          type="number"
          min="1"
          max="79"
          value={maxLevel}
          onChange={event => setMaxLevel(event.target.value)}
          placeholder=""
          style={{ maxWidth: 120 }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 14 }}>
        {groups.map(group => {
          const traderTasks = group.tasks.filter(task => !savedIds.has(task.id))
          return (
            <label key={group.trader} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, .28fr) minmax(0, 1fr)', alignItems: 'center', gap: 8 }}>
              <span className="mono" style={{ fontSize: 10, color: 'var(--txm)' }}>{group.trader}</span>
              <select value={picks[group.trader] || ''} onChange={event => handlePick(group.trader, event.target.value)}>
                <option value="">— HAVEN&apos;T STARTED —</option>
                {traderTasks.map(task => <option key={task.id} value={task.id}>{task.name}</option>)}
              </select>
            </label>
          )
        })}
      </div>

      <div className="mono" style={{ fontSize: 10, color: 'var(--gold)', marginBottom: 8 }}>
        {implied.size} QUEST{implied.size === 1 ? '' : 'S'} IMPLIED COMPLETE · {available.length} AVAILABLE NOW
      </div>

      {available.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12, maxHeight: 420, overflowY: 'auto' }}>
          {available.map(task => {
            const selected = selectedIds.has(task.id)
            return (
              <label key={task.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                background: 'var(--sur2)',
                border: `1px solid ${selected ? 'var(--golddim)' : 'var(--brd)'}`,
                borderLeft: `3px solid ${selected ? 'var(--gold)' : 'var(--brd)'}`,
                borderRadius: 4, cursor: 'pointer', boxSizing: 'border-box', width: '100%',
              }}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleSelected(task.id)}
                  style={{ accentColor: 'var(--gold)', cursor: 'pointer', flexShrink: 0, width: 14, height: 14 }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: '#e8e0cc' }}>{task.name}</span>
                  <span className="mono" style={{ fontSize: 10, color: '#7a8070' }}>
                    {task.trader?.name || task.trader || 'UNKNOWN TRADER'} · Lv.{task.minPlayerLevel || 1} · {taskMapName(task)}
                  </span>
                </div>
              </label>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn-gold btn-sm"
          onClick={confirm}
          disabled={selectedTasks.length === 0}
          style={{ fontSize: 12, opacity: selectedTasks.length === 0 ? .4 : 1 }}
        >
          ADD {selectedTasks.length} QUEST{selectedTasks.length === 1 ? '' : 'S'}
        </button>
        <button className="btn-ghost btn-sm" onClick={reset} style={{ fontSize: 12 }}>RESET</button>
      </div>
    </div>
  )
}
