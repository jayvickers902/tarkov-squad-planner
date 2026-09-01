// Shareability has three tiers, and keeping them apart is the whole point of
// this module.
//
// CURATED — a row in `quest_share_overrides`. Either hand-entered from the patch
// notes or mirrored from tarkov.help, which publishes `cooperative_status` per
// task and `is_cooperative` per objective. This is the only tier the UI is
// allowed to badge, because it is the only tier that is actually known.
//
// COMMUNITY — what players reported from actual raids, via
// `quest_share_reports` and the `quest_share_tallies()` aggregate. Nobody
// publishes this data, so the people running the raids are the ones who can see
// a teammate's kill tick their counter. A tally is promoted to a verdict only
// once it clears COMMUNITY_MIN_REPORTS and COMMUNITY_MIN_AGREEMENT below; until
// then it is not shown at all, because one person's mistake should not become
// everyone's badge.
//
// INFERRED — the fallback type rule: world actions can be observed for a squad,
// inventory/profile outcomes stay personal. Measured against tarkov.help's
// curation this agrees on 35.6% of tasks and calls 296 of 456 known-solo tasks
// shareable. It is fine for ordering and grouping hints; it is not fit to show a
// player as a verdict, which is why aa590e9 pulled the SQUAD badge.
//
// tarkov.help's `none` is its unset default, not a reviewed "solo" judgement, so
// only positive verdicts are ever mirrored. Absence of data is not data.

// Keep this threshold in sync with the HAVING clause in
// supabase/10_30_audit_hardening.sql.
// How much agreement turns a pile of reports into a verdict. Deliberately named
// and deliberately low: this is a tool a handful of squadmates fill in over a few
// wipes, not a survey panel. Two unanimous reports qualify; a 2-1 split at three
// reports scrapes through; a 1-1 split does not. Raise these once the table has
// real volume behind it.
export const COMMUNITY_MIN_REPORTS = 2
export const COMMUNITY_MIN_AGREEMENT = 2 / 3

const SQUAD_TYPES = new Set([
  'shoot', 'visit', 'plantItem', 'plantQuestItem', 'mark', 'extract', 'useItem',
])

function overrideRow(task, overrides) {
  const id = task?.id
  if (!id || !overrides) return null
  const row = overrides instanceof Map ? overrides.get(id) : overrides[id]
  return row?.verdict === 'shared' || row?.verdict === 'partial' || row?.verdict === 'solo'
    ? row
    : null
}

function taskOverride(task, overrides) {
  return overrideRow(task, overrides)?.verdict ?? null
}

// A per-objective verdict is strictly more information than the task-level one,
// so it wins over even the absolute `shared`/`solo` forms. Nothing seeded today
// combines the two; this only decides the case where a curator says "the task is
// shareable, except this one objective".
function objectiveOverride(objective, task, overrides) {
  const id = objective?.id
  if (!id) return null
  const map = overrideRow(task, overrides)?.objectives
  const verdict = map && typeof map === 'object' ? map[id] : null
  return verdict === 'squad' || verdict === 'personal' ? verdict : null
}

// Tallies arrive shaped { [taskId]: { [objectiveId]: { squad, personal } } },
// which is `quest_share_tallies()` grouped by task so a panel holding one quest
// can look up all of its objectives without scanning the whole table.
function tallyFor(objective, task, tallies) {
  const taskId = task?.id
  const objectiveId = objective?.id
  if (!taskId || !objectiveId || !tallies) return null
  const forTask = tallies instanceof Map ? tallies.get(taskId) : tallies[taskId]
  const counts = forTask && typeof forTask === 'object' ? forTask[objectiveId] : null
  if (!counts) return null
  const squad = Number(counts.squad) || 0
  const personal = Number(counts.personal) || 0
  const total = squad + personal
  return total > 0 ? { squad, personal, total } : null
}

