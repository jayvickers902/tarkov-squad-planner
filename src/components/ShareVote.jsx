// The control that gathers the co-op data. Nobody publishes which objectives a
// groupmate can tick for you, so the players running the raids are the ones who
// can see it happen — this is how they record it, in the same row they are
// already ticking mid-raid.
//
// Two segments, one click each, and clicking your own vote again retracts it.
// It sits inside a row whose own onClick toggles the objective, so every handler
// here stops propagation: voting on a quest must never also tick it off.

const SEGMENTS = [
  { verdict: 'squad', label: 'SQD', title: 'A groupmate’s progress counts for me' },
  { verdict: 'personal', label: 'SOLO', title: 'Only my own progress counts' },
]

export default function ShareVote({ value, counts, onVote, disabled }) {
  // The tally map holds raw {squad, personal}; objectiveShare adds a `total`.
  // Derive it either way so the caller can pass whichever it already has.
  const total = counts?.total ?? (Number(counts?.squad) || 0) + (Number(counts?.personal) || 0)

  return (
    <span
      className="share-vote"
      onClick={e => e.stopPropagation()}
      title={total ? `${total === 1 ? '1 player has' : `${total} players have`} reported this objective` : 'No reports yet — tell us what you saw in raid'}
    >
      {SEGMENTS.map(({ verdict, label, title }) => {
        const active = value === verdict
        return (
          <button
            key={verdict}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            title={active ? `${title} — click again to retract` : title}
            className={`share-vote-seg${active ? ' share-vote-seg-on' : ''}`}
            onClick={e => {
              e.stopPropagation()
              // Re-clicking your own vote retracts it, so a misclick is one click
              // to undo rather than a row you can never take back.
              onVote(active ? null : verdict)
            }}
          >
            {label}
          </button>
        )
      })}
    </span>
  )
}
