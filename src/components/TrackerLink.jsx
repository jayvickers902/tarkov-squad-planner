import { useEffect, useMemo, useRef, useState } from 'react'
import { progressToImport } from '../tarkovTracker'
import { useTarkovTracker } from '../useTarkovTracker'
import { gameModeLabel } from '../gameMode'

function taskMapName(task) {
  return task?.map?.normalizedName
    ? task.map.normalizedName.replace(/-/g, ' ').toUpperCase()
    : 'ANY MAP'
}

function formatSynced(value) {
  if (!value) return 'NOT YET'
  try {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return 'RECENTLY'
  }
}

export default function TrackerLink({ userId, allTasks, userQuests, onBulkAdd, onMarkCompleted, gameMode, userSettings = {}, onSetGameMode }) {
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState('')
  const [linking, setLinking] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [confirmClear, setConfirmClear] = useState(false)
  const [modeNotice, setModeNotice] = useState('')
  const previousAvailableIds = useRef(new Set())
  const handledMode = useRef(null)
  const tracker = useTarkovTracker(userId)

  const importState = useMemo(
    () => tracker.progress ? progressToImport(tracker.progress, allTasks) : null,
    [tracker.progress, allTasks],
  )
  const savedIds = useMemo(() => new Set(userQuests.map(quest => quest.quest_id)), [userQuests])
  const available = useMemo(
    () => (importState?.available || []).filter(task => !savedIds.has(task.id)),
    [importState, savedIds],
  )
  const selectedTasks = useMemo(
    () => available.filter(task => selectedIds.has(task.id)),
    [available, selectedIds],
  )
  const completedInList = useMemo(() => {
    if (!importState) return []
    return userQuests.filter(quest => importState.complete.has(quest.quest_id))
  }, [importState, userQuests])
  const modeIsExplicit = Object.prototype.hasOwnProperty.call(userSettings, 'game_mode')
  const tokenModeMismatch = tracker.linked && tracker.mode && tracker.mode !== gameMode

  function tokenModeMismatchMessage() {
    const label = gameModeLabel(tracker.mode)
    const switchLabel = label === 'SEASON' ? 'Season' : label
    return `This token is a ${label} token. Switch to ${switchLabel}, or link the token for this mode.`
  }

  useEffect(() => {
    const availableIds = new Set(available.map(task => task.id))
    setSelectedIds(previous => {
      const next = new Set([...previous].filter(id => availableIds.has(id)))
      for (const id of availableIds) {
        if (!previousAvailableIds.current.has(id)) next.add(id)
      }
      return next
    })
    previousAvailableIds.current = availableIds
  }, [available])

  // A token is a mode assertion. Auto-resolve only when the user has never
  // explicitly chosen a mode; otherwise make the disagreement actionable.
  useEffect(() => {
    const handledKey = `${tracker.mode}:${gameMode}:${Boolean(onSetGameMode)}`
    if (!tracker.linked || !tracker.mode || handledMode.current === handledKey) return
    handledMode.current = handledKey
    if (gameMode === tracker.mode) return
    if (!modeIsExplicit && onSetGameMode) {
      onSetGameMode(tracker.mode)
      setModeNotice(`TOKEN MODE DETECTED — TASK DATA SWITCHED TO ${gameModeLabel(tracker.mode)}.`)
      return
    }
    setModeNotice(onSetGameMode
      ? `TOKEN REPORTS ${gameModeLabel(tracker.mode)}, BUT YOUR TASK MODE IS ${gameModeLabel(gameMode)}. CHOOSE WHICH DATASET TO USE.`
      : tokenModeMismatchMessage())
  }, [tracker.linked, tracker.mode, gameMode, modeIsExplicit, onSetGameMode])

  function toggleSelected(taskId) {
    setSelectedIds(previous => {
      const next = new Set(previous)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  async function handleLink(event) {
    event.preventDefault()
    const value = token.trim()
    if (!value || linking) return
    setLinking(true)
    await tracker.link(value)
    setToken('')
    setLinking(false)
  }

  function handleImport() {
    if (tokenModeMismatch) {
      setModeNotice(tokenModeMismatchMessage())
      return
    }
    if (!selectedTasks.length) return
    onBulkAdd(selectedTasks.map(task => ({
      id: task.id,
      name: task.name,
      mapNorm: task.map?.normalizedName || null,
    })))
    setSelectedIds(new Set())
    setOpen(false)
  }

  async function handleClearCompleted() {
    if (!completedInList.length || !onMarkCompleted) return
    await Promise.all(completedInList.map(task => onMarkCompleted(task.quest_id)))
    setConfirmClear(false)
  }

  function closePanel() {
    setToken('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        className="btn-ghost btn-sm"
        onClick={() => setOpen(true)}
        style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}
      >
        <span style={{ fontSize: 14 }}>↗</span> TARKOVTRACKER
      </button>
    )
  }

  return (
    <div className="card tracker-link-panel">
      <div className="tracker-link-head">
        <div>
          <div className="lbl" style={{ color: 'var(--gold)' }}>TARKOVTRACKER LINK</div>
          <div className="mono tracker-link-copy">READ-ONLY QUEST STATE · REVIEW BEFORE IMPORT</div>
        </div>
        <button className="tracker-link-close" onClick={closePanel} aria-label="Close TarkovTracker link">×</button>
      </div>

      {!tracker.linked ? (
        <>
          <p className="tracker-link-copy">
            Link the account that tracks your quests so completions stay current between raids. Your token is sent over the signed-in connection, stored on the server, and never persisted in this browser.
          </p>
          <form className="tracker-link-form" onSubmit={handleLink}>
            <label className="mono tracker-link-label" htmlFor="tarkovtracker-token">TARKOVTRACKER API TOKEN</label>
            <input
              id="tarkovtracker-token"
              type="password"
              value={token}
              onChange={event => setToken(event.target.value)}
              placeholder="PVP_… / PVE_… / SZN_…"
              autoComplete="off"
              spellCheck="false"
              disabled={linking || tracker.loading}
            />
            <div className="tracker-link-actions">
              <button className="btn-gold btn-sm" type="submit" disabled={!token.trim() || linking || tracker.loading}>
                {linking ? 'VERIFYING...' : 'LINK ACCOUNT'}
              </button>
              <a className="tracker-link-anchor mono" href="https://tarkovtracker.org/" target="_blank" rel="noreferrer">
                GET A TOKEN ↗
              </a>
            </div>
          </form>
          {tracker.loading && !tracker.error && <div className="mono tracker-link-muted">CHECKING FOR AN EXISTING LINK...</div>}
          {tracker.error && <div className="tracker-link-error mono">{tracker.error}</div>}
        </>
      ) : (
        <>
          <div className="tracker-link-status">
            <div>
              <div className="tracker-link-name">{tracker.displayName || 'LINKED OPERATOR'}</div>
              <div className="mono tracker-link-muted">
                LVL {tracker.playerLevel ?? '—'} · {gameModeLabel(tracker.mode)} · SYNCED {formatSynced(tracker.lastSyncedAt)}
              </div>
            </div>
            <div className="tracker-link-actions">
              <button className="btn-ghost btn-sm" onClick={() => tracker.refresh()} disabled={tracker.loading}>
                {tracker.loading ? 'SYNCING...' : 'REFRESH'}
              </button>
              <button className="btn-ghost btn-sm" onClick={() => tracker.unlink()} disabled={tracker.loading}>UNLINK</button>
            </div>
          </div>

          {modeNotice && (
            <div className="tracker-link-mode-note mono">
              {modeNotice}
              {tracker.mode !== gameMode && onSetGameMode && (
                <div className="tracker-link-actions">
                  <button className="btn-gold btn-sm" onClick={() => { onSetGameMode(tracker.mode); setModeNotice(`TASK DATA SET TO ${gameModeLabel(tracker.mode)}.`) }}>USE TOKEN MODE</button>
                  <button className="btn-ghost btn-sm" onClick={() => setModeNotice(`KEEPING ${gameModeLabel(gameMode)} TASK DATA.`)}>KEEP {gameModeLabel(gameMode)}</button>
                </div>
              )}
            </div>
          )}

          {tracker.error && <div className="tracker-link-error mono">{tracker.error}</div>}

          {importState ? (
            <>
              <div className="tracker-link-stats mono">
                <span>{available.length} READY TO REVIEW</span>
                <span>{importState.complete.size} ALREADY COMPLETE</span>
                <span>{importState.failed.size} FAILED</span>
              </div>

              {completedInList.length > 0 && onMarkCompleted && (
                <div className="tracker-link-reconcile">
                  {confirmClear ? (
                    <>
                      <span className="mono">CLEAR {completedInList.length} TRACKER-COMPLETE QUEST{completedInList.length === 1 ? '' : 'S'} FROM YOUR ACTIVE LIST?</span>
                      <div className="tracker-link-actions">
                        <button className="btn-danger btn-sm" onClick={handleClearCompleted}>YES, CLEAR</button>
                        <button className="btn-ghost btn-sm" onClick={() => setConfirmClear(false)}>CANCEL</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="mono">{completedInList.length} ACTIVE QUEST{completedInList.length === 1 ? '' : 'S'} ARE COMPLETE ON TRACKER.</span>
                      <button className="btn-ghost btn-sm" onClick={() => setConfirmClear(true)}>CLEAR THEM</button>
                    </>
                  )}
                </div>
              )}

              {available.length > 0 ? (
                <div className="tracker-link-list">
                  {available.map(task => {
                    const selected = selectedIds.has(task.id)
                    return (
                      <label key={task.id} className={`tracker-link-task ${selected ? 'tracker-link-task-selected' : ''}`}>
                        <input type="checkbox" checked={selected} onChange={() => toggleSelected(task.id)} />
                        <span className="tracker-link-task-main">
                          <span>{task.name}</span>
                          <span className="mono tracker-link-muted">
                            {task.trader?.name || 'UNKNOWN TRADER'} · LVL {task.minPlayerLevel || 1} · {taskMapName(task)}
                          </span>
                        </span>
                        {task.traderGate && <span className="mono tracker-link-gate" title="TarkovTracker does not provide trader loyalty levels">{task.traderGateLabel}</span>}
                        {task.prereqGate && <span className="mono tracker-link-gate" title="A prerequisite depends on a task being active or failed, which the tracker does not report">PREREQ UNKNOWN</span>}
                      </label>
                    )
                  })}
                </div>
              ) : (
                <div className="mono tracker-link-muted tracker-link-empty">NO NEW TASKS PASSED THE TRACKER CHECKS.</div>
              )}

              <div className="tracker-link-actions">
                <button className="btn-gold btn-sm" onClick={handleImport} disabled={!selectedTasks.length || tokenModeMismatch}>
                  ADD {selectedTasks.length} QUEST{selectedTasks.length === 1 ? '' : 'S'}
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setSelectedIds(new Set(available.map(task => task.id)))} disabled={!available.length}>SELECT ALL</button>
                <button className="btn-ghost btn-sm" onClick={() => setSelectedIds(new Set())} disabled={!selectedTasks.length}>CLEAR SELECTION</button>
              </div>
              <div className="mono tracker-link-muted tracker-link-footnote">
                TRADER LOYALTY AND ACTIVE-TASK STATE ARE NOT IN THE TRACKER RESPONSE. GATED TASKS ARE SHOWN FOR YOUR REVIEW, NOT GUARANTEED AVAILABLE.
              </div>
            </>
          ) : (
            <div className="mono tracker-link-muted tracker-link-empty">LOADING TRACKER PROGRESS...</div>
          )}
        </>
      )}
    </div>
  )
}
