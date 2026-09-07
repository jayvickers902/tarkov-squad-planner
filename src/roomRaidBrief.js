// Pure policy for the raid brief in Room. The component owns effects, storage,
// and callbacks; this module owns the decisions those effects and callbacks
// must make.

export const RAID_BRIEF_WINDOW_MS = 15 * 60 * 1000

export const BRIEF_CONFIRM_LABELS = Object.freeze({ announced: 'READY', manual: 'DONE' })

export function briefAckKey(party) {
  return `tsp.raid-brief.${party?.id || party?.code || 'local'}`
}

export function hasRaidWork(progress) {
  return Object.keys(progress || {}).some(key => key !== '__raid_start__')
}

/** Selecting a new map clears the work represented by the room's planning UI. */
export function hasDestructivePlan(party) {
  return (party?.drawings?.length || 0) > 0
    || (party?.markers?.length || 0) > 0
    || Object.keys(party?.starred || {}).length > 0
    || hasRaidWork(party?.progress)
}

export function shouldBriefStartedRaid({ mapId, raidStart, raidId, ackedRaid, now = Date.now() }) {
  if (!mapId || raidStart === null) return false
  if (ackedRaid !== null && raidId <= ackedRaid) return false
  return now - raidStart <= RAID_BRIEF_WINDOW_MS
}

export function announcedRaidId(raidBrief, fallbackRaidId) {
  const value = Number(raidBrief?.raidId)
  return Number.isFinite(value) ? value : fallbackRaidId
}

/** Resolve the side effects of closing the brief without invoking them here. */
export function settleRaidBrief({ reason, confirmed, briefRaidId }) {
  if (reason === 'pending') {
    if (!confirmed) return { ackRaidId: null, startRaid: false, openRaid: false }
    return { ackRaidId: briefRaidId + 1, startRaid: true, openRaid: true }
  }

  if (reason === 'announced') {
    return { ackRaidId: briefRaidId + 1, startRaid: false, openRaid: confirmed }
  }

  if (reason === 'started') {
    return { ackRaidId: briefRaidId, startRaid: false, openRaid: confirmed }
  }

  // A manually opened checklist is informational: it neither acknowledges a
  // raid nor navigates into the raid view when dismissed.
  return { ackRaidId: null, startRaid: false, openRaid: false }
}
