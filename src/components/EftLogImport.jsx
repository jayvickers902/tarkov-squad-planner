import { useEffect, useMemo, useRef, useState } from 'react'
import { gameModeLabel } from '../gameMode'
import { useEftLogImport } from '../useEftLogImport'

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

export default function EftLogImport({ allTasks, gameMode, userId, onApply, onGetQuestHistory, userQuests = [] }) {
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)
  const [needsFileFallback, setNeedsFileFallback] = useState(false)
  const [open, setOpen] = useState(false)
  const [remember, setRemember] = useState(false)
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
  } = useEftLogImport({ allTasks, gameMode, userId, onApply })

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
    try {
      const result = await confirmImport({ autoSync: remember, remember })
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

  function closePanel() {
    if (state === 'applying' || busy) return
    setOpen(false)
    setApplyMessage('')
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
  const profileChoices = Array.isArray(preview?.discoveredProfiles) ? preview.discoveredProfiles : []
  const ambiguousCount = preview?.ambiguousModeEvents ?? 0

  return (
    <div className="card eft-log-import-panel">
      <div className="eft-log-import-head">
        <div>
          <div className="lbl">IMPORT EFT LOGS</div>
          <div className="mono eft-log-import-copy">
            NO INSTALL. READ-ONLY FOLDER ACCESS. LOGS ARE PROCESSED LOCALLY; RAW LOGS ARE NEVER UPLOADED.
            THIS SITE CANNOT MONITOR WHILE CLOSED.
          </div>
        </div>
        <button className="eft-log-import-close" onClick={closePanel} aria-label="Close EFT log import">×</button>
      </div>

      <input ref={inputRef} type="file" accept=".log,text/plain" multiple webkitdirectory="" style={{ display: 'none' }} onChange={handleFiles} />
      <input ref={fileInputRef} type="file" accept=".log,text/plain" multiple style={{ display: 'none' }} onChange={event => handleFiles(event, false)} />

      <div className="eft-log-import-actions">
        <button className="btn-gold btn-sm" onClick={() => inputRef.current?.click()} disabled={!logModeSupported || state === 'reading' || busy}>
          {state === 'reading' ? 'READING LOGS...' : 'CHOOSE LOGS FOLDER'}
        </button>
        <button className="btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()} disabled={!logModeSupported || state === 'reading' || busy}>
          CHOOSE LOG FILES
        </button>
        {persistentSupported && (
          <>
            <button className="btn-ghost btn-sm" onClick={handleConnect} disabled={state === 'reading' || busy}>
              REMEMBER THIS FOLDER
            </button>
            <label className="mono eft-log-import-check">
              <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /> KEEP CHECKING WHILE THIS SITE IS OPEN
            </label>
          </>
        )}
      </div>
      {needsFileFallback && (
        <div className="mono eft-log-import-meta">
          THIS BROWSER RETURNED NO FOLDER STRUCTURE. USE CHOOSE LOG FILES AND SELECT THE LOG FILES DIRECTLY.
        </div>
      )}

      {!supported && <div className="mono eft-log-import-error">FILE PICKER SUPPORT IS UNAVAILABLE IN THIS BROWSER.</div>}
      {!logModeSupported && <div className="mono eft-log-import-error">SEASONAL LOG IMPORT IS DISABLED UNTIL ITS LOG SIGNALS ARE VERIFIED.</div>}
      {error && <div className="mono eft-log-import-error">{error}</div>}
      {rememberedFolderName && (
        <div className="mono eft-log-import-watch">
          {state === 'watching' ? `WATCHING WHILE THIS SITE IS OPEN · LAST CHECK ${safeDateTime(lastSuccessfulCheck)}` : `FOLDER: ${rememberedFolderName}`}
          <button className="btn-ghost btn-sm" onClick={checkNow} disabled={busy || state === 'reading' || state === 'applying'}>CHECK NOW</button>
          <button className="btn-ghost btn-sm" onClick={reconnectRememberedFolder} disabled={busy}>RECONNECT</button>
          <button className="btn-ghost btn-sm" onClick={forgetFolder} disabled={busy}>FORGET FOLDER</button>
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
          {(preview.unmatchedTaskIds?.length > 0 || preview.ambiguousModeEvents > 0) && (
            <button className="btn-ghost btn-sm" onClick={() => setShowUnmatched(value => !value)}>
              {showUnmatched ? 'HIDE IMPORT NOTES' : 'SHOW IMPORT NOTES'}
            </button>
          )}
          {showUnmatched && <div className="mono eft-log-import-notes">{preview.unmatchedTaskIds?.length || 0} UNKNOWN TASK IDS · {ambiguousCount} AMBIGUOUS MODE EVENTS · {preview.parseErrors || 0} MALFORMED RECORDS SKIPPED</div>}
          {applyMessage && <div className="mono eft-log-import-success">{applyMessage}</div>}
          <div className="eft-log-import-footer">
            <button className="btn-gold btn-sm" onClick={handleConfirm} disabled={!canConfirm || !onApply || busy}>
              {busy || state === 'applying' ? 'APPLYING...' : 'CONFIRM IMPORT'}
            </button>
            <button className="btn-ghost btn-sm" onClick={reset} disabled={busy}>CLEAR PREVIEW</button>
          </div>
        </div>
      )}
    </div>
  )
}
