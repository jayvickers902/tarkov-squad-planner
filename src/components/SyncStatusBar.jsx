import { useEffect, useRef, useState } from 'react'
import { useEftLogSync, useEftScreenshotSyncContext } from '../EftLogSyncContext'
import { channelStatus, monitorHealth, relativeTime } from '../syncStatus'

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

function ChannelChip({ channel, title, status, now, onClick, buttonRef, monitor = false }) {
  const meta = monitor
    ? status.label
    : (status.lastCheckedMs === null ? status.label : relativeTime(status.lastCheckedMs, now))
  const ariaState = status.label.toLowerCase()
  const ariaLabel = monitor
    ? `Local sync monitor: ${ariaState}`
    : `${title} sync: ${ariaState}, last checked ${relativeAccessible(status.lastCheckedMs, now)}`
  return (
    <button
      ref={buttonRef}
      type="button"
      className="btn-ghost btn-sm sync-chip"
      data-channel={monitor ? 'monitor' : channel.toLowerCase()}
      data-tone={status.tone}
      aria-expanded={Boolean(onClick.open)}
      aria-haspopup="dialog"
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

export default function SyncStatusBar({ onMyQuests }) {
  const logs = useEftLogSync({ optional: true })
  const shots = useEftScreenshotSyncContext({ optional: true })
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

  const logStatus = channelStatus(logs, { now })
  const screenshotStatus = channelStatus(shots, { now })
  const health = monitorHealth({ logs, shots, now, visible })

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

  return (
    <div className="sync-status-bar" ref={barRef}>
      <ChannelChip channel="LOGS" title="Quest log" status={logStatus} now={now} buttonRef={node => { buttonRefs.current.logs = node }} onClick={{ open: openKey === 'logs', handler: () => toggle('logs') }} />
      <ChannelChip channel="PINGS" title="Screenshot" status={screenshotStatus} now={now} buttonRef={node => { buttonRefs.current.shots = node }} onClick={{ open: openKey === 'shots', handler: () => toggle('shots') }} />
      <ChannelChip channel="MONITOR" status={health} now={now} monitor buttonRef={node => { buttonRefs.current.monitor = node }} onClick={{ open: openKey === 'monitor', handler: () => toggle('monitor') }} />

      {openKey === 'logs' && (
        <div className="card sync-popover" role="dialog" aria-modal="false" aria-labelledby="sync-popover-logs-title" id="sync-popover-logs">
          <div className="sync-popover-head">
            <h2 id="sync-popover-logs-title">LOGS SYNC</h2>
            <button type="button" className="btn-ghost btn-sm" aria-label="Close logs sync" onClick={() => closePopover()}>✕</button>
          </div>
          <p>{popoverDetail(logStatus)}</p>
          {logs.rememberedFolderName && <div className="mono sync-popover-row"><span>FOLDER · {logFolder}</span></div>}
          <div className="mono sync-popover-row"><span>LAST CHECK · {relativeTime(logStatus.lastCheckedMs, now) || 'NOT CHECKED YET'}</span></div>
          {logs.pendingJob && <div className="mono sync-popover-row"><span>UNFINISHED IMPORT · {logs.pendingJob.applied || 0}/{logs.pendingJob.total || 0} EVENTS APPLIED</span></div>}
          <div className="sync-popover-actions">
            <button type="button" className="btn-ghost btn-sm" onClick={() => runAction(logs.checkNow)} disabled={logs.state === 'reading' || logs.state === 'applying'}>CHECK NOW</button>
            {logReconnect && <button type="button" className="btn-ghost btn-sm" onClick={() => runAction(logs.reconnectRememberedFolder)}>RECONNECT</button>}
            <button type="button" className="btn-danger btn-sm" onClick={() => runAction(logs.forgetFolder)} disabled={!logs.rememberedFolderName}>FORGET FOLDER</button>
            <button type="button" className="btn-ghost btn-sm sync-popover-link" onClick={() => { onMyQuests?.(); closePopover(false) }}>QUEST MANAGER →</button>
          </div>
        </div>
      )}

      {openKey === 'shots' && (
        <div className="card sync-popover" role="dialog" aria-modal="false" aria-labelledby="sync-popover-shots-title" id="sync-popover-shots">
          <div className="sync-popover-head">
            <h2 id="sync-popover-shots-title">PINGS SYNC</h2>
            <button type="button" className="btn-ghost btn-sm" aria-label="Close shots sync" onClick={() => closePopover()}>✕</button>
          </div>
          <p>{popoverDetail(screenshotStatus)}</p>
          {screenshotStatus.tone === 'ok' && shots.readyForPings === false && (
            <p className="mono sync-popover-note">Watching, but pings need an active party map before they can be placed.</p>
          )}
          {(shots.folderName || shots.rememberedFolderName) && <div className="mono sync-popover-row"><span>FOLDER · {screenshotFolder}</span></div>}
          <div className="mono sync-popover-row"><span>LAST CHECK · {relativeTime(screenshotStatus.lastCheckedMs, now) || 'NOT CHECKED YET'}</span></div>
          {shots.lastScreenshot && <div className="mono sync-popover-row"><span>LAST SCREENSHOT · {relativeTime(timestampMsForScreenshot(shots.lastScreenshot), now) || 'JUST NOW'}</span></div>}
          {shots.lastPing && <div className="mono sync-popover-row"><span>LAST PING · {shots.lastPing.map || 'UNKNOWN MAP'}{shots.lastPing.floor ? ` · ${shots.lastPing.floor}` : ''}</span></div>}
          {shots.pending > 0 && <div className="mono sync-popover-row"><span>PENDING · {shots.pending}</span></div>}
          <div className="sync-popover-actions">
            <button type="button" className="btn-ghost btn-sm" onClick={() => runAction(shots.checkNow)} disabled={!shots.supported}>CHECK NOW</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => runAction(shots.folderName || shots.rememberedFolderName ? shots.reconnect : shots.connect)} disabled={!shots.supported}>{shotConnectLabel}</button>
            <button type="button" className="btn-danger btn-sm" onClick={() => runAction(shots.forget)} disabled={!shots.folderName && !shots.rememberedFolderName}>FORGET FOLDER</button>
          </div>
        </div>
      )}

      {openKey === 'monitor' && (
        <div className="card sync-popover" role="dialog" aria-modal="false" aria-labelledby="sync-popover-monitor-title" id="sync-popover-monitor">
          <div className="sync-popover-head">
            <h2 id="sync-popover-monitor-title">MONITOR</h2>
            <button type="button" className="btn-ghost btn-sm" aria-label="Close monitor" onClick={() => closePopover()}>✕</button>
          </div>
          <PopoverRow label="LOGS" status={logStatus}>Quest log sync is {logStatus.label.toLowerCase()}.</PopoverRow>
          <PopoverRow label="PINGS" status={screenshotStatus}>Screenshot sync is {screenshotStatus.label.toLowerCase()}.</PopoverRow>
          <PopoverRow label="TAB VISIBLE" status={{ tone: visible ? 'ok' : 'warn' }}>{visible ? 'The tab is visible for reliable background checks.' : 'The tab is hidden, so background checks may be delayed.'}</PopoverRow>
          {(logStatus.tone === 'off' || screenshotStatus.tone === 'off') && <p>Local folder sync uses Chromium-only File System Access.</p>}
        </div>
      )}
    </div>
  )
}
