import { useEffect, useMemo, useRef, useState } from 'react'
import { gameModeLabel } from '../gameMode'

const STATE_LABELS = {
  active: 'STARTED',
  failed: 'FAILED',
  completed: 'COMPLETED',
}

function safeDate(value) {
  if (!value) return 'UNKNOWN DATE'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'UNKNOWN DATE' : date.toLocaleDateString()
}

function safeDateTime(value) {
  if (!value) return 'NOT CHECKED YET'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'NOT CHECKED YET' : date.toLocaleString()
}

function profileModeLabel(profile) {
  const modes = (profile?.gameModes || []).filter(mode => mode === 'regular' || mode === 'pve')
  return modes.length ? modes.map(gameModeLabel).join('/') : 'MODE UNKNOWN'
}

function profileDisplay(profile, index = 0) {
  return `PROFILE ${index + 1} · LAST SEEN ${safeDate(profile?.lastSeen)} · ${profileModeLabel(profile)}`
}

/**
 * The reconciliation RPC answers with inserted/updated/ignored counts. Reading
 * a `changed`/`affected` field that it never returns silently reported the
 * pre-import preview size as the applied count.
 */
function appliedCount(result, fallback) {
  const inserted = Number(result?.inserted)
  const updated = Number(result?.updated)
  if (!Number.isFinite(inserted) && !Number.isFinite(updated)) return fallback
  return (Number.isFinite(inserted) ? inserted : 0) + (Number.isFinite(updated) ? updated : 0)
}

function eventCounts(events) {
  return (Array.isArray(events) ? events : []).reduce((counts, event) => {
    if (event?.state in counts) counts[event.state] += 1
    return counts
  }, { active: 0, failed: 0, completed: 0 })
}

function latestByTask(events) {
  const result = new Map()
  for (const event of Array.isArray(events) ? events : []) {
    const current = result.get(event.taskId)
    const currentTime = current?.occurredAt ? Date.parse(current.occurredAt) : -Infinity
    const nextTime = event?.occurredAt ? Date.parse(event.occurredAt) : -Infinity
    if (!current || nextTime >= currentTime) result.set(event.taskId, event)
  }
  return result
}

