import { cadenceOf } from '../tarkovPings'
import { useEftScreenshotSyncContext } from '../EftLogSyncContext'

export const STATE_TEXT = {
  idle: 'NOT SET UP',
  reading: 'CHECKING…',
  watching: 'WATCHING',
  'permission-needed': 'PERMISSION NEEDED',
  error: 'CHECK FAILED',
}

export default function EftScreenshotPings() {
  const sync = useEftScreenshotSyncContext({ optional: true })
  if (!sync) return null

  const watching = sync.state === 'watching'
  const busy = sync.state === 'reading'
  const cadence = sync.lastPing ? cadenceOf(sync.lastPing.taps) : null
  const skippedCount = sync.lastSkipped?.count || 0
  const status = !sync.persistentSupported
    ? 'CHROME / EDGE DESKTOP REQUIRED'
    : skippedCount > 0
      ? `${skippedCount} SCREENSHOT${skippedCount === 1 ? '' : 'S'} TOO OLD TO PING`
    : watching && !sync.readyForPings
      ? 'WAITING FOR PARTY MAP'
    : STATE_TEXT[sync.state] || 'READY'

  return (
    <div className="card" style={{ padding: '9px 11px', marginBottom: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span className={watching ? 'mon-dot mon-dot-live' : 'mon-dot'} style={{ background: watching ? 'var(--grn)' : 'var(--txd)' }} />
          <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: watching ? 'var(--grn)' : 'var(--txm)', letterSpacing: '.06em' }}>
            LOCAL SCREENSHOT PINGS · {status}
          </span>
          {sync.pending > 0 && <span className="mono" style={{ color: 'var(--gold)' }}>{'●'.repeat(sync.pending)}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {!sync.folderName && sync.persistentSupported && (
            <button className="btn-gold btn-sm" disabled={busy} onClick={() => { sync.connect().catch(() => {}) }}>
              CHOOSE SCREENSHOTS
            </button>
          )}
          {sync.folderName && sync.state === 'permission-needed' && (
            <button className="btn-gold btn-sm" onClick={() => sync.reconnect()}>RECONNECT</button>
          )}
          {sync.folderName && sync.state !== 'permission-needed' && (
            <button className="btn-ghost btn-sm" disabled={busy} onClick={() => sync.checkNow()}>CHECK</button>
          )}
          {sync.folderName && <button className="btn-ghost btn-sm" onClick={() => sync.forget()}>FORGET</button>}
        </div>
      </div>
      <div style={{ marginTop: 5, color: 'var(--txd)', fontSize: 'var(--fs-xs)', lineHeight: 1.5 }}>
        {!sync.persistentSupported
          ? 'LOCAL FOLDER WATCHING NEEDS THE DESKTOP VERSION OF CHROME OR EDGE.'
          : sync.folderName
          ? `${sync.folderName} · PRESS EFT'S SCREENSHOT KEY TO PING. ONLY THE FILENAME AND FILE TIME ARE READ; THE IMAGE NEVER LEAVES THIS PC.`
          : 'ONE-TIME SETUP: CHOOSE DOCUMENTS\\ESCAPE FROM TARKOV\\SCREENSHOTS. EXISTING SCREENSHOTS ARE BASELINED, NOT REPLAYED.'}
      </div>
      {sync.error && <div role="alert" style={{ marginTop: 5, color: 'var(--red)', fontSize: 'var(--fs-xs)' }}>{sync.error}</div>}
      {skippedCount > 0 && (
        <div role="alert" style={{ marginTop: 5, color: 'var(--goldtx)', fontSize: 'var(--fs-xs)' }}>
          {skippedCount} SCREENSHOT{skippedCount === 1 ? '' : 'S'} TOO OLD TO PING · KEEP THIS TAB OPEN OR USE THE DESKTOP APP
        </div>
      )}
      {cadence && (
        <div role="status" style={{ marginTop: 5, color: cadence.color, fontSize: 'var(--fs-xs)' }}>
          PING SENT · {cadence.label}{sync.lastPing.floor ? ` · ${sync.lastPing.floor}` : ''}
        </div>
      )}
    </div>
  )
}