// A tally only becomes a verdict once enough people agree. Below the thresholds
// it stays null and the caller falls through to inference, so a lone report
// changes nothing anyone else sees.
function communityVerdict(objective, task, tallies) {
  const counts = tallyFor(objective, task, tallies)
  if (!counts || counts.total < COMMUNITY_MIN_REPORTS) return null
  const winner = counts.squad >= counts.personal ? 'squad' : 'personal'
  const agreement = Math.max(counts.squad, counts.personal) / counts.total
  return agreement >= COMMUNITY_MIN_AGREEMENT ? winner : null
}

// The single place precedence is defined: a curator naming this objective, then
// an absolute task verdict, then what players reported, then the type rule.
// `partial` deliberately does not force — it means "the type rules are right for
// some of these but the task is not wholly shareable", so an objective it does
// not name falls through to community or inference. Forcing them all personal
// would make `partial` render identically to `solo` and waste the only verdict
// that can express a mixed task.
export function resolveObjective(objective, task, overrides = {}, tallies = null) {
  const specific = objectiveOverride(objective, task, overrides)
  const row = overrideRow(task, overrides)
  if (specific) return { verdict: specific, tier: 'curated', source: row?.source ?? null }

  const override = row?.verdict
  if (override === 'shared') return { verdict: 'squad', tier: 'curated', source: row?.source ?? null }
  if (override === 'solo') return { verdict: 'personal', tier: 'curated', source: row?.source ?? null }

  const community = communityVerdict(objective, task, tallies)
  if (community) {
    return { verdict: community, tier: 'community', source: 'community', counts: tallyFor(objective, task, tallies) }
  }

  if (!objective || typeof objective !== 'object') return { verdict: 'personal', tier: 'inferred', source: null }
  if (objective.foundInRaid === true) return { verdict: 'personal', tier: 'inferred', source: null }
  return {
    verdict: SQUAD_TYPES.has(objective.type) ? 'squad' : 'personal',
    tier: 'inferred',
    source: null,
  }
}

export function classifyObjective(objective, task, overrides = {}, tallies = null) {
  return resolveObjective(objective, task, overrides, tallies).verdict
}

export function classifyTask(task, overrides = {}, tallies = null) {
  const override = taskOverride(task, overrides)
  if (override) return override
  const objectives = Array.isArray(task?.objectives)
    ? task.objectives.filter(objective => !objective?.optional)
    : []
  if (!objectives.length) return 'solo'
  const squadCount = objectives
    .filter(objective => classifyObjective(objective, task, overrides, tallies) === 'squad').length
  if (squadCount === objectives.length) return 'shared'
  if (squadCount > 0) return 'partial'
  return 'solo'
}

// The provenance-carrying forms. `tier` is what gates the badge: show a verdict
// to a player only when a human stands behind it, and say which human.
// `curated` is kept as its own boolean so callers can ask the narrower question
// without string-matching a tier.
export function taskShare(task, overrides = {}, tallies = null) {
  const row = overrideRow(task, overrides)
  if (row) {
    return { verdict: row.verdict, tier: 'curated', curated: true, source: row.source ?? null }
  }
  const objectives = Array.isArray(task?.objectives)
    ? task.objectives.filter(objective => !objective?.optional)
    : []
  // A task is only community-backed when every objective in the roll-up is. One
  // reported objective among five inferred ones does not make the task verdict
  // trustworthy, and the roll-up is exactly where that would get hidden.
  const backed = objectives.length > 0
    && objectives.every(objective => resolveObjective(objective, task, overrides, tallies).tier === 'community')
  return {
    verdict: classifyTask(task, overrides, tallies),
    tier: backed ? 'community' : 'inferred',
    curated: false,
    source: backed ? 'community' : null,
  }
}

export function objectiveShare(objective, task, overrides = {}, tallies = null) {
  const resolved = resolveObjective(objective, task, overrides, tallies)
  return {
    verdict: resolved.verdict,
    tier: resolved.tier,
    curated: resolved.tier === 'curated',
    source: resolved.source,
    counts: resolved.counts ?? tallyFor(objective, task, tallies),
  }
}
