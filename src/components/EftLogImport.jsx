import { useEffect, useMemo, useRef, useState } from 'react'
import { gameModeLabel } from '../gameMode'
import { assessQuestLogRegression, IMPORT_REGRESSION_SHARE, IMPORT_REGRESSION_TASKS } from '../questLogState'
import { buildQuestLogDiagnostic } from '../questDiagnostic'
import { isSeasonalEvent } from '../eftLogs'

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
  const modeCounts = Object.entries(profile?.modeCounts || {}).map(([mode, count]) => `${count} ${gameModeLabel(mode)}`).join(' / ')
  const dates = profile?.sessionDateFrom && profile?.sessionDateTo
    ? `SESSIONS ${safeDate(profile.sessionDateFrom)}–${safeDate(profile.sessionDateTo)}`
    : `LAST SEEN ${safeDate(profile?.lastSeen)}`
  const confidence = profile?.modeStatus === 'dominant' || profile?.modeConfidence === 'dominant'
    ? 'MODE RESOLVED BY DOMINANCE'
    : profile?.modeStatus === 'unresolved' || profile?.modeConfidence === 'conflicted' || profile?.modeConfidence === 'absent'
      ? 'MODE UNRESOLVED'
      : profile?.modeStatus === 'multiple' ? 'MULTIPLE MODE FACETS' : null
  return `PROFILE ${index + 1} · ${dates} · ${modeCounts || profileModeLabel(profile)}${confidence ? ` · ${confidence}` : ''}`
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

const NO_CHANGES_REASON = 'Your saved quests already match these logs. Nothing to import.'

export function blockingReason({ logModeSupported, preview, versionScopeValid, profileRequired, changingCount } = {}) {
  if (!logModeSupported) return 'Seasonal mode cannot be imported from logs yet. Switch to PVP or PVE to import.'
  if (!preview) return null
  if (profileRequired && !preview.selectedProfileKey) return 'Select which profile these logs belong to.'
  if (!versionScopeValid) return 'Select at least one wipe/version to import from.'
  if (changingCount === 0) return NO_CHANGES_REASON
  return null
}

export function deriveImportSteps(preview) {
  const profileRequired = (preview?.discoveredProfiles || []).length > 1
  const scopeRequired = (preview?.availableVersions || []).length > 0
  const steps = [{ key: 'folder', label: 'FOLDER', done: Boolean(preview) }]
  if (profileRequired) steps.push({ key: 'profile', label: 'PROFILE', done: Boolean(preview.selectedProfileKey) })
  if (scopeRequired) steps.push({ key: 'scope', label: 'SCOPE', done: (preview.includedVersions || []).length > 0 })
  steps.push({ key: 'review', label: 'REVIEW', done: false })

  const currentIndex = steps.findIndex(step => !step.done)
  return steps.map((step, index) => ({
    ...step,
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming',
  }))
}

