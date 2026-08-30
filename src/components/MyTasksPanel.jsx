// The personal objective column. Self-only by construction: merge_progress
// rejects any progress key that does not end in the caller's uid, so a tick on
// a teammate's row would fail silently at the database and is never offered.
// Ticks write immediately — mid-raid there is no review moment and no spare tap.

function chipLabel(row, live) {
  if (live) {
    if (row.range) return `${row.range.dist} m ${row.range.dir}`
    return row.hasLocation ? '—' : 'ANYWHERE'
  }
  if (row.carry) return 'PREP'
  return row.hasLocation ? 'ON MAP' : 'ANYWHERE'
}

function subLine(row) {
  if (!row.carry) return row.action
  return `${row.action} · carry ${row.carry.name} ×${row.carry.count}`
}

function TaskRow({ row, live, done, focused, onToggle, onHoverFocus, onToggleFocus }) {
  function toggle() {
    onToggle(row)
  }

  return (
    <div
      className={`mr-task${done ? ' is-done' : ''}${focused ? ' is-focused' : ''}`}
      style={{ borderLeftColor: row.questColor }}
      role="button"
      tabIndex={0}
      aria-pressed={done}
      title={row.description || row.action}
      onMouseEnter={() => row.hasLocation && onHoverFocus?.(row.focusKey)}
      onMouseLeave={() => row.hasLocation && onHoverFocus?.(null)}
      onClick={toggle}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        toggle()
      }}
    >
      <span className="mono mr-task-box" aria-hidden="true">{done ? '✕' : ''}</span>
      <span className="mr-task-copy">
        <span className="mr-task-label">{row.description || row.action}</span>
        <span className="mono mr-task-action">{subLine(row)}</span>
      </span>
      {row.hasLocation ? (
        <button
          type="button"
          className="mono mr-task-chip mr-task-chip-button"
          title="Show on the map"
          aria-label={`Show ${row.description || row.action} on the map`}
          onClick={event => { event.stopPropagation(); onToggleFocus?.(row.focusKey) }}
        >{chipLabel(row, live)}</button>
      ) : (
        <span className="mono mr-task-chip">{chipLabel(row, live)}</span>
      )}
    </div>
  )
}

export default function MyTasksPanel({
  live = false,
  groups = [],
  doneCount = 0,
  totalCount = 0,
  loading = false,
  isDone,
  onToggle,
  focusKey = null,
  onHoverFocus,
  onToggleFocus,
  embedded = false,
}) {
  const donePct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0

  return (
    <section className={embedded ? 'mr-tasks is-embedded' : 'mr-tasks'} aria-label="My tasks">
      <header className="mr-tasks-head">
        <div className="mr-tasks-title">
          <span className="mono mr-tasks-heading">MY TASKS</span>
          <span className="mono mr-tasks-sub">
            {live ? 'SORTED BY DISTANCE FROM YOU' : 'PREP CHECK · SELF-ONLY TICKS'}
          </span>
        </div>
        <div className="mr-tasks-score">
          <span className="mr-tasks-count">{doneCount}<span className="mr-tasks-total">/{totalCount}</span></span>
          <span className="mr-tasks-bar" aria-hidden="true"><span style={{ width: `${donePct}%` }} /></span>
        </div>
      </header>

      <div className="mr-tasks-body">
        {loading && <div className="mono mr-empty">LOADING...</div>}
        {!loading && !groups.length && (
          <div className="mono mr-empty">NO OBJECTIVES ON THIS MAP</div>
        )}
        {groups.map(group => (
          <div className="mr-task-group" key={group.questId}>
            <div className="mr-task-group-head">
              <span className="mr-task-group-rail" style={{ background: group.color }} aria-hidden="true" />
              <span className="mr-task-group-name">{group.questName}</span>
              <span className="mono mr-task-group-tally">{group.tally}</span>
            </div>
            {group.rows.map(row => (
              <TaskRow
                key={row.key}
                row={row}
                live={live}
                done={isDone(row)}
                focused={focusKey === row.focusKey}
                onToggle={onToggle}
                onHoverFocus={onHoverFocus}
                onToggleFocus={onToggleFocus}
              />
            ))}
          </div>
        ))}
      </div>

      <footer className="mr-tasks-foot">
        <span className="mono mr-tasks-note">
          {live ? 'TICKS SAVE INSTANTLY — NO SUBMIT' : 'TICK PREP ITEMS BEFORE YOU QUEUE'}
        </span>
        <span className="mono mr-tasks-scope">SELF-ONLY</span>
      </footer>
    </section>
  )
}
