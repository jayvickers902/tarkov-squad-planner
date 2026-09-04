import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_STATUS, normalizeStatus } from './adapter.js'
import { getCompanionService } from './service.js'
import { quitCompanion, readAutostart, setAutostart } from './tauri.js'
import { buildSuccessfulScanRows, loadTaskNames } from './scanReport.js'
import {
  checkForUpdate,
  downloadAndInstall,
  getInstalledVersion,
  getReleaseNotes,
  getUpdaterErrorMessage,
  restartAfterUpdate,
} from './updater.js'

const STATUS_LABELS = {
  offline: 'Offline',
  connecting: 'Connecting',
  connected: 'Connected',
  error: 'Needs attention',
}
const EMPTY_EVENTS = Object.freeze([])

function formatSyncTime(value) {
  if (!value) return 'Never'
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? 'Unknown' : parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function FolderSetting({ title, configured, optional = false, onChoose, disabled }) {
  return (
    <div className="folder-row">
      <div>
        <h3>{title}{optional && <span className="optional-label">OPTIONAL</span>}</h3>
        <p>{configured ? 'Folder selected on this PC' : optional ? 'Not configured — position pings stay off' : 'Required for quest import'}</p>
      </div>
      <button className="secondary-button" onClick={onChoose} disabled={disabled}>{configured ? 'Change folder' : 'Choose folder'}</button>
    </div>
  )
}

export function getSetupProgress(view, status, roots) {
  const authenticated = Boolean(view.authenticated)
  const logsConfigured = Boolean(roots.logsRoot)
  const selectionRequired = status.selectionRequired === 'profile' || status.selectionRequired === 'unknown-mode'
  const hasCompletedCheck = Boolean(status.lastSyncAt)
  const characterResolved = logsConfigured && !selectionRequired && hasCompletedCheck
  const syncHealthy = authenticated && logsConfigured && characterResolved && status.state === 'connected'
  const incomplete = !authenticated || !logsConfigured || selectionRequired || !hasCompletedCheck

  return {
    authenticated,
    logsConfigured,
    selectionRequired,
    hasCompletedCheck,
    characterResolved,
    syncHealthy,
    incomplete,
  }
}

function SetupProgress({ setup, status, configured, busy, onSignIn, onSignOut, onChooseLogs, onSync }) {
  const accountState = setup.authenticated ? 'complete' : 'current'
  const logsState = setup.logsConfigured ? 'complete' : setup.authenticated ? 'current' : 'upcoming'
  const characterState = setup.characterResolved
    ? 'complete'
    : setup.selectionRequired || (setup.logsConfigured && setup.authenticated) ? 'current' : 'upcoming'
  const syncState = setup.syncHealthy
    ? 'complete'
    : setup.characterResolved ? 'current' : 'upcoming'
  const statusLabel = value => value === 'complete' ? 'DONE' : value === 'current' ? 'NEXT' : 'LATER'

  return (
    <section className={`setup-card ${setup.syncHealthy ? 'is-complete' : ''}`} aria-labelledby="setup-title">
      <div className="setup-heading">
        <div>
          <p className="eyebrow">SETUP PROGRESS</p>
          <h2 id="setup-title">{setup.syncHealthy ? 'Companion ready' : setup.incomplete ? 'Finish companion setup' : 'Sync needs attention'}</h2>
          <p>{setup.syncHealthy ? 'Your quest logs are connected and the latest sync check completed.' : setup.incomplete ? 'Complete these steps once, then the companion keeps working from the system tray.' : 'Setup is saved. Use the current status and actions below to restore a healthy sync.'}</p>
        </div>
        <span className="setup-count">{setup.syncHealthy ? '4 OF 4' : `${[setup.authenticated, setup.logsConfigured, setup.characterResolved, setup.syncHealthy].filter(Boolean).length} OF 4`}</span>
      </div>

      <ol className="setup-steps">
        <li className={`setup-step is-${accountState}`} aria-current={accountState === 'current' ? 'step' : undefined}>
          <span className="setup-index" aria-hidden="true">{accountState === 'complete' ? '✓' : '1'}</span>
          <div className="setup-step-copy">
            <div className="setup-step-title"><strong>Sign in</strong><span>{statusLabel(accountState)}</span></div>
            <p>{setup.authenticated ? 'Your Dudgy.net account is connected.' : 'Connect your planner in the system browser. Credentials stay in Windows Credential Manager.'}</p>
          </div>
          {!setup.authenticated && (
            <div className="setup-actions">
              <button className="primary-button setup-action" onClick={() => onSignIn('google')} disabled={busy || !configured}>Sign in with Google</button>
              <button className="secondary-button setup-action" onClick={() => onSignIn('discord')} disabled={busy || !configured}>Sign in with Discord</button>
            </div>
          )}
          {setup.authenticated && setup.incomplete && <button className="secondary-button setup-action" onClick={onSignOut} disabled={busy}>Sign out</button>}
        </li>

        <li className={`setup-step is-${logsState}`} aria-current={logsState === 'current' ? 'step' : undefined}>
          <span className="setup-index" aria-hidden="true">{logsState === 'complete' ? '✓' : '2'}</span>
          <div className="setup-step-copy">
            <div className="setup-step-title"><strong>Configure Logs</strong><span>{statusLabel(logsState)}</span></div>
            <p>{setup.logsConfigured ? 'The Logs folder is selected on this PC.' : 'Choose your Escape from Tarkov Logs folder for quest import.'}</p>
          </div>
          {setup.authenticated && !setup.logsConfigured && <button className="primary-button setup-action" onClick={onChooseLogs} disabled={busy}>Choose Logs folder</button>}
        </li>

        <li className={`setup-step is-${characterState}`} aria-current={characterState === 'current' ? 'step' : undefined}>
          <span className="setup-index" aria-hidden="true">{characterState === 'complete' ? '✓' : '3'}</span>
          <div className="setup-step-copy">
            <div className="setup-step-title"><strong>Confirm character and mode</strong><span>{statusLabel(characterState)}</span></div>
            <p>{setup.selectionRequired ? 'Choose the matching character or mode below.' : setup.characterResolved ? 'The first scan confirmed the character and mode.' : setup.logsConfigured ? 'The first scan checks whether a choice is needed.' : 'This is checked after the Logs folder is configured.'}</p>
          </div>
          {characterState === 'current' && !setup.selectionRequired && <button className="secondary-button setup-action" onClick={onSync} disabled={busy}>Scan Logs</button>}
        </li>

        <li className={`setup-step is-${syncState}`} aria-current={syncState === 'current' ? 'step' : undefined}>
          <span className="setup-index" aria-hidden="true">{syncState === 'complete' ? '✓' : '4'}</span>
          <div className="setup-step-copy">
            <div className="setup-step-title"><strong>Confirm healthy sync</strong><span>{statusLabel(syncState)}</span></div>
            <p>{setup.syncHealthy ? `Last checked ${formatSyncTime(status.lastSyncAt)}.` : setup.selectionRequired ? 'Resolve the required choice before checking sync.' : setup.logsConfigured ? status.detail : 'A sync check runs after the required setup is complete.'}</p>
          </div>
          {syncState === 'current' && <button className="secondary-button setup-action" onClick={onSync} disabled={busy}>Check sync</button>}
        </li>
      </ol>
    </section>
  )
}

function formatMode(value) {
  if (value === 'pve') return 'PvE'
  if (value === 'pvp-season') return 'PvP Seasonal'
  if (value === 'regular') return 'PvP Permanent'
  return 'Unknown mode'
}

function EventRows({ rows }) {
  if (rows.length === 0) return <p className="scan-report-empty">No retained event details are available.</p>
  return (
    <ul className="scan-report-list">
      {rows.map((row, index) => (
        <li key={`${row.taskId}-${row.occurredAt || index}`}>
          <strong>{row.name}</strong>
          <span className="scan-report-event-state">State: {row.state}</span>
          {row.occurredAt && <time dateTime={row.occurredAt}>{formatSyncTime(row.occurredAt)}</time>}
        </li>
      ))}
    </ul>
  )
}

function UpdateCard({ installedVersion, state, onAction }) {
  const isChecking = state.phase === 'checking'
  const isDownloading = state.phase === 'downloading'
  const isInstalling = state.phase === 'installing'
  const isRestarting = state.phase === 'restarting'
  const isWorking = isChecking || isDownloading || isInstalling || isRestarting
  const hasUpdate = Boolean(state.update)
  const actionLabel = isChecking
    ? 'Checking…'
    : isDownloading || isInstalling
      ? 'Installing…'
      : isRestarting
        ? 'Restarting…'
        : hasUpdate && state.phase !== 'complete'
          ? state.phase === 'error' ? 'Try update again' : 'Install update'
          : state.phase === 'current' || state.phase === 'error' ? 'Check again' : 'Check for updates'
  const updateVersion = state.update?.version
  const notes = getReleaseNotes(state.update)

  return (
    <section className="settings-card update-card" aria-labelledby="update-title">
      <div className="update-copy">
        <p className="eyebrow">APPLICATION UPDATE</p>
        <h2 id="update-title">Keep the companion current</h2>
        <p>Installed version {installedVersion}. Signed updates are downloaded from the official release channel.</p>
        {updateVersion && <p className="update-available">Version {updateVersion} is ready to install.</p>}
        {notes && <p className="update-notes" title={notes}>{notes}</p>}
        {(isDownloading || isInstalling) && (
          <progress className="update-progress" value={state.progress} max="100" aria-label="Update progress" />
        )}
        <p className="update-status" role="status" aria-live="polite">{state.message}</p>
      </div>
      <button className="secondary-button" onClick={onAction} disabled={isWorking}>
        {actionLabel}
      </button>
    </section>
  )
}

export default function App() {
  const [service] = useState(() => getCompanionService())
  const [view, setView] = useState(() => service.getSnapshot())
  const [autostart, setAutostartState] = useState(false)
  const [busy, setBusy] = useState(true)
  const [installedVersion, setInstalledVersion] = useState('…')
  const [updateState, setUpdateState] = useState({ phase: 'idle', update: null, progress: 0, message: '' })
  const [actionNotice, setActionNotice] = useState('')
  const [profilesOpen, setProfilesOpen] = useState(false)
  const [eventsOpen, setEventsOpen] = useState(false)
  const [taskNames, setTaskNames] = useState(() => new Map())
  const rawStatus = view.status || DEFAULT_STATUS
  const status = normalizeStatus(rawStatus)
  const knownProfiles = status.knownProfiles || []
  const lastSuccessfulScan = status.lastSuccessfulScan || null
  const successfulEvents = lastSuccessfulScan?.events || EMPTY_EVENTS
  const eventRows = useMemo(() => buildSuccessfulScanRows(successfulEvents, taskNames), [successfulEvents, taskNames])

  useEffect(() => {
    if (successfulEvents.length === 0 || taskNames.size > 0) return undefined
    let active = true
    void loadTaskNames().then(names => { if (active) setTaskNames(names) }).catch(() => {})
    return () => { active = false }
  }, [successfulEvents.length, taskNames.size])

  useEffect(() => {
    let active = true
    const unsubscribe = service.subscribe(value => { if (active) setView(value) })
    void Promise.all([service.start(), readAutostart()])
      .then(([, nextAutostart]) => { if (active) setAutostartState(Boolean(nextAutostart)) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false; unsubscribe() }
  }, [service])

  useEffect(() => {
    let active = true
    void getInstalledVersion().then(version => { if (active) setInstalledVersion(version) })
    return () => { active = false }
  }, [])

  const run = useCallback(async (operation, fallback) => {
    setBusy(true)
    setActionNotice('')
    try { await operation() } catch { setActionNotice(fallback) } finally { setBusy(false) }
  }, [])

  const refresh = useCallback(() => run(
    () => service.syncNow(),
    'The companion could not sync just now. It will retry automatically.',
  ), [run, service])

  const toggleAutostart = useCallback(async () => {
    const next = !autostart
    setAutostartState(next)
    try {
      await setAutostart(next)
      setActionNotice(next ? 'Companion will start with Windows.' : 'Windows autostart disabled.')
    } catch {
      setAutostartState(!next)
      setActionNotice('Could not update Windows autostart.')
    }
  }, [autostart])

  const checkForUpdates = useCallback(async () => {
    setUpdateState({ phase: 'checking', update: null, progress: 0, message: 'Checking for signed updates…' })
    try {
      const update = await checkForUpdate()
      if (!update) {
        setUpdateState({ phase: 'current', update: null, progress: 0, message: 'You’re up to date.' })
        return
      }
      setUpdateState({ phase: 'available', update, progress: 0, message: 'A signed update is ready.' })
    } catch (error) {
      setUpdateState({ phase: 'error', update: null, progress: 0, message: getUpdaterErrorMessage(error) })
    }
  }, [])

  const installUpdate = useCallback(async () => {
    const update = updateState.update
    if (!update) return checkForUpdates()

    setUpdateState(previous => ({ ...previous, phase: 'downloading', progress: 0, message: 'Downloading signed update…' }))
    try {
      await downloadAndInstall(update, progress => {
        setUpdateState(previous => ({
          ...previous,
          phase: progress.phase === 'installing' ? 'installing' : 'downloading',
          progress: Number.isFinite(progress.percent) ? progress.percent : previous.progress,
          message: progress.phase === 'installing' ? 'Installing update…' : 'Downloading signed update…',
        }))
      })
      setUpdateState(previous => ({ ...previous, phase: 'restarting', progress: 100, message: 'Restarting the companion…' }))
      const restarted = await restartAfterUpdate()
      setUpdateState(previous => ({
        ...previous,
        phase: 'complete',
        message: restarted ? 'Update installed. Restarting the companion…' : 'Update installed. Restart the companion to finish.',
      }))
    } catch (error) {
      setUpdateState(previous => ({ ...previous, phase: 'error', message: getUpdaterErrorMessage(error) }))
    }
  }, [checkForUpdates, updateState.update])

  const updateAction = updateState.update && (updateState.phase === 'available' || updateState.phase === 'error')
    ? installUpdate
    : checkForUpdates

  const notice = actionNotice || view.notice
  const roots = view.roots || {}
  const setup = getSetupProgress(view, rawStatus, roots)

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">TSP</div>
        <div>
          <p className="eyebrow">WINDOWS COMPANION</p>
          <h1>Tarkov Squad Planner</h1>
        </div>
        <button className="icon-button" onClick={refresh} disabled={busy || !view.authenticated} aria-label="Sync now" title="Check for new log entries">↻</button>
      </header>

      <section className={`status-card status-${status.state}`} aria-live="polite">
        <div className="status-orb" aria-hidden="true" />
        <div className="status-copy">
          <p className="eyebrow">COMPANION STATUS</p>
          <h2>{STATUS_LABELS[status.state]}</h2>
          <p>{status.detail}</p>
        </div>
        <span className="status-pill">{status.pendingCount} pending</span>
      </section>

      {notice && <p className="notice" role="status">{notice}</p>}

      <SetupProgress
        setup={setup}
        status={status}
        configured={view.configured}
        busy={busy}
        onSignIn={provider => run(() => service.signIn(provider), 'Secure sign-in could not be started.')}
        onSignOut={() => run(() => service.signOut(), 'Sign-out could not be completed.')}
        onChooseLogs={() => run(() => service.configureLogsRoot(), 'The Logs folder could not be configured.')}
        onSync={refresh}
      />

      {view.status?.selectionRequired === 'profile' && (
        <section className="choice-card">
          <p className="eyebrow">CHARACTER REQUIRED</p>
          <h2>Which character matches this planner mode?</h2>
          <p>Choose the mode you play now. The recommended option is based on recent activity, version, and quest events.</p>
          <div className="choice-buttons">
            {(view.status.selectionOptions || []).map(option => (
              <button key={option.value} className={`secondary-button choice-button ${option.recommended ? 'is-recommended' : ''}`} onClick={() => run(() => service.selectProfile(option.value), 'Character selection failed.')}>{option.recommended && <span className="recommend-badge">Recommended</span>}{option.label}</button>
            ))}
          </div>
        </section>
      )}

      {view.status?.selectionRequired === 'unknown-mode' && (
        <section className="choice-card">
          <p className="eyebrow">GAME MODE REQUIRED</p>
          <h2>Apply unlabelled events to which mode?</h2>
          <div className="choice-buttons">
            <button className="secondary-button" onClick={() => run(() => service.selectUnknownMode('regular'), 'Mode selection failed.')}>Regular</button>
            <button className="secondary-button" onClick={() => run(() => service.selectUnknownMode('pvp-season'), 'Mode selection failed.')}>PvP Seasonal</button>
            <button className="secondary-button" onClick={() => run(() => service.selectUnknownMode('pve'), 'Mode selection failed.')}>PvE</button>
          </div>
        </section>
      )}

      {!setup.incomplete && view.authenticated && (
        <section className="action-card">
          <div>
            <p className="eyebrow">SIGNED IN</p>
            <h2>{view.user?.email || 'Dudgy.net account'}</h2>
            <p>Quest logs and screenshot pings sync while this window is hidden.</p>
          </div>
          <button className="secondary-button" onClick={() => run(() => service.signOut(), 'Sign-out could not be completed.')} disabled={busy}>Sign out</button>
        </section>
      )}

      <section className={`settings-card folder-settings ${setup.logsConfigured ? '' : 'is-setup-priority'}`}>
        <div className="settings-heading">
          <p className="eyebrow">LOCAL EFT DATA</p>
          <h2>Watched folders</h2>
          <p>Choose folders directly from this PC. Quest sync requires Logs; Screenshots is optional for position pings. Screenshot image bytes are never read.</p>
        </div>
        <FolderSetting title="Logs" configured={setup.logsConfigured} onChoose={() => run(() => service.configureLogsRoot(), 'The Logs folder could not be configured.')} disabled={busy} />
        <FolderSetting title="Screenshots" optional configured={Boolean(roots.screenshotsRoot)} onChoose={() => run(() => service.configureScreenshotsRoot(), 'The Screenshots folder could not be configured.')} disabled={busy} />
      </section>

      {status.activeProfile && (
        <section className="choice-card active-profile" aria-label="Active EFT character">
          <div>
            <p className="eyebrow">CURRENT CHARACTER</p>
            <h2>{status.activeProfile.label}</h2>
            <p>This is the character being imported for this planner mode.</p>
          </div>
          <button className="secondary-button" onClick={() => run(() => service.changeProfile(), 'The character could not be changed.')} disabled={busy}>Change character</button>
        </section>
      )}

      {!setup.incomplete && <section className="metrics" aria-label="Sync metrics">
        <div className="metric"><span>Last sync</span><strong>{formatSyncTime(status.lastSyncAt)}</strong></div>
        <div className="metric"><span>Queue</span><strong>{status.pendingCount ? `${status.pendingCount} item${status.pendingCount === 1 ? '' : 's'}` : 'Clear'}</strong></div>
        {/* adapter.js guarantees finite metric values; absence is represented by scanMetrics itself. */}
        {status.scanMetrics && [
          ['Files scanned', status.scanMetrics.filesScanned],
          ['Quest events seen', status.scanMetrics.eventsSeen],
          ['Matched', status.scanMetrics.matchedEvents],
          ['Applied', status.scanMetrics.appliedEvents],
          ['Profiles found', status.scanMetrics.profilesFound],
        ].map(([label, value]) => (
          <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>
        ))}
        {status.scanMetrics?.mode && <div className="metric"><span>Character mode</span><strong>{status.scanMetrics.mode}</strong></div>}
      </section>}

      {!setup.incomplete && view.authenticated && roots.logsRoot && (
        <section className="settings-card rescan-card">
          <div>
            <p className="eyebrow">RECOVERY</p>
            <h2>Rebuild quest imports</h2>
            <p>Use this after changing characters or if a previous selection imported zero events. It rereads your relevant logs.</p>
          </div>
          <button className="secondary-button" onClick={() => run(() => service.fullRescan(), 'The full rescan could not be started.')} disabled={busy}>Full rescan</button>
        </section>
      )}

      {!setup.incomplete && (status.scanMetrics || knownProfiles.length || lastSuccessfulScan) ? (
        <section className="settings-card scan-report">
          <div className="settings-heading">
            <p className="eyebrow">DIAGNOSTICS</p>
            <h2>Last successful quest scan</h2>
          </div>
          {lastSuccessfulScan ? (
            <>
              <p className="scan-report-timestamp">
                <time dateTime={lastSuccessfulScan.completedAt}>{formatSyncTime(lastSuccessfulScan.completedAt)}</time>
                <span aria-hidden="true"> · </span>{formatMode(lastSuccessfulScan.mode)}
              </p>
              <div className="scan-report-summary" aria-label="Successful scan summary">
                <div><span>Files scanned</span><strong>{lastSuccessfulScan.filesScanned}</strong></div>
                <div><span>Quest events included</span><strong>{lastSuccessfulScan.eventsIncluded}</strong></div>
                <div><span>Planner changes</span><strong>{lastSuccessfulScan.plannerChanges}</strong></div>
              </div>
            </>
          ) : (
            <p className="scan-report-empty">No quest-bearing scan has completed yet. This card will retain the next successful result.</p>
          )}
          <div className="scan-report-disclosures">
            {knownProfiles.length > 0 && (
              <>
                <button
                  className="scan-report-disclosure"
                  type="button"
                  aria-expanded={profilesOpen}
                  aria-controls="scan-report-profiles"
                  onClick={() => setProfilesOpen(value => !value)}
                >
                  Characters found ({knownProfiles.length}) <span aria-hidden="true">{profilesOpen ? '⌃' : '⌄'}</span>
                </button>
                {profilesOpen && (
                  <div id="scan-report-profiles" className="scan-report-detail" role="region" aria-label="Characters found">
                  <ul className="scan-report-list">
                    {knownProfiles.map(profile => (
                      <li key={profile.value}>
                        <strong>{profile.label}</strong>
                        <span>{profile.mode || 'Mode unavailable'}</span>
                        {profile.recommended && <span className="scan-report-tag">Recommended</span>}
                        {profile.active && <span className="scan-report-active">Active</span>}
                      </li>
                    ))}
                  </ul>
                  </div>
                )}
              </>
            )}

            {lastSuccessfulScan && (
              <>
                <button
                  className="scan-report-disclosure"
                  type="button"
                  aria-expanded={eventsOpen}
                  aria-controls="scan-report-events"
                  onClick={() => setEventsOpen(value => !value)}
                >
                  Quest events included ({lastSuccessfulScan.eventsIncluded}) <span aria-hidden="true">{eventsOpen ? '⌃' : '⌄'}</span>
                </button>
                {eventsOpen && (
                  <div id="scan-report-events" className="scan-report-detail" role="region" aria-label="Quest events included in the last successful scan">
                    <EventRows rows={eventRows} />
                  </div>
                )}
              </>
            )}
          </div>
          {lastSuccessfulScan && <p className="scan-report-footnote">Showing {eventRows.length} of {lastSuccessfulScan.eventsIncluded} included events. New no-change checks will not replace this result.</p>}
        </section>
      ) : null}

      {setup.incomplete && (status.scanMetrics || knownProfiles.length || lastSuccessfulScan) && (
        <details className="deferred-tools">
          <summary>Diagnostics from the latest scan</summary>
          <div className="deferred-tools-copy">
            <p>Setup actions above are the fastest way to clear the current blocker.</p>
            {status.scanMetrics && <p>{status.scanMetrics.filesScanned} files scanned · {status.scanMetrics.eventsSeen} quest events seen · {status.scanMetrics.appliedEvents} applied</p>}
            {lastSuccessfulScan && <p>Last successful quest scan: {formatSyncTime(lastSuccessfulScan.completedAt)}.</p>}
          </div>
        </details>
      )}

      <UpdateCard installedVersion={installedVersion} state={updateState} onAction={updateAction} />

      <section className="settings-card">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h2>Start with Windows</h2>
          <p>Keep the companion ready for raid coordination when you sign in.</p>
        </div>
        <button className={`toggle ${autostart ? 'is-on' : ''}`} onClick={toggleAutostart} role="switch" aria-checked={autostart}>
          <span />
          <span className="sr-only">{autostart ? 'Disable' : 'Enable'} Windows autostart</span>
        </button>
      </section>

      <section className="settings-card">
        <div>
          <p className="eyebrow">APPLICATION</p>
          <h2>Quit companion</h2>
          <p>Stop background syncing and remove the companion from the system tray.</p>
        </div>
        <button className="secondary-button" onClick={() => run(() => quitCompanion(), 'The companion could not be closed.')} disabled={busy}>Quit</button>
      </section>

      <footer>Version {installedVersion}{status.scanMetrics?.scannerVersion && <> <span>•</span> Scanner {status.scanMetrics.scannerVersion}</>} <span>•</span> Runs quietly in your system tray</footer>
    </main>
  )
}