export default function EftLogImport({ allTasks, gameMode, onApply, onGetQuestHistory, userQuests = [], sync, onImportStart, onImportComplete, onViewQuests, defaultOpen = false }) {
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)
  const [needsFileFallback, setNeedsFileFallback] = useState(false)
  const [open, setOpen] = useState(defaultOpen)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [applyMessage, setApplyMessage] = useState('')
  const [applySucceeded, setApplySucceeded] = useState(false)
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [questHistory, setQuestHistory] = useState([])
  const [regressionConfirmed, setRegressionConfirmed] = useState(false)
  const [diagnosticMessage, setDiagnosticMessage] = useState('')
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
    setWipeScope = () => {},
    confirmImport,
    forgetFolder,
    reset,
    checkNow,
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
  const scopedEvents = useMemo(() => {
    if (!preview) return []
    const versions = new Set(preview.includedVersions || [])
    const profileRequired = (preview.discoveredProfiles || []).length > 1
    return (preview.events || []).filter(event => {
      if (!knownTaskIds.has(event?.taskId)) return false
      if (versions.size && !versions.has(String(event?.version || ''))) return false
      if (profileRequired && event?.profileKey !== preview.selectedProfileKey && !(event?.legacyProfileKeys || []).includes(preview.selectedProfileKey)) return false
      if (!preview.includePreWipeHistory && preview.wipeBoundaryAt) {
        const eventTime = Date.parse(event?.occurredAt || '')
        const boundary = Date.parse(preview.wipeBoundaryAt)
        if (!Number.isFinite(eventTime) || eventTime < boundary) return false
      }
      return true
    })
  }, [knownTaskIds, preview])
  const seasonalSessionKeys = useMemo(() => new Set((preview?.sessions || []).filter(session => session.hasSeasonalSignal).map(session => session.sessionKey)), [preview])
  const selectedEvents = useMemo(() => scopedEvents.filter(event => {
    if (isSeasonalEvent(event, seasonalSessionKeys)) return false
    const eventMode = event?.gameMode || preview?.unknownModeTargets?.[event?.sessionKey]
    if (!event?.gameMode && !preview?.unknownModeTargets?.[event?.sessionKey]) return false
    if (event?.modeConfidence === 'conflicted' || event?.modeConfidence === 'absent') {
      if (!preview?.unknownModeTargets?.[event?.sessionKey]) return false
    }
    return eventMode === gameMode
  }), [gameMode, preview, scopedEvents, seasonalSessionKeys])
  const counts = useMemo(() => eventCounts(selectedEvents), [selectedEvents])
  const latest = useMemo(() => latestByTask(selectedEvents), [selectedEvents])
  const activeIds = useMemo(() => new Set((Array.isArray(userQuests) ? userQuests : []).map(quest => quest.quest_id)), [userQuests])
  const historyById = useMemo(() => new Map((Array.isArray(questHistory) ? questHistory : []).map(quest => [quest.quest_id, quest])), [questHistory])
  const changingTasks = useMemo(() => [...latest.entries()].map(([taskId, event]) => {
    const current = activeIds.has(taskId) ? 'active' : historyById.get(taskId)?.state || null
    return { taskId, event, task: tasksById.get(taskId), current }
  }).filter(entry => entry.current !== entry.event.state), [latest, activeIds, historyById, tasksById])
  const existingRows = useMemo(() => {
    const rows = new Map((Array.isArray(questHistory) ? questHistory : []).map(row => [row.quest_id, row]))
    for (const row of Array.isArray(userQuests) ? userQuests : []) if (!rows.has(row.quest_id)) rows.set(row.quest_id, row)
    return [...rows.values()]
  }, [questHistory, userQuests])
  const regression = useMemo(() => assessQuestLogRegression(selectedEvents, existingRows), [existingRows, selectedEvents])
  useEffect(() => { setRegressionConfirmed(false) }, [selectedEvents])

  async function handleFiles(event, fromDirectory = true) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    // Some browsers honour the directory picker but return bare filenames.
    // Surface the plain multi-file path so the user is not left guessing.
    if (fromDirectory) setNeedsFileFallback(!files.some(file => file.webkitRelativePath))
    // Native file inputs cannot grant persistent access. Keep this preview a
    // one-time import even when an older connected folder still exists.
    setRemember(false)
    setApplyMessage('')
    setApplySucceeded(false)
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
    setApplySucceeded(false)
    setOpen(true)
    setRemember(true)
    try {
      await connectRememberedFolder()
    } catch {
      // The hook owns the sanitized user-facing error state.
    }
  }

  async function handleConfirm() {
    setBusy(true)
    setApplyMessage('')
    setApplySucceeded(false)
    try {
      const shouldRemember = persistentSupported ? remember : false
      await onImportStart?.()
      const result = await confirmImport({ autoSync: shouldRemember, remember: shouldRemember })
      const applied = appliedCount(result, changingTasks.length)
      const ignored = Number(result?.ignored)
      const affectedIds = Array.isArray(result?.affected_task_ids)
        ? result.affected_task_ids.filter(Boolean)
        : changingTasks.map(({ taskId }) => taskId)
      const affectedSet = new Set(affectedIds)
      const appliedStates = changingTasks.reduce((summary, { taskId, event }) => {
        if (affectedSet.has(taskId) && Object.hasOwn(summary, event?.state ?? '')) summary[event.state] += 1
        return summary
      }, { active: 0, failed: 0, completed: 0 })
      setApplyMessage(`APPLIED ${applied} QUEST STATE${applied === 1 ? '' : 'S'}.`
        + (Number.isFinite(ignored) && ignored > 0 ? ` ${ignored} ALREADY UP TO DATE.` : ''))
      setApplySucceeded(true)
      onImportComplete?.({
        source: shouldRemember ? 'browser-sync' : 'logs',
        questIds: affectedIds,
        applied,
        ignored: Number.isFinite(ignored) ? ignored : 0,
        states: appliedStates,
        syncEnabled: shouldRemember,
      })
    } catch {
      setApplyMessage('IMPORT FAILED — YOUR PREVIEW IS STILL AVAILABLE. RETRY WHEN READY.')
    } finally {
      setBusy(false)
    }
  }

  async function handleResume() {
    setBusy(true)
    setApplyMessage('')
    setApplySucceeded(false)
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
    setApplySucceeded(false)
    await discardPendingJob()
  }

  async function handleCopyDiagnostic() {
    setDiagnosticMessage('')
    try {
      await navigator.clipboard.writeText(JSON.stringify(buildQuestLogDiagnostic(preview), null, 2))
      setDiagnosticMessage('Diagnostic summary copied to this device clipboard.')
    } catch {
      setDiagnosticMessage('The diagnostic summary could not be copied. Clipboard access is unavailable.')
    }
  }

  function closePanel() {
    // Closing mid-apply would unmount the progress bar while chunks are still
    // being written. The job itself survives -- it is checkpointed after every
    // batch -- but the reader loses the only view of it, so block the close.
    if (state === 'applying' || busy) return
    setOpen(false)
    setApplyMessage('')
    setApplySucceeded(false)
  }

  if (!open) {
    return (
      <>
        <button className="btn-gold btn-sm" onClick={() => setOpen(true)} aria-expanded="false">
          IMPORT EFT LOGS
        </button>
        <input ref={inputRef} type="file" accept=".log,text/plain" multiple webkitdirectory="" style={{ display: 'none' }} onChange={handleFiles} />
        <input ref={fileInputRef} type="file" accept=".log,text/plain" multiple style={{ display: 'none' }} onChange={event => handleFiles(event, false)} />
      </>
    )
  }

  const logModeSupported = gameMode === 'regular' || gameMode === 'pve'
  // A flat folder or a plain file selection detects no version at all. Only an
  // emptied selection out of real choices should block confirmation.
  const versionScopeValid = !preview?.availableVersions?.length || preview.includedVersions?.length > 0
  const canConfirm = logModeSupported && preview && changingTasks.length > 0 && state !== 'applying' && state !== 'reading' && versionScopeValid
    && (!regression.requiresConfirmation || regressionConfirmed)
  const profileChoices = Array.isArray(preview?.discoveredProfiles) ? preview.discoveredProfiles : []
  const profileRequired = profileChoices.length > 1
  const blockedReason = blockingReason({ logModeSupported, preview, versionScopeValid, profileRequired, changingCount: changingTasks.length })
  const importSteps = deriveImportSteps(preview)
  const currentStep = importSteps.findIndex(step => step.state === 'current')
  const stepState = key => importSteps.find(step => step.key === key)?.state
  const ambiguousCount = preview?.ambiguousModeEvents ?? 0
  // Only events the gateway timeline could not place still need the reader to
  // answer for them, so a session whose events were all attributed is no longer
  // offered as unresolved. A preview parsed before attribution existed reports no
  // unplaced count, and falls back to its whole event count as before.
  const unknownSessions = (preview?.sessions || []).filter(session => (
    (session.unplacedEventCount ?? session.eventCount) > 0
    && !session.hasSeasonalSignal
    && (session.modeConfidence === 'conflicted' || session.modeConfidence === 'absent')
  ))
  const seasonalExcludedCount = scopedEvents.filter(event => isSeasonalEvent(event, seasonalSessionKeys)).length
  const unresolvedExcludedCount = scopedEvents.filter(event => !event?.gameMode && !preview?.unknownModeTargets?.[event?.sessionKey] && !isSeasonalEvent(event, seasonalSessionKeys)).length
  const unmatchedTaskIds = Array.isArray(preview?.unmatchedTaskIds) ? preview.unmatchedTaskIds : []
  const unmatchedTaskDetails = Array.isArray(preview?.unmatchedTaskDetails) && preview.unmatchedTaskDetails.length
    ? preview.unmatchedTaskDetails
    : unmatchedTaskIds.map(taskId => ({ taskId, occurrences: null, states: [], versions: [], lastSeen: null }))
  const malformedRecords = Array.isArray(preview?.malformedRecords) ? preview.malformedRecords : []
  const hasImportNotes = unmatchedTaskIds.length > 0 || ambiguousCount > 0 || seasonalExcludedCount > 0 || (preview?.parseErrors || 0) > 0
  // Show the bar for any in-flight apply, including one that only just started
  // and has no chunk result yet, so the reader never sees a frozen APPLYING...
  const activeProgress = (state === 'applying' || busy) && progress && progress.total > 0 ? progress : null
  const progressPercent = activeProgress
    ? Math.min(100, Math.round((activeProgress.applied / activeProgress.total) * 100))
    : 0
  const regressionWarning = regression.requiresConfirmation
    ? `This import would change ${regression.changedRows} of ${regression.totalRows} saved quest rows and move ${regression.activeToCompleted} active quests to completed. This exceeds the ${IMPORT_REGRESSION_TASKS}-task or ${IMPORT_REGRESSION_SHARE * 100}% share safety threshold. Confirm these counts before continuing.`
    : null

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
        <button
          className="eft-log-import-close"
          onClick={closePanel}
          aria-label="Close EFT log import"
          disabled={state === 'applying' || busy}
          title={state === 'applying' || busy ? 'Import in progress — this finishes on its own.' : undefined}
        >×</button>
      </div>

      <input ref={inputRef} type="file" accept=".log,text/plain" multiple webkitdirectory="" style={{ display: 'none' }} onChange={handleFiles} />
      <input ref={fileInputRef} type="file" accept=".log,text/plain" multiple style={{ display: 'none' }} onChange={event => handleFiles(event, false)} />

      <div className="eft-log-import-actions">
        {persistentSupported && (
          <button className="btn-gold btn-sm" onClick={handleConnect} disabled={!logModeSupported || state === 'reading' || busy}>
            {state === 'reading' && remember ? 'CONNECTING...' : 'CONNECT FOLDER & KEEP SYNCED'}
          </button>
        )}
        <button className={persistentSupported ? 'btn-ghost btn-sm' : 'btn-gold btn-sm'} onClick={() => inputRef.current?.click()} disabled={!logModeSupported || state === 'reading' || busy}>
          {state === 'reading' && !remember ? 'READING LOGS...' : 'IMPORT LOG FOLDER ONCE'}
        </button>
        <button className="btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()} disabled={!logModeSupported || state === 'reading' || busy}>
          IMPORT LOG FILES ONCE
        </button>
      </div>
      <p className="eft-log-import-action-note">
        {persistentSupported
          ? 'Connected folders are remembered and checked while this tab is open. One-time imports do not save folder access.'
          : 'This browser supports one-time imports only. It will not remember or keep checking the selected files.'}
      </p>
      {needsFileFallback && (
        <div className="mono eft-log-import-meta">
          THIS BROWSER RETURNED NO FOLDER STRUCTURE. USE IMPORT LOG FILES ONCE AND SELECT THE LOG FILES DIRECTLY.
        </div>
      )}

      {!supported && <div className="mono eft-log-import-error" role="alert">FILE PICKER SUPPORT IS UNAVAILABLE IN THIS BROWSER.</div>}
      {!logModeSupported && <div className="mono eft-log-import-error" role="alert">SEASONAL LOG IMPORT IS DISABLED UNTIL ITS LOG SIGNALS ARE VERIFIED.</div>}
      {error && <div className="mono eft-log-import-error" role="alert">{error}</div>}
      {rememberedFolderName && (
        <div className="mono eft-log-import-watch">
          {state === 'watching' ? `WATCHING WHILE THIS SITE IS OPEN · LAST CHECK ${safeDateTime(lastSuccessfulCheck)}` : `FOLDER: ${rememberedFolderName}`}
          <button className="btn-ghost btn-sm" onClick={checkNow} disabled={busy || state === 'reading' || state === 'applying'}>CHECK NOW</button>
          <button className="btn-ghost btn-sm" onClick={reconnectRememberedFolder} disabled={busy}>RECONNECT</button>
          <button className="btn-ghost btn-sm" onClick={forgetFolder} disabled={busy}>FORGET FOLDER</button>
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

      <div className="eft-log-import-rail" aria-label={`Step ${currentStep + 1} of ${importSteps.length}`}>
        <div className="mono eft-log-import-rail-count">Step {currentStep + 1} of {importSteps.length}</div>
        <div className="eft-log-import-rail-steps">
          {importSteps.map((step, index) => (
            <div className={`eft-log-import-step eft-log-import-step-${step.state}`} key={step.key}>
              <span className="mono eft-log-import-step-number">{step.state === 'done' ? '✓' : index + 1}</span>
              <span className="mono">{step.label}</span>
            </div>
          ))}
        </div>
      </div>

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
          {profileChoices.length > 1 && stepState('profile') !== 'upcoming' && (
            <label className="mono eft-log-import-field">PROFILE
              <select value={preview.selectedProfileKey || ''} onChange={event => setProfileSelection(event.target.value)}>
                <option value="">SELECT PROFILE</option>
                {profileChoices.map((profile, index) => <option key={profile.profileKey || index} value={profile.profileKey}>{profileDisplay(profile, index)}</option>)}
              </select>
            </label>
          )}
          {profileChoices.length === 1 && <div className="mono eft-log-import-meta">PROFILE: {profileDisplay(profileChoices[0])}</div>}
          {preview.availableVersions?.length > 0 && stepState('scope') !== 'upcoming' && (
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
          {preview.wipeBoundaryAt && (
            <div className="eft-log-import-wipe-note">
              <p>A wipe boundary was detected on {safeDate(preview.wipeBoundaryAt)}. Events before that date are excluded by default.</p>
              <label className="mono eft-log-import-check">
                <input type="checkbox" checked={preview.includePreWipeHistory === true} onChange={event => setWipeScope(event.target.checked)} /> INCLUDE FULL HISTORY
              </label>
            </div>
          )}
          {unknownSessions.length > 0 && (
            <div className="eft-log-import-sessions">
              <div className="mono eft-log-import-meta">UNRESOLVED SESSIONS</div>
              <p>Unresolved events are excluded unless you opt in to one session and choose its mode.</p>
              {unknownSessions.map(session => (
                <label className="mono eft-log-import-session" key={session.sessionKey}>
                  <span>{safeDate(session.dateFrom)}–{safeDate(session.dateTo)} · {session.eventCount} EVENTS</span>
                  <select value={preview.unknownModeTargets?.[session.sessionKey] || ''} onChange={event => setUnknownModeTarget(session.sessionKey, event.target.value || null)}>
                    <option value="">EXCLUDE</option>
                    <option value="regular">REGULAR</option>
                    <option value="pve">PVE</option>
                  </select>
                </label>
              ))}
            </div>
          )}
          {stepState('review') === 'current' && (
            <>
              <div className="mono eft-log-import-meta">SEASONAL LOG IMPORT IS DISABLED UNTIL ITS LOG SIGNALS ARE VERIFIED.</div>
              {unresolvedExcludedCount > 0 && <p className="eft-log-import-review-note">{unresolvedExcludedCount} events are excluded because their mode evidence is absent or conflicting.</p>}
              {seasonalExcludedCount > 0 && <p className="eft-log-import-review-note">{seasonalExcludedCount} events are excluded because seasonal log import is disabled.</p>}
              <div className="eft-log-import-task-list">
                <div className="lbl">TASKS WHOSE STATE WILL CHANGE</div>
                {changingTasks.length ? changingTasks.map(({ taskId, event, task, current }) => (
                  <div className="eft-log-import-task" key={`${taskId}:${event.eventKey}`}>
                    <span>{task?.name || 'UNKNOWN TASK'}</span>
                    <span className="mono">{current ? `${STATE_LABELS[current] || current} → ` : ''}{STATE_LABELS[event.state] || event.state}</span>
                  </div>
                )) : blockedReason === NO_CHANGES_REASON ? <div className="mono eft-log-import-muted">NO NEW STATE CHANGES.</div> : null}
              </div>
            </>
          )}
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
              {seasonalExcludedCount > 0 && <div className="mono eft-log-import-note-line">{seasonalExcludedCount} SEASONAL EVENTS EXCLUDED</div>}
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
          <button className="btn-ghost btn-sm" onClick={handleCopyDiagnostic}>COPY DIAGNOSTIC SUMMARY</button>
          {diagnosticMessage && <p className="mono eft-log-import-review-note" role="status">{diagnosticMessage}</p>}
          {regressionWarning && (
            <div className="eft-log-import-regression" role="alert">
              <p>{regressionWarning}</p>
              {!regressionConfirmed && <button className="btn-ghost btn-sm" onClick={() => setRegressionConfirmed(true)}>I UNDERSTAND THESE COUNTS</button>}
            </div>
          )}
          {applyMessage && <div className="mono eft-log-import-success" role="status">{applyMessage}</div>}
          <div className="eft-log-import-footer">
            {blockedReason && <p className="mono eft-log-import-blocked" role="status">{blockedReason}</p>}
            <button className="btn-gold btn-sm" onClick={handleConfirm} disabled={!canConfirm || !onApply || busy}>
              {busy || state === 'applying' ? 'APPLYING...' : 'CONFIRM IMPORT'}
            </button>
            {applySucceeded && <button className="btn-ghost btn-sm" onClick={() => onViewQuests?.()}>VIEW MY QUESTS</button>}
            <button className="btn-ghost btn-sm" onClick={reset} disabled={busy}>CLEAR PREVIEW</button>
          </div>
        </div>
      )}
    </div>
  )
}
