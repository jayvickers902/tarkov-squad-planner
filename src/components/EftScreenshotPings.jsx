import { cadenceOf } from '../tarkovPings'
import { useEftScreenshotSyncContext } from '../EftLogSyncContext'

const STATE_TEXT = {
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
  const status = !sync.persistentSupported
    ? 'CHROME / EDGE DESKTOP REQUIRED'
    : watching && !sync.readyForPings
      ? 'WAITING FOR PARTY MAP'
    : STATE_TEXT[sync.state] || 'READY'

  return (
    <div className="card sync-strip">
      <div className="sync-strip-row">
        <div className="sync-strip-state">
          <span className={watching ? 'mon-dot mon-dot-live' : 'mon-dot'} style={{ background: watching ? 'var(--grn)' : 'var(--txd)' }} />
          <span className={`mono sync-strip-label${watching ? ' sync-strip-label-live' : ''}`}>
            LOCAL SCREENSHOT PINGS · {status}
          </span>
          {sync.pending > 0 && <span className="mono" style={{ color: 'var(--gold)' }}>{'●'.repeat(sync.pending)}</span>}
        </div>
        <div className="sync-strip-actions">
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
      <div className="mono sync-strip-note">
        {!sync.persistentSupported
          ? 'LOCAL FOLDER WATCHING NEEDS THE DESKTOP VERSION OF CHROME OR EDGE.'
          : sync.folderName
          ? `${sync.folderName} · PRESS EFT'S SCREENSHOT KEY TO PING. ONLY THE FILENAME AND FILE TIME ARE READ; THE IMAGE NEVER LEAVES THIS PC.`
          : 'ONE-TIME SETUP: CHOOSE DOCUMENTS\\ESCAPE FROM TARKOV\\SCREENSHOTS. EXISTING SCREENSHOTS ARE BASELINED, NOT REPLAYED.'}
      </div>
      {sync.error && <div className="mono sync-strip-error" role="alert">{sync.error}</div>}
      {cadence && (
        <div className="mono" role="status" style={{ marginTop: 5, color: cadence.color, fontSize: 10 }}>
          PING SENT · {cadence.label}{sync.lastPing.floor ? ` · ${sync.lastPing.floor}` : ''}
        </div>
      )}
    </div>
  )
}
