// The SQUAD badge renders only for verdicts somebody stands behind. aa590e9
// removed the previous badge because it showed the type inference, which calls
// 296 of 456 known-solo tasks shareable — a badge that wrong is worse than no
// badge. `tier` is the gate: nothing curated and nothing reported, no badge, and
// the panel simply says nothing.
//
// Accepts the `{ verdict, tier, source, counts }` shape from taskShare() /
// objectiveShare() in questShare.js. Task verdicts are `shared`/`partial`;
// objective verdicts are `squad`. Everything else renders nothing.
//
// A community verdict is drawn deliberately differently from a curated one and
// says how many players it rests on, because "two people said so" and "the patch
// notes say so" are not the same claim and should not look alike.

const SOURCE_LABEL = {
  'tarkov.help': 'Verified by tarkov.help.',
  manual: 'Verified from the patch notes.',
}

function reportCount(counts) {
  const total = Number(counts?.total) || 0
  return total === 1 ? '1 report' : `${total} reports`
}

export default function SquadBadge({ share }) {
  const tier = share?.tier ?? (share?.curated ? 'curated' : 'inferred')
  if (tier !== 'curated' && tier !== 'community') return null

  const { verdict, source, counts } = share
  if (verdict !== 'shared' && verdict !== 'partial' && verdict !== 'squad') return null

  const partial = verdict === 'partial'
  const community = tier === 'community'
  const claim = partial
    ? 'Some objectives count for the whole squad.'
    : 'Progress counts for the whole squad.'
  const provenance = community
    ? `Reported by players in raid (${reportCount(counts)}), not yet verified.`
    : SOURCE_LABEL[source] || ''

  const className = [
    'quest-share-badge',
    partial ? 'quest-share-badge-partial' : '',
    community ? 'quest-share-badge-community' : '',
  ].filter(Boolean).join(' ')

  return (
    <span className={className} title={`${claim} ${provenance}`.trim()}>
      {partial ? 'SQUAD · SOME' : 'SQUAD'}
      {community ? <span className="quest-share-badge-mark" aria-hidden="true">?</span> : null}
    </span>
  )
}
