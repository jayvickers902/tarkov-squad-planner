import { useCallback, useEffect, useState } from 'react'
import { version as appVersion } from '../package.json'
import { DEFAULT_STATUS, normalizeStatus } from './adapter.js'
import { getCompanionService } from './service.js'
import { quitCompanion, readAutostart, setAutostart } from './tauri.js'

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

export default function App() {
  const [service] = useState(() => getCompanionService())
  const [view, setView] = useState(() => service.getSnapshot())
  const [autostart, setAutostartState] = useState(false)
  const [busy, setBusy] = useState(true)
  const [actionNotice, setActionNotice] = useState('')
  const status = normalizeStatus(view.status || DEFAULT_STATUS)

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
        <button className="icon-button" onClick={refresh} disabled={busy || !view.authenticated} aria-label="Sync now" title="Sync now">↻</button>
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
          <p className="eyebrow">PROFILE REQUIRED</p>
          <h2>Which local EFT profile is yours?</h2>
          <div className="choice-buttons">
            {(view.status.selectionOptions || []).map(option => (
              <button key={option.value} className="secondary-button" onClick={() => run(() => service.selectProfile(option.value), 'Profile selection failed.')}>{option.label}</button>
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
            <button className="secondary-button" onClick={() => run(() => service.selectUnknownMode('pve'), 'Mode selection failed.')}>PvE</button>
          </div>
        </section>
      )}

      <section className="metrics" aria-label="Sync metrics">
        <div className="metric"><span>Last sync</span><strong>{formatSyncTime(status.lastSyncAt)}</strong></div>
        <div className="metric"><span>Queue</span><strong>{status.pendingCount ? `${status.pendingCount} item${status.pendingCount === 1 ? '' : 's'}` : 'Clear'}</strong></div>
      </section>

      <section className="settings-card folder-settings">
        <div className="settings-heading">
          <p className="eyebrow">LOCAL EFT DATA</p>
          <h2>Watched folders</h2>
          <p>Only bounded log text and screenshot filenames are parsed. Screenshot image bytes are never read.</p>
        </div>
        <FolderSetting title="Logs" configured={Boolean(roots.logsRoot)} onChoose={() => run(() => service.configureLogsRoot(), 'The Logs folder could not be configured.')} disabled={busy} />
        <FolderSetting title="Screenshots" configured={Boolean(roots.screenshotsRoot)} onChoose={() => run(() => service.configureScreenshotsRoot(), 'The Screenshots folder could not be configured.')} disabled={busy} />
      </section>

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

      <footer>Version {appVersion} <span>•</span> Runs quietly in your system tray</footer>
    </main>
  )
}
