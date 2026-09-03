// The personal objective column. Self-only by construction: merge_progress
// rejects any progress key that does not end in the caller's uid, so a tick on
// a teammate's row would fail silently at the database and is never offered.
// Ticks write immediately — mid-raid there is no review moment and no spare tap.
//
// A full quest list runs to dozens of rows, which is more scrolling than a raid
// affords, so the column condenses two ways: every quest folds to its header,
// and DENSE drops each row to a single line. Both are reversible and neither
// hides a row's state — a folded quest still reads out its tally.
import { useCallback, useMemo, useState } from 'react'

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

function TaskRow({ row, live, dense, done, focused, onToggle, onHoverFocus, onToggleFocus }) {
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
      // DENSE folds the sub-line away to win the row back for the description,
      // so the tooltip has to carry what the row no longer shows.
      title={dense ? `${row.description || row.action} · ${subLine(row)}` : (row.description || row.action)}
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
        <span className="mono mr-task-action" title={subLine(row)}>{subLine(row)}</span>
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
  dense = false,
  onSetDense,
}) {
  const donePct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0

  // Only an explicit fold is stored. A finished quest folds itself, because the
  // rows left to do are the reason the column is open at all — but one click
  // pins it open again and that choice then outranks the default.
  const [folds, setFolds] = useState({})
  const isFolded = useCallback(
    group => folds[group.questId] ?? (group.total > 0 && group.done === group.total),
    [folds],
  )

  const anyOpen = useMemo(() => groups.some(group => !isFolded(group)), [groups, isFolded])

  const toggleGroup = useCallback((group, folded) => {
    setFolds(current => ({ ...current, [group.questId]: !folded }))
  }, [])

  const foldAll = useCallback(() => {
    setFolds(Object.fromEntries(groups.map(group => [group.questId, anyOpen])))
  }, [groups, anyOpen])

  return (
    <section
      className={`mr-tasks${embedded ? ' is-embedded' : ''}${dense ? ' is-dense' : ''}`}
      aria-label="My tasks"
    >
      <header className="mr-tasks-head">
        <div className="mr-tasks-headline">
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
        </div>
        {groups.length > 0 && (
          <div className="mr-tasks-tools">
            <button
              type="button"
              className="mono mr-tasks-tool"
              onClick={foldAll}
              title={anyOpen ? 'Fold every quest to its header' : 'Open every quest'}
            >{anyOpen ? 'FOLD ALL' : 'OPEN ALL'}</button>
            <button
              type="button"
              className={dense ? 'mono mr-tasks-tool is-on' : 'mono mr-tasks-tool'}
              aria-pressed={dense}
              onClick={() => onSetDense?.(!dense)}
              title="One line per objective"
            >DENSE</button>
          </div>
        )}
      </header>

      <div className="mr-tasks-body">
        {loading && <div className="mono mr-empty">LOADING...</div>}
        {!loading && !groups.length && (
          <div className="mono mr-empty">NO OBJECTIVES ON THIS MAP</div>
        )}
        {groups.map(group => {
          const folded = isFolded(group)
          return (
            <div className={folded ? 'mr-task-group is-folded' : 'mr-task-group'} key={group.questId}>
              <div className="mr-task-group-head">
                <button
                  type="button"
                  className="mr-task-group-toggle"
                  aria-expanded={!folded}
                  onClick={() => toggleGroup(group, folded)}
                  title={folded ? `Show ${group.questName} objectives` : `Fold ${group.questName}`}
                >
                  <span className="mr-task-group-caret" aria-hidden="true" />
                  <span className="mr-task-group-rail" style={{ background: group.color }} aria-hidden="true" />
                  <span className="mr-task-group-name">{group.questName}</span>
                </button>
                {/* Hidden until the header is hovered or focused: mid-raid the
                    column is a checklist, and a link on every quest reads as
                    clutter until the moment somebody wants the article. */}
                {group.wiki && (
                  <a
                    className="mono mr-task-group-wiki"
                    href={group.wiki}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${group.questName} on the wiki`}
                    title={`Open ${group.questName} on the wiki`}
                  >WIKI &#8599;</a>
                )}
                <span className="mono mr-task-group-tally">{group.tally}</span>
              </div>
              {!folded && group.rows.map(row => (
                <TaskRow
                  key={row.key}
                  row={row}
                  live={live}
                  dense={dense}
                  done={isDone(row)}
                  focused={focusKey === row.focusKey}
                  onToggle={onToggle}
                  onHoverFocus={onHoverFocus}
                  onToggleFocus={onToggleFocus}
                />
              ))}
            </div>
          )
        })}
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