export default function EftLogImport({ allTasks, gameMode, userId, onApply, onGetQuestHistory, userQuests = [], sync }) {
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)
  const [needsFileFallback, setNeedsFileFallback] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [applyMessage, setApplyMessage] = useState('')
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [questHistory, setQuestHistory] = useState([])
  const {
    supported,
    persistentSupported,
    state,
    preview,
    error,
    rememberedFolderName,
    lastSuccessfulCheck,
    progress,
    pendingJob,
    resumeImport,
    discardPendingJob,
    parseSelectedFiles,
    connectRememberedFolder,
    reconnectRememberedFolder,
    setIncludedVersions,
    setProfileSelection,
    setUnknownModeTarget,
    confirmImport,
    forgetFolder,
    reset,
    checkNow,
    autoSync,
    setAutoSync,
  } = sync || {}

  // Keyed on whether a preview exists, not on its identity: every version
  // checkbox and profile choice rebuilds the preview object, and depending on
  // it re-queried quest history on each toggle.
  const hasPreview = Boolean(preview)
  useEffect(() => {
    let current = true
    if (!hasPreview || typeof onGetQuestHistory !== 'function') {
      setQuestHistory([])
      return () => { current = false }
    }
    Promise.resolve(onGetQuestHistory(1000)).then(rows => {
      if (current) setQuestHistory(Array.isArray(rows) ? rows : [])
    }).catch(() => {
      if (current) setQuestHistory([])
    })
    return () => { current = false }
  }, [hasPreview, onGetQuestHistory])

  const tasksById = useMemo(() => new Map((Array.isArray(allTasks) ? allTasks : []).map(task => [task.id, task])), [allTasks])
  const knownTaskIds = useMemo(() => new Set(tasksById.keys()), [tasksById])
  const selectedEvents = useMemo(() => {
    if (!preview) return []
    const versions = new Set(preview.includedVersions || [])
    const profileRequired = (preview.discoveredProfiles || []).length > 1
    return (preview.events || []).filter(event => {
      if (!knownTaskIds.has(event?.taskId)) return false
      if (versions.size && !versions.has(String(event?.version || ''))) return false
      if (profileRequired && event?.profileKey !== preview.selectedProfileKey) return false
      const eventMode = event?.gameMode || preview.unknownModeTarget
      return eventMode === gameMode
    })
  }, [gameMode, knownTaskIds, preview])
  const counts = useMemo(() => eventCounts(selectedEvents), [selectedEvents])
  const latest = useMemo(() => latestByTask(selectedEvents), [selectedEvents])
  const activeIds = useMemo(() => new Set((Array.isArray(userQuests) ? userQuests : []).map(quest => quest.quest_id)), [userQuests])
  const historyById = useMemo(() => new Map((Array.isArray(questHistory) ? questHistory : []).map(quest => [quest.quest_id, quest])), [questHistory])
  const changingTasks = useMemo(() => [...latest.entries()].map(([taskId, event]) => {
    const current = activeIds.has(taskId) ? 'active' : historyById.get(taskId)?.state || null
    return { taskId, event, task: tasksById.get(taskId), current }
  }).filter(entry => entry.current !== entry.event.state), [latest, activeIds, historyById, tasksById])

  async function handleFiles(event, fromDirectory = true) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    // Some browsers honour the directory picker but return bare filenames.
    // Surface the plain multi-file path so the user is not left guessing.
    if (fromDirectory) setNeedsFileFallback(!files.some(file => file.webkitRelativePath))
    setApplyMessage('')
    setOpen(true)
    try {
      await parseSelectedFiles(files)
    } catch {
      // The hook exposes a sanitized error in the panel; keep picker events from
      // producing an unhandled rejection in browsers and test environments.
    }
  }

  async function handleConnect() {
    setApplyMessage('')
    setOpen(true)
    try {
      await connectRememberedFolder()
    } catch {
      // The hook owns the sanitized user-facing error state.
    }
  }

  async function handleConfirm(keepInSync = false) {
    setBusy(true)
    setApplyMessage('')
    try {
      const result = await confirmImport({ autoSync: keepInSync })
      const applied = appliedCount(result, changingTasks.length)
      const ignored = Number(result?.ignored)
      setApplyMessage(`APPLIED ${applied} QUEST STATE${applied === 1 ? '' : 'S'}.`
        + (Number.isFinite(ignored) && ignored > 0 ? ` ${ignored} ALREADY UP TO DATE.` : ''))
    } catch {
      setApplyMessage('IMPORT FAILED — YOUR PREVIEW IS STILL AVAILABLE. RETRY WHEN READY.')
    } finally {
      setBusy(false)
    }
  }

  async function handleResume() {
    setBusy(true)
    setApplyMessage('')
    try {
      const result = await resumeImport()
      const applied = appliedCount(result, 0)
      setApplyMessage(`RESUMED AND APPLIED ${applied} QUEST STATE${applied === 1 ? '' : 'S'}.`)
    } catch {
      setApplyMessage('RESUME FAILED — THE SAVED PROGRESS IS STILL HERE. TRY AGAIN WHEN READY.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDiscard() {
    setApplyMessage('')
    await discardPendingJob()
  }

  function closePanel() {
    // Closing mid-apply would unmount the progress bar while chunks are still
    // being written. The job itself survives -- it is checkpointed after every
    // batch -- but the reader loses the only view of it, so block the close.
    if (state === 'applying' || busy) return
    setOpen(false)
    setApplyMessage('')
  }

  // The same vocabulary the screenshot strip uses: one word for the state the
  // folder is actually in. Watching and auto-apply are one setting in the hook,
  // so the word names the consequence rather than the mechanism.
  const statusWord = state === 'watching' ? 'AUTO-APPLY ON'
    : state === 'permission-needed' ? 'PERMISSION NEEDED'
    : state === 'reading' ? 'CHECKING…'
    : state === 'applying' ? 'APPLYING…'
    : state === 'error' ? 'CHECK FAILED'
    : 'MANUAL'

  const hiddenPickers = (
    <>
      <input ref={inputRef} type="file" accept=".log,text/plain" multiple webkitdirectory="" style={{ display: 'none' }} onChange={handleFiles} />
      <input ref={fileInputRef} type="file" accept=".log,text/plain" multiple style={{ display: 'none' }} onChange={event => handleFiles(event, false)} />
    </>
  )

  // A connected folder has a state worth seeing without opening anything, so
  // collapsed-but-connected borrows the screenshot strip rather than hiding
  // behind a button that says nothing about whether syncing is running.
  if (!open && rememberedFolderName) {
    const watching = state === 'watching'
    return (
      <div className="card sync-strip">
        <div className="sync-strip-row">
          <div className="sync-strip-state">
            <span className={watching ? 'mon-dot mon-dot-live' : 'mon-dot'} style={{ background: watching ? 'var(--grn)' : 'var(--txd)' }} />
            <span className={`mono sync-strip-label${watching ? ' sync-strip-label-live' : ''}`}>
              LOCAL QUEST LOGS · {statusWord}
            </span>
          </div>
          <div className="sync-strip-actions">
            <button className="btn-ghost btn-sm" onClick={() => setOpen(true)} aria-expanded="false">OPEN</button>
          </div>
        </div>
        <div className="mono sync-strip-note">
          {rememberedFolderName} · {watching
            ? 'NEW QUEST EVENTS APPLY AUTOMATICALLY WHILE THIS SITE IS OPEN.'
            : 'OPEN TO CHECK FOR NEW QUEST EVENTS. NOTHING IS WRITTEN WITHOUT YOUR REVIEW.'}
        </div>
        {error && <div className="mono sync-strip-error" role="alert">{error}</div>}
        {hiddenPickers}
      </div>
    )
  }

  if (!open) {
    return (
      <>
        <button className="btn-gold btn-sm" onClick={() => setOpen(true)} aria-expanded="false">
          IMPORT EFT LOGS
        </button>
        {hiddenPickers}
      </>
    )
  }

  const logModeSupported = gameMode === 'regular' || gameMode === 'pve'
  // A flat folder or a plain file selection detects no version at all. Only an
  // emptied selection out of real choices should block confirmation.
  const versionScopeValid = !preview?.availableVersions?.length || preview.includedVersions?.length > 0
  const pickerBusy = state === 'reading' || state === 'applying' || busy
  // Watching needs a real directory handle, so the offer only appears when the
  // folder actually came from the persistent picker.
  const canKeepInSync = Boolean(persistentSupported && rememberedFolderName)
  const canConfirm = logModeSupported && preview && changingTasks.length > 0 && state !== 'applying' && state !== 'reading' && versionScopeValid
  const profileChoices = Array.isArray(preview?.discoveredProfiles) ? preview.discoveredProfiles : []
  const ambiguousCount = preview?.ambiguousModeEvents ?? 0
  const unmatchedTaskIds = Array.isArray(preview?.unmatchedTaskIds) ? preview.unmatchedTaskIds : []
  const unmatchedTaskDetails = Array.isArray(preview?.unmatchedTaskDetails) && preview.unmatchedTaskDetails.length
    ? preview.unmatchedTaskDetails
    : unmatchedTaskIds.map(taskId => ({ taskId, occurrences: null, states: [], versions: [], lastSeen: null }))
  const malformedRecords = Array.isArray(preview?.malformedRecords) ? preview.malformedRecords : []
  const hasImportNotes = unmatchedTaskIds.length > 0 || ambiguousCount > 0 || (preview?.parseErrors || 0) > 0
  // Show the bar for any in-flight apply, including one that only just started
  // and has no chunk result yet, so the reader never sees a frozen APPLYING...
  const activeProgress = (state === 'applying' || busy) && progress && progress.total > 0 ? progress : null
  const progressPercent = activeProgress
    ? Math.min(100, Math.round((activeProgress.applied / activeProgress.total) * 100))
    : 0

  return (
    <div className="card eft-log-import-panel">
      <div className="eft-log-import-head">
        <div>
          <div className="lbl">IMPORT EFT LOGS</div>
          <div className="mono eft-log-import-copy">
            NO INSTALL. READ-ONLY FOLDER ACCESS. LOGS ARE PROCESSED LOCALLY; RAW LOGS ARE NEVER UPLOADED.
            THIS SITE CANNOT WATCH LOGS WHILE CLOSED.
          </div>
        </div>
        <button className="eft-log-import-close" onClick={closePanel} aria-label="Close EFT log import">×</button>
      </div>

      {hiddenPickers}

      {/* One primary action, named for what the browser can actually do with it.
          CHOOSE LOGS FOLDER and REMEMBER THIS FOLDER used to read as peers when
          only the second can ever sync -- the first is a one-shot dead end. */}
      <div className="eft-log-import-actions">
        {persistentSupported ? (
          <>
            <button className="btn-gold btn-sm" onClick={handleConnect} disabled={!logModeSupported || pickerBusy}>
              {state === 'reading' ? 'READING LOGS...' : 'CONNECT LOGS FOLDER'}
            </button>
            <button className="mono sync-link" onClick={() => inputRef.current?.click()} disabled={!logModeSupported || pickerBusy}>
              ONE-TIME IMPORT INSTEAD
            </button>
          </>
        ) : (
          <>
            <button className="btn-gold btn-sm" onClick={() => inputRef.current?.click()} disabled={!logModeSupported || pickerBusy}>
              {state === 'reading' ? 'READING LOGS...' : 'CHOOSE LOGS FOLDER'}
            </button>
            <button className="mono sync-link" onClick={() => fileInputRef.current?.click()} disabled={!logModeSupported || pickerBusy}>
              CHOOSE LOG FILES INSTEAD
            </button>
          </>
        )}
      </div>
      {needsFileFallback && (
        <div className="mono eft-log-import-status">
          THIS BROWSER RETURNED NO FOLDER STRUCTURE. SELECT THE LOG FILES DIRECTLY.
          <div className="eft-log-import-status-actions">
            <button className="btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()} disabled={!logModeSupported || pickerBusy}>
              CHOOSE LOG FILES
            </button>
          </div>
        </div>
      )}

      {!supported && <div className="mono eft-log-import-error">FILE PICKER SUPPORT IS UNAVAILABLE IN THIS BROWSER.</div>}
      {!logModeSupported && <div className="mono eft-log-import-error">SEASONAL LOG IMPORT IS DISABLED UNTIL ITS LOG SIGNALS ARE VERIFIED.</div>}
      {error && <div className="mono eft-log-import-error">{error}</div>}
      {rememberedFolderName && (
        <div className="mono eft-log-import-status">
          <span className={state === 'watching' ? 'mon-dot mon-dot-live' : 'mon-dot'} style={{ background: state === 'watching' ? 'var(--grn)' : 'var(--txd)' }} />
          <span>
            {rememberedFolderName} · {statusWord}
            {state === 'watching' ? ` · LAST CHECK ${safeDateTime(lastSuccessfulCheck)}` : ''}
          </span>
          <div className="eft-log-import-status-actions">
            {/* Auto-apply is the one real setting a connected folder has, and it
                only exists here -- where there is a folder for it to govern. */}
            {state !== 'permission-needed' && (
              <button
                className={`mono autosync-toggle${autoSync ? ' autosync-toggle-on' : ''}`}
                onClick={() => setAutoSync?.(!autoSync)}
                disabled={busy || state === 'applying' || typeof setAutoSync !== 'function'}
                aria-pressed={Boolean(autoSync)}
              >
                AUTO-APPLY {autoSync ? 'ON' : 'OFF'}
              </button>
            )}
            {state === 'permission-needed'
              ? <button className="btn-gold btn-sm" onClick={reconnectRememberedFolder} disabled={busy}>RECONNECT</button>
              : <button className="btn-ghost btn-sm" onClick={checkNow} disabled={busy || state === 'reading' || state === 'applying'}>CHECK NOW</button>}
            <button className="btn-ghost btn-sm" onClick={forgetFolder} disabled={busy}>FORGET</button>
          </div>
        </div>
      )}

      {activeProgress && (
        <div className="eft-log-import-progress">
          <div className="mono eft-log-import-progress-label">
            <span>APPLYING QUEST EVENTS</span>
            <span>{activeProgress.applied}/{activeProgress.total} · {progressPercent}%</span>
          </div>
          <div
            className="eft-log-import-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={activeProgress.total}
            aria-valuenow={activeProgress.applied}
            aria-label="Quest log import progress"
          >
            <div className="eft-log-import-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="mono eft-log-import-progress-note">
            PROGRESS IS SAVED AFTER EACH BATCH. YOU CAN LEAVE THIS PAGE AND RESUME LATER.
          </div>
        </div>
      )}

      {pendingJob && state !== 'applying' && (
        <div className="eft-log-import-resume">
          <div className="mono eft-log-import-resume-label">
            UNFINISHED IMPORT · {pendingJob.applied}/{pendingJob.total} EVENTS APPLIED
            {pendingJob.lastError ? ` · ${pendingJob.lastError.toUpperCase()}` : ''}
          </div>
          <div className="eft-log-import-resume-actions">
            <button className="btn-gold btn-sm" onClick={handleResume} disabled={busy || !onApply}>RESUME IMPORT</button>
            <button className="btn-ghost btn-sm" onClick={handleDiscard} disabled={busy}>DISCARD</button>
          </div>
        </div>
      )}

      {preview && (
        <div className="eft-log-import-preview">
          <div className="eft-log-import-summary mono">
          <span>{preview.filesParsed}/{preview.filesScanned} FILES</span>
            <span>{counts.active} STARTED</span>
            <span>{counts.completed} COMPLETED</span>
            <span>{counts.failed} FAILED</span>
            <span>{changingTasks.length} STATE CHANGES</span>
          </div>
          <div className="eft-log-import-meta mono">TARGET MODE: {gameModeLabel(gameMode)}</div>
          {preview.availableVersions?.length > 0 && (
            <div className="eft-log-import-versions">
              <span className="mono eft-log-import-meta">WIPE / VERSION SCOPE</span>
              {preview.availableVersions.map(version => (
                <label key={version} className="mono eft-log-import-check">
                  <input
                    type="checkbox"
                    checked={preview.includedVersions?.includes(version)}
                    disabled={preview.includedVersions?.length === 1 && preview.includedVersions.includes(version)}
                    onChange={event => {
                      const next = new Set(preview.includedVersions || [])
                      if (event.target.checked) next.add(version)
                      else next.delete(version)
                      setIncludedVersions([...next])
                    }}
                  /> {version}
                </label>
              ))}
            </div>
          )}
          {profileChoices.length > 1 && (
            <label className="mono eft-log-import-field">PROFILE
              <select value={preview.selectedProfileKey || ''} onChange={event => setProfileSelection(event.target.value)}>
                <option value="">SELECT PROFILE</option>
                {profileChoices.map((profile, index) => <option key={profile.profileKey || index} value={profile.profileKey}>{profileDisplay(profile, index)}</option>)}
              </select>
            </label>
          )}
          {profileChoices.length === 1 && <div className="mono eft-log-import-meta">PROFILE: {profileDisplay(profileChoices[0])}</div>}
          {preview.ambiguousModeEvents > 0 && (
            <label className="mono eft-log-import-field">UNKNOWN MODE — CHOOSE TARGET
              <select value={preview.unknownModeTarget || ''} onChange={event => setUnknownModeTarget(event.target.value)}>
                <option value="">SELECT TARGET</option>
                <option value="regular">REGULAR</option>
                <option value="pve">PVE</option>
              </select>
            </label>
          )}
          <div className="mono eft-log-import-meta">SEASONAL LOG IMPORT IS DISABLED UNTIL ITS LOG SIGNALS ARE VERIFIED.</div>
          <div className="eft-log-import-task-list">
            <div className="lbl">TASKS WHOSE STATE WILL CHANGE</div>
            {changingTasks.length ? changingTasks.map(({ taskId, event, task, current }) => (
              <div className="eft-log-import-task" key={`${taskId}:${event.eventKey}`}>
                <span>{task?.name || 'UNKNOWN TASK'}</span>
                <span className="mono">{current ? `${STATE_LABELS[current] || current} → ` : ''}{STATE_LABELS[event.state] || event.state}</span>
              </div>
            )) : <div className="mono eft-log-import-muted">NO NEW STATE CHANGES.</div>}
          </div>
          {hasImportNotes && (
            <button className="btn-ghost btn-sm" onClick={() => setShowUnmatched(value => !value)}>
              {showUnmatched ? 'HIDE IMPORT NOTES' : 'SHOW IMPORT NOTES'}
            </button>
          )}
          {showUnmatched && (
            <div className="eft-log-import-notes">
              {unmatchedTaskIds.length > 0 && (
                <details className="eft-log-import-detail">
                  <summary className="mono">{unmatchedTaskIds.length} UNKNOWN TASK IDS</summary>
                  <div className="eft-log-import-detail-list">
                    {unmatchedTaskDetails.map(detail => (
                      <div className="eft-log-import-detail-row" key={detail.taskId}>
                        <div className="mono eft-log-import-detail-primary">{detail.taskId}</div>
                        <div className="mono eft-log-import-detail-secondary">
                          {detail.occurrences ? `${detail.occurrences} OCCURRENCE${detail.occurrences === 1 ? '' : 'S'}` : 'OCCURRENCE COUNT UNAVAILABLE'}
                          {detail.states?.length ? ` · ${detail.states.join(' / ').toUpperCase()}` : ''}
                          {detail.versions?.length ? ` · VERSION ${detail.versions.join(' / ')}` : ''}
                          {detail.lastSeen ? ` · LAST SEEN ${safeDateTime(detail.lastSeen)}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {ambiguousCount > 0 && <div className="mono eft-log-import-note-line">{ambiguousCount} AMBIGUOUS MODE EVENTS</div>}
              {(preview.parseErrors || 0) > 0 && (
                <details className="eft-log-import-detail">
                  <summary className="mono">{preview.parseErrors} MALFORMED RECORDS SKIPPED</summary>
                  {malformedRecords.length ? (
                    <div className="eft-log-import-detail-list">
                      {malformedRecords.map((record, index) => (
                        <div className="eft-log-import-detail-row" key={`${record.file}:${record.line || 'unknown'}:${record.reason}:${index}`}>
                          <div className="mono eft-log-import-detail-primary">{record.file} · {record.line ? `LINE ${record.line}` : 'LINE UNKNOWN'}</div>
                          <div className="mono eft-log-import-detail-secondary">{record.reason}</div>
                        </div>
                      ))}
                      {malformedRecords.length < preview.parseErrors && (
                        <div className="mono eft-log-import-detail-secondary">SHOWING {malformedRecords.length} OF {preview.parseErrors} RECORDS.</div>
                      )}
                    </div>
                  ) : <div className="mono eft-log-import-detail-secondary">DETAILS UNAVAILABLE FOR THIS IMPORT.</div>}
                </details>
              )}
            </div>
          )}
          {applyMessage && <div className="mono eft-log-import-success">{applyMessage}</div>}
          {/* The keep-in-sync decision is made here, next to the state changes
              it will govern, instead of as an abstract checkbox above an empty
              panel that never said it authorised unreviewed writes. */}
          <div className="eft-log-import-footer">
            <button className="btn-gold btn-sm" onClick={() => handleConfirm(false)} disabled={!canConfirm || !onApply || busy}>
              {busy || state === 'applying' ? 'APPLYING...' : 'CONFIRM IMPORT'}
            </button>
            {canKeepInSync && (
              <button className="btn-gold btn-sm" onClick={() => handleConfirm(true)} disabled={!canConfirm || !onApply || busy}>
                CONFIRM & KEEP IN SYNC
              </button>
            )}
            <button className="btn-ghost btn-sm" onClick={reset} disabled={busy}>CLEAR PREVIEW</button>
          </div>
          {canKeepInSync && (
            <div className="mono eft-log-import-muted">
              KEEP IN SYNC APPLIES LATER QUEST EVENTS WITHOUT ASKING, WHILE THIS SITE IS OPEN. TURN IT OFF ANY TIME.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
