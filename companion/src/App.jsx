import { useCallback, useEffect, useMemo, useState } from 'react'
import { version as appVersion } from '../package.json'
import { DEFAULT_STATUS, normalizeStatus } from './adapter.js'
import { getCompanionService } from './service.js'
import { quitCompanion, readAutostart, setAutostart } from './tauri.js'
import { buildEventRows, loadTaskNames } from './scanReport.js'

const STATUS_LABELS = {
  offline: 'Offline',
  connecting: 'Connecting',
  connected: 'Connected',
  error: 'Needs attention',
}

function formatSyncTime(value) {
  if (!value) return 'Never'
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? 'Unknown' : parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function FolderSetting({ title, configured, onChoose, disabled }) {
  return (
    <div className="folder-row">
      <div>
        <h3>{title}</h3>
        <p>{configured ? 'Configured locally' : 'Not configured'}</p>
      </div>
      <button className="secondary-button" onClick={onChoose} disabled={disabled}>Choose folder</button>
    </div>
  )
}

function EventRows({ rows }) {
  if (rows.length === 0) return <p className="scan-report-empty">No events in the recent scan.</p>
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

export default function App() {
  const [service] = useState(() => getCompanionService())
  const [view, setView] = useState(() => service.getSnapshot())
  const [autostart, setAutostartState] = useState(false)
  const [busy, setBusy] = useState(true)
  const [actionNotice, setActionNotice] = useState('')
  const [profilesOpen, setProfilesOpen] = useState(false)
  const [eventsOpen, setEventsOpen] = useState(false)
  const [taskNames, setTaskNames] = useState(() => new Map())
  const status = normalizeStatus(view.status || DEFAULT_STATUS)
  const knownProfiles = status.knownProfiles || []
  const recentEvents = status.recentEvents || []
  const eventRows = useMemo(() => buildEventRows(recentEvents, taskNames), [recentEvents, taskNames])

  useEffect(() => {
    if (recentEvents.length === 0 || taskNames.size > 0) return undefined
    let active = true
    void loadTaskNames().then(names => { if (active) setTaskNames(names) }).catch(() => {})
    return () => { active = false }
  }, [recentEvents.length, taskNames.size])

  useEffect(() => {
    let active = true
    const unsubscribe = service.subscribe(value => { if (active) setView(value) })
    void Promise.all([service.start(), readAutostart()])
      .then(([, nextAutostart]) => { if (active) setAutostartState(Boolean(nextAutostart)) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false; unsubscribe() }
  }, [service])

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

  const notice = actionNotice || view.notice
  const roots = view.roots || {}

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

      {!view.authenticated ? (
        <section className="action-card">
          <div>
            <p className="eyebrow">DUDGY.NET ACCOUNT</p>
            <h2>Connect your planner</h2>
            <p>Sign in through your system browser. Session credentials stay in Windows Credential Manager.</p>
          </div>
          <button className="primary-button" onClick={() => run(() => service.signIn(), 'Secure sign-in could not be started.')} disabled={busy || !view.configured}>Sign in</button>
        </section>
      ) : (
        <section className="action-card">
          <div>
            <p className="eyebrow">SIGNED IN</p>
            <h2>{view.user?.email || 'Dudgy.net account'}</h2>
            <p>Quest logs and screenshot pings sync while this window is hidden.</p>
          </div>
          <button className="secondary-button" onClick={() => run(() => service.signOut(), 'Sign-out could not be completed.')} disabled={busy}>Sign out</button>
        </section>
      )}

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

      <section className="metrics" aria-label="Sync metrics">
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
      </section>

      {view.authenticated && roots.logsRoot && (
        <section className="settings-card rescan-card">
          <div>
            <p className="eyebrow">RECOVERY</p>
            <h2>Rebuild quest imports</h2>
            <p>Use this after changing characters or if a previous selection imported zero events. It rereads your relevant logs.</p>
          </div>
          <button className="secondary-button" onClick={() => run(() => service.fullRescan(), 'The full rescan could not be started.')} disabled={busy}>Full rescan</button>
        </section>
      )}

      <section className="settings-card folder-settings">
        <div className="settings-heading">
          <p className="eyebrow">LOCAL EFT DATA</p>
          <h2>Watched folders</h2>
          <p>Only bounded log text and screenshot filenames are parsed. Screenshot image bytes are never read.</p>
        </div>
        <FolderSetting title="Logs" configured={Boolean(roots.logsRoot)} onChoose={() => run(() => service.configureLogsRoot(), 'The Logs folder could not be configured.')} disabled={busy} />
        <FolderSetting title="Screenshots" configured={Boolean(roots.screenshotsRoot)} onChoose={() => run(() => service.configureScreenshotsRoot(), 'The Screenshots folder could not be configured.')} disabled={busy} />
      </section>

      {(status.scanMetrics || knownProfiles.length || recentEvents.length) ? (
        <section className="settings-card scan-report">
          <div className="settings-heading">
            <p className="eyebrow">DIAGNOSTICS</p>
            <h2>What the companion sees</h2>
          </div>
          <div className="scan-report-disclosures">
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
                {knownProfiles.length === 0 ? <p className="scan-report-empty">No characters detected yet — run a sync or a full rescan.</p> : (
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
                )}
              </div>
            )}

            <button
              className="scan-report-disclosure"
              type="button"
              aria-expanded={eventsOpen}
              aria-controls="scan-report-events"
              onClick={() => setEventsOpen(value => !value)}
            >
              Recent quest events ({recentEvents.length}) <span aria-hidden="true">{eventsOpen ? '⌃' : '⌄'}</span>
            </button>
            {eventsOpen && (
              <div id="scan-report-events" className="scan-report-detail" role="region" aria-label="Recent quest events">
                <h3>Applied on last sync</h3>
                <EventRows rows={eventRows.applied} />
                <h3>Not yet applied</h3>
                <EventRows rows={eventRows.pending} />
              </div>
            )}
          </div>
          <p className="scan-report-footnote">Showing the 25 most recent events from the last scan.</p>
        </section>
      ) : null}

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

      <footer>Version {appVersion}{status.scanMetrics?.scannerVersion && <> <span>•</span> Scanner {status.scanMetrics.scannerVersion}</>} <span>•</span> Runs quietly in your system tray</footer>
    </main>
  )
}
