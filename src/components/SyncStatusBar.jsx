import { useEffect, useRef, useState } from 'react'
import { useEftLogSync, useEftScreenshotSyncContext } from '../EftLogSyncContext'
import { channelStatus, companionChannelStatus, healthiestChannelStatus, monitorHealth, relativeTime, sourceLabel } from '../syncStatus'
import { useCompanionSyncStatus } from '../useCompanionSyncStatus'

function safeFolderName(value) {
  const parts = String(value || '').split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || 'REMEMBERED FOLDER'
}

function popoverDetail(status) {
  return status.tone === 'off' ? 'Local folder sync is unavailable in this channel.' : status.detail
}

function runAction(action) {
  try {
    Promise.resolve(action?.()).catch(() => {})
  } catch {
    // Controllers own the visible error state.
  }
}

function relativeAccessible(timestamp, now) {
  if (timestamp === null || timestamp === undefined) return 'not checked yet'
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < 60 * 1000) return 'just now'
  if (elapsed < 60 * 60 * 1000) {
    const minutes = Math.floor(elapsed / (60 * 1000))
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  if (elapsed < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(elapsed / (60 * 60 * 1000))
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  return 'more than 1 day ago'
}

function ChannelChip({ channel, title, status, now, onClick, buttonRef, monitor = false, embedded = false }) {
  const meta = monitor
    ? status.label
    : (status.source === 'desktop' || status.lastCheckedMs === null
      ? status.label
      : relativeTime(status.lastCheckedMs, now))
  const ariaState = status.label.toLowerCase()
  const source = status.source ? ` via ${sourceLabel(status.source)}` : ''
  const timing = status.source === 'desktop'
    ? `, last report ${relativeAccessible(status.lastReportedMs, now)}, last successful check ${relativeAccessible(status.lastCheckedMs, now)}`
    : `, last successful check ${relativeAccessible(status.lastCheckedMs, now)}`
  const ariaLabel = monitor
    ? `Local sync monitor: ${ariaState}`
    : `${title} sync: ${ariaState}${source}${timing}`
  return (
    <button
      ref={buttonRef}
      type="button"
      className="btn-ghost btn-sm sync-chip"
      data-channel={monitor ? 'monitor' : channel.toLowerCase()}
      data-tone={status.tone}
      aria-expanded={Boolean(onClick.open)}
      aria-haspopup={embedded ? undefined : 'dialog'}
      aria-label={ariaLabel}
      onClick={onClick.handler}
    >
      <span className="sync-chip-dot" aria-hidden="true" />
      <span className="sync-chip-label">{channel}</span>
      <span className="mono sync-chip-meta">{meta}</span>
    </button>
  )
}

function PopoverRow({ label, status, children }) {
  return (
    <div className="sync-popover-row">
      <span className="mono">{label}</span>
      <span className="sync-chip-dot" data-tone={status.tone} aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

function timestampMsForScreenshot(screenshot) {
  if (typeof screenshot?.at === 'number') return screenshot.at
  const time = Date.parse(screenshot?.at || '')
  return Number.isFinite(time) ? time : null
}

function TimingRows({ status, changeLabel = 'LAST DATA CHANGE', now }) {
  return (
    <>
      {status.source === 'desktop' && (
        <div className="mono sync-popover-row"><span>LAST REPORT · {relativeTime(status.lastReportedMs, now) || 'NOT REPORTED YET'}</span></div>
      )}
      <div className="mono sync-popover-row"><span>LAST SUCCESSFUL CHECK · {relativeTime(status.lastCheckedMs, now) || 'NOT CHECKED YET'}</span></div>
      {status.lastChangedMs !== null && status.lastChangedMs !== undefined && (
        <div className="mono sync-popover-row"><span>{changeLabel} · {relativeTime(status.lastChangedMs, now) || 'JUST NOW'}</span></div>
      )}
    </>
  )
}

export default function SyncStatusBar({ onMyQuests, embedded = false }) {
  const logs = useEftLogSync({ optional: true })
  const shots = useEftScreenshotSyncContext({ optional: true })
  const companion = useCompanionSyncStatus({ optional: true })
  const [openKey, setOpenKey] = useState(null)
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  const barRef = useRef(null)
  const buttonRefs = useRef({})
  const openerKeyRef = useRef(null)
  // The chips report "how long since the last check", so they have to re-render
  // on their own. Without this the relative time freezes at whatever the last
  // unrelated render produced, which reads as a stalled sync.
  const [, setTick] = useState(0)
  const now = Date.now()

  useEffect(() => {
    const id = setInterval(() => setTick(value => value + 1), 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    function onVisibilityChange() {
      setVisible(document.visibilityState !== 'hidden')
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  useEffect(() => {
    if (!openKey) return undefined
    function onKeyDown(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      const opener = openerKeyRef.current
      setOpenKey(null)
      buttonRefs.current[opener]?.focus()
    }
    function onMouseDown(event) {
      if (barRef.current?.contains(event.target)) return
      const opener = openerKeyRef.current
      setOpenKey(null)
      buttonRefs.current[opener]?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [openKey])

  if (!logs || !shots) return null

  const localLogStatus = channelStatus(logs, { now })
  const localScreenshotStatus = channelStatus(shots, { now })
  const companionLogStatus = companion?.available ? companionChannelStatus(companion.statuses.logs, { now }) : null
  const companionScreenshotStatus = companion?.available ? companionChannelStatus(companion.statuses.pings, { now }) : null
  const logStatus = healthiestChannelStatus(localLogStatus, companionLogStatus)
  const screenshotStatus = healthiestChannelStatus(localScreenshotStatus, companionScreenshotStatus)
  const health = monitorHealth({
    logs,
    shots,
    now,
    visible,
    statuses: { logs: logStatus, pings: screenshotStatus },
  })

  function closePopover(restoreFocus = true) {
    const opener = openerKeyRef.current
    setOpenKey(null)
    if (restoreFocus) buttonRefs.current[opener]?.focus()
  }

  function toggle(key) {
    if (openKey === key) {
      closePopover()
      return
    }
    openerKeyRef.current = key
    setOpenKey(key)
  }

  const logFolder = safeFolderName(logs.rememberedFolderName)
  const screenshotFolder = safeFolderName(shots.folderName || shots.rememberedFolderName)
  const logReconnect = logs.state === 'permission-needed'
    || Boolean(logs.rememberedFolderName && logs.state !== 'watching' && logs.state !== 'reading')
  const shotConnectLabel = shots.folderName || shots.rememberedFolderName ? 'RECONNECT' : 'CONNECT'
  const localLogSupported = logs.supported !== false && logs.persistentSupported !== false
  const localLogConfigured = localLogSupported && Boolean(logs.rememberedFolderName)
  const localScreenshotSupported = shots.supported !== false
  const localScreenshotConfigured = localScreenshotSupported && Boolean(shots.folderName || shots.rememberedFolderName)
  const browserSelected = logStatus.source === 'browser' || screenshotStatus.source === 'browser'
  const detailClassName = embedded ? 'sync-embedded-detail' : 'card sync-popover'
  const detailRole = embedded ? 'group' : 'dialog'

  return (
    <div className={`sync-status-bar${embedded ? ' sync-status-bar-embedded' : ''}`} ref={barRef}>
      <div className="sync-chip-list">
        <ChannelChip embedded={embedded} channel="LOGS" title="Quest log" status={logStatus} now={now} buttonRef={node => { buttonRefs.current.logs = node }} onClick={{ open: openKey === 'logs', handler: () => toggle('logs') }} />
        <ChannelChip embedded={embedded} channel="PINGS" title="Screenshot" status={screenshotStatus} now={now} buttonRef={node => { buttonRefs.current.shots = node }} onClick={{ open: openKey === 'shots', handler: () => toggle('shots') }} />
        <ChannelChip embedded={embedded} channel="MONITOR" status={health} now={now} monitor buttonRef={node => { buttonRefs.current.monitor = node }} onClick={{ open: openKey === 'monitor', handler: () => toggle('monitor') }} />
      </div>

      {openKey === 'logs' && (
        <div className={detailClassName} role={detailRole} aria-modal={embedded ? undefined : 'false'} aria-labelledby="sync-popover-logs-title" id="sync-popover-logs">
          <div className="sync-popover-head">
            <h2 id="sync-popover-logs-title">LOGS SYNC</h2>
            <button type="button" className="btn-ghost btn-sm" aria-label="Close logs sync" onClick={() => closePopover()}>✕</button>
          </div>
          <p>{popoverDetail(logStatus)}</p>
          <div className="mono sync-popover-row"><span>ACTIVE SOURCE · {sourceLabel(logStatus.source).toUpperCase()}</span></div>
          <TimingRows status={logStatus} changeLabel="LAST QUEST CHANGE" now={now} />
          {localLogConfigured && <div className="mono sync-popover-row"><span>WEBSITE FOLDER · {logFolder}</span></div>}
          {localLogConfigured && logs.pendingJob && <div className="mono sync-popover-row"><span>UNFINISHED WEBSITE IMPORT · {logs.pendingJob.applied || 0}/{logs.pendingJob.total || 0} EVENTS APPLIED</span></div>}
          {logStatus.source === 'desktop' && !localLogConfigured && <p>The desktop app manages this channel. You can also connect a website folder as a fallback while this tab is open.</p>}
          <div className="sync-popover-actions">
            {localLogConfigured && <button type="button" className="btn-ghost btn-sm" onClick={() => runAction(logs.checkNow)} disabled={logs.state === 'reading' || logs.state === 'applying'}>CHECK WEBSITE FOLDER</button>}
            {localLogSupported && !localLogConfigured && <button type="button" className="btn-ghost btn-sm" onClick={() => runAction(logs.connectRememberedFolder)}>CONNECT WEBSITE FOLDER</button>}
            {localLogConfigured && logReconnect && <button type="button" className="btn-ghost btn-sm" onClick={() => runAction(logs.reconnectRememberedFolder)}>RECONNECT WEBSITE FOLDER</button>}
            {localLogConfigured && <button type="button" className="btn-danger btn-sm" onClick={() => runAction(logs.forgetFolder)}>FORGET WEBSITE FOLDER</button>}
            <button type="button" className="btn-ghost btn-sm sync-popover-link" onClick={() => { onMyQuests?.(); closePopover(false) }}>QUEST MANAGER →</button>
          </div>
        </div>
      )}

      {openKey === 'shots' && (
        <div className={detailClassName} role={detailRole} aria-modal={embedded ? undefined : 'false'} aria-labelledby="sync-popover-shots-title" id="sync-popover-shots">
          <div className="sync-popover-head">
            <h2 id="sync-popover-shots-title">PINGS SYNC</h2>
            <button type="button" className="btn-ghost btn-sm" aria-label="Close shots sync" onClick={() => closePopover()}>✕</button>
          </div>
          <p>{popoverDetail(screenshotStatus)}</p>
          <div className="mono sync-popover-row"><span>ACTIVE SOURCE · {sourceLabel(screenshotStatus.source).toUpperCase()}</span></div>
          <TimingRows status={screenshotStatus} now={now} />
          {screenshotStatus.source === 'browser' && screenshotStatus.tone === 'ok' && shots.readyForPings === false && (
            <p className="mono sync-popover-note">Watching, but pings need an active party map before they can be placed.</p>
          )}
          {(shots.folderName || shots.rememberedFolderName) && <div className="mono sync-popover-row"><span>WEBSITE FOLDER · {screenshotFolder}</span></div>}
          {localScreenshotConfigured && shots.lastScreenshot && <div className="mono sync-popover-row"><span>LAST WEBSITE SCREENSHOT · {relativeTime(timestampMsForScreenshot(shots.lastScreenshot), now) || 'JUST NOW'}</span></div>}
          {localScreenshotConfigured && shots.lastPing && <div className="mono sync-popover-row"><span>LAST WEBSITE PING · {shots.lastPing.map || 'UNKNOWN MAP'}{shots.lastPing.floor ? ` · ${shots.lastPing.floor}` : ''}</span></div>}
          {localScreenshotConfigured && shots.pending > 0 && <div className="mono sync-popover-row"><span>WEBSITE PENDING · {shots.pending}</span></div>}
          {screenshotStatus.source === 'desktop' && !localScreenshotConfigured && <p>The desktop app manages this channel. You can also connect a website screenshot folder while this tab is open.</p>}
          <div className="sync-popover-actions">
            {localScreenshotConfigured && <button type="button" className="btn-ghost btn-sm" onClick={() => runAction(shots.checkNow)}>CHECK WEBSITE FOLDER</button>}
            {localScreenshotSupported && <button type="button" className="btn-ghost btn-sm" onClick={() => runAction(localScreenshotConfigured ? shots.reconnect : shots.connect)}>{shotConnectLabel} WEBSITE FOLDER</button>}
            {localScreenshotConfigured && <button type="button" className="btn-danger btn-sm" onClick={() => runAction(shots.forget)}>FORGET WEBSITE FOLDER</button>}
            <button type="button" className="btn-ghost btn-sm sync-popover-link" onClick={() => { onMyQuests?.(); closePopover(false) }}>QUEST MANAGER →</button>
          </div>
        </div>
      )}

      {openKey === 'monitor' && (
        <div className={detailClassName} role={detailRole} aria-modal={embedded ? undefined : 'false'} aria-labelledby="sync-popover-monitor-title" id="sync-popover-monitor">
          <div className="sync-popover-head">
            <h2 id="sync-popover-monitor-title">MONITOR</h2>
            <button type="button" className="btn-ghost btn-sm" aria-label="Close monitor" onClick={() => closePopover()}>✕</button>
          </div>
          <PopoverRow label="LOGS" status={logStatus}>Quest log sync is {logStatus.label.toLowerCase()} via {sourceLabel(logStatus.source)}.</PopoverRow>
          <PopoverRow label="PINGS" status={screenshotStatus}>Screenshot sync is {screenshotStatus.label.toLowerCase()} via {sourceLabel(screenshotStatus.source)}.</PopoverRow>
          <PopoverRow label="WEBSITE TAB" status={{ tone: browserSelected ? (visible ? 'ok' : 'warn') : 'idle' }}>{browserSelected ? (visible ? 'The tab is visible for website folder checks.' : 'The tab is hidden, so website folder checks may be delayed.') : 'The active desktop sources do not depend on this tab.'}</PopoverRow>
          {(logStatus.tone === 'off' || screenshotStatus.tone === 'off') && <p>Local folder sync uses Chromium-only File System Access.</p>}
        </div>
      )}
    </div>
  )
}
