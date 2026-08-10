import { resolveSetting, settingSource, SYSTEM_DEFAULTS } from '../settings'
import useDialogFocus from '../useDialogFocus'

const TTL_OPTIONS = [
  { value: 2 * 60 * 1000, label: '2 MIN' },
  { value: 5 * 60 * 1000, label: '5 MIN' },
  { value: 10 * 60 * 1000, label: '10 MIN' },
  { value: 30 * 60 * 1000, label: '30 MIN' },
]

const CAP_OPTIONS = [4, 6, 8, 10, 12]

function sourceLabel(source) {
  return source === 'default' ? 'SYSTEM DEFAULT' : `${source.toUpperCase()} OVERRIDE`
}

function SettingRow({ label, source, children }) {
  return (
    <div className="raid-settings-row">
      <div className="raid-settings-label">
        <span>{label}</span>
        <span className="mono raid-settings-source">{sourceLabel(source)}</span>
      </div>
      <div className="raid-settings-control">{children}</div>
    </div>
  )
}

function YesNo({ value, disabled, onChange }) {
  return (
    <select value={value ? 'yes' : 'no'} disabled={disabled} onChange={event => onChange(event.target.value === 'yes')}>
      <option value="yes">YES</option>
      <option value="no">NO</option>
    </select>
  )
}

export default function RaidSettings({ party, userId, userSettings = {}, onChange, onClose }) {
  const dialogRef = useDialogFocus(true, onClose)
  const raid = party.settings || {}
  const layers = { raid, unit: null, user: userSettings }
  const isLeader = party.leader_id === userId
  const disabled = !isLeader
  const update = (key, value) => {
    if (!disabled) onChange?.({ [key]: value })
  }

  const ttl = Number(resolveSetting('ping_ttl_ms', layers))
  const cap = Number(resolveSetting('max_members', layers))
  const effectiveTtl = Number.isFinite(ttl) ? ttl : SYSTEM_DEFAULTS.ping_ttl_ms
  const effectiveCap = Number.isFinite(cap) && cap > 0 ? cap : SYSTEM_DEFAULTS.max_members
  const ttlOptions = TTL_OPTIONS.some(option => option.value === ttl)
    ? TTL_OPTIONS
    : [{ value: effectiveTtl, label: `${Math.round(effectiveTtl / 60000)} MIN` }, ...TTL_OPTIONS]
  const capOptions = CAP_OPTIONS.includes(effectiveCap) ? CAP_OPTIONS : [effectiveCap, ...CAP_OPTIONS]

  return (
    <div ref={dialogRef} className="raid-settings-popover card fade-in" role="dialog" aria-modal="true" aria-labelledby="raid-settings-title" tabIndex={-1}>
      <div className="raid-settings-head">
        <div>
          <div className="lbl" id="raid-settings-title">RAID SETTINGS</div>
          <div className="mono raid-settings-note">
            {isLeader ? 'LEADER CONTROLS · CHANGES APPLY TO THIS RAID' : 'READ ONLY · THE LEADER CONTROLS THIS RAID'}
          </div>
        </div>
        <button data-autofocus className="btn-ghost btn-sm" onClick={onClose} aria-label="Close raid settings">×</button>
      </div>

      <div className="raid-settings-list">
        <SettingRow label="PING TTL" source={settingSource('ping_ttl_ms', layers)}>
          <select value={effectiveTtl} disabled={disabled} onChange={event => update('ping_ttl_ms', Number(event.target.value))}>
            {ttlOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </SettingRow>

        <SettingRow label="MARKERS CLEAR ON RAID START" source={settingSource('marker_scope', layers)}>
          <YesNo value={resolveSetting('marker_scope', layers) === 'raid'} disabled={disabled} onChange={value => update('marker_scope', value ? 'raid' : 'persist')} />
        </SettingRow>

        <SettingRow label="DRAWINGS CLEAR ON RAID START" source={settingSource('drawing_scope', layers)}>
          <YesNo value={resolveSetting('drawing_scope', layers) === 'raid'} disabled={disabled} onChange={value => update('drawing_scope', value ? 'raid' : 'persist')} />
        </SettingRow>

        <SettingRow label="POST-RAID REPLAY" source={settingSource('replay_enabled', layers)}>
          <YesNo value={resolveSetting('replay_enabled', layers)} disabled={disabled} onChange={value => update('replay_enabled', value)} />
        </SettingRow>

        <SettingRow label="MEMBERS CAN CHANGE MAP" source={settingSource('members_can_change_map', layers)}>
          <YesNo value={resolveSetting('members_can_change_map', layers)} disabled={disabled} onChange={value => update('members_can_change_map', value)} />
        </SettingRow>

        <SettingRow label="PARTY SIZE CAP" source={settingSource('max_members', layers)}>
          <select value={effectiveCap} disabled={disabled} onChange={event => update('max_members', Number(event.target.value))}>
            {capOptions.map(value => <option key={value} value={value}>{value} MEMBERS</option>)}
          </select>
        </SettingRow>
      </div>
    </div>
  )
}
