import { useSyncPresenceContext } from '../EftLogSyncContext'
import { fullDate, sourceLabel, syncChip } from '../syncStatus'

function StatusChip({ chip }) {
  const tooltipId = `sync-${chip.service}-tooltip`
  return (
    <span className={`sync-status-chip sync-status-${chip.tone}`} tabIndex={0} aria-describedby={tooltipId}>
      <span className="sync-status-dot" aria-hidden="true" />
      <span>{chip.label}</span>
      <span className="sync-status-summary">{chip.summary}</span>
      <span className="sync-status-tooltip" id={tooltipId} role="tooltip">
        <strong>{chip.label === 'LOGS' ? 'Quest log sync' : 'Screenshot ping sync'}</strong>
        {chip.rows.length === 0 ? <span>Not configured in the website or desktop app.</span> : chip.rows.map(row => (
          <span key={`${row.client_source}:${row.service}`}>
            {sourceLabel(row.client_source)}: {row.configured ? row.detail || row.state.replace('_', ' ') : 'Not configured'}
            <small>Current status: {row.is_live ? row.state.replace('_', ' ') : 'not currently running'} · Last sync: {fullDate(row.last_sync_at)}</small>
          </span>
        ))}
      </span>
    </span>
  )
}

export default function SyncStatusChips() {
  const rows = useSyncPresenceContext()
  return (
    <div className="sync-status-chips" aria-label="EFT sync status">
      <StatusChip chip={syncChip('logs', rows)} />
      <StatusChip chip={syncChip('pings', rows)} />
    </div>
  )
}
