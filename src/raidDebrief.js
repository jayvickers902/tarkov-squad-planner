// Leaving a raid is the moment a player's quest list is most likely stale. The
// hand-in happens with EFT fullscreen, which is exactly when this tab is hidden
// and its poll timer is throttled to roughly one call a minute -- or frozen
// outright on a single monitor. So the flip out of LIVE forces a folder check
// instead of waiting for the next tick, and reports what that check found
// rather than leaving the reader to guess why the quest is still listed.

export function debriefCheckConfigured(controller) {
  return Boolean(controller?.persistentSupported && controller?.rememberedFolderName)
}

export function shouldRunDebriefCheck(controller) {
  if (!debriefCheckConfigured(controller)) return false
  if (typeof controller.checkNow !== 'function') return false
  // A scan already in flight will land on its own, and runFolderCheck is
  // single-flight anyway -- asking again only costs a duplicate promise.
  return controller.state !== 'reading' && controller.state !== 'applying'
}

export const DEBRIEF_CHECKING = { state: 'checking', tone: 'idle', label: 'CHECKING', completed: 0 }

// The shapes here are runFolderCheck's: `null` for a check that never completed,
// `changed: false` for an untouched folder, and an `events` array only when the
// scan was allowed to apply. Without auto-sync there is a preview and no events,
// which is a review waiting in Quest Manager, not a finished sync.
export function debriefOutcome(result) {
  if (!result || typeof result !== 'object') {
    return { state: 'failed', tone: 'warning', label: 'CHECK DID NOT FINISH', completed: 0 }
  }
  if (result.changed === false) {
    return { state: 'clean', tone: 'idle', label: 'NOTHING NEW', completed: 0 }
  }
  if (!Array.isArray(result.events)) {
    return { state: 'review', tone: 'warning', label: 'REVIEW IN QUEST MANAGER', completed: 0 }
  }
  const completed = result.events.filter(event => event?.state === 'completed').length
  if (completed > 0) {
    return { state: 'applied', tone: 'live', label: `${completed} COMPLETED`, completed }
  }
  if (result.events.length > 0) {
    const count = result.events.length
    return { state: 'applied', tone: 'live', label: `${count} UPDATE${count === 1 ? '' : 'S'}`, completed: 0 }
  }
  return { state: 'clean', tone: 'idle', label: 'NO QUEST CHANGES', completed: 0 }
}

export function debriefTitle(outcome, controllerError = null) {
  if (!outcome) return ''
  if (outcome.state === 'checking') return 'Checking the remembered EFT log folder for quests you finished this raid.'
  if (outcome.state === 'failed') {
    return controllerError
      ? `The EFT log folder could not be checked. ${controllerError}`
      : 'The EFT log folder could not be checked.'
  }
  if (outcome.state === 'review') return 'The logs changed, but automatic sync is off. Review the import in Quest Manager to apply it.'
  if (outcome.state === 'applied') return 'Your quest list was updated from the EFT logs for this raid.'
  return 'The EFT logs were checked and had no new quest events for this raid.'
}
