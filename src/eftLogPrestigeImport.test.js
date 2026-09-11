import { describe, expect, it } from 'vitest'
import { parseEftLogFiles } from './eftLogs'
import { selectImportEvents } from './eftLogImportSelection'
import { reduceQuestLogState, stalePreWipeQuestIds } from './questLogState'

// Reproduces the report this was written for: a player who had just prestiged
// with eight quests accepted imported his logs and was shown eighty open ones.
//
// Nothing in the logs marks a prestige -- the client records the local player's
// prestige level nowhere -- so the reset has to be inferred. It is inferred from
// the quests he accepted again afterwards: a non-repeatable quest cannot be
// started twice in one life.

const NEWLINE = String.fromCharCode(10)
const DAY = 86400
const PRE_PRESTIGE_TASKS = 80
const REACCEPTED_TASKS = 8

const taskId = index => `507f1f77bcf86cd7994${String(index).padStart(5, '0')}`
const TASK_IDS = Array.from({ length: PRE_PRESTIGE_TASKS }, (_, index) => taskId(index))

function questStarted(id, dt, eventId) {
  return JSON.stringify({
    type: 'ChatMessageReceived',
    eventId,
    message: { type: 10, templateId: `${id} description`, dt, messageId: eventId },
  })
}

// dt 1700000000 is 2023-11-14T22:13:20Z; the prestige sits eleven days later.
const FIRST_START = 1700000000
const PRESTIGE_AT = FIRST_START + 11 * DAY

function session(name, lines) {
  return [
    { name: `Logs/0.16.9/${name}/notifications.log`, text: lines.join(NEWLINE) },
    { name: `Logs/0.16.9/${name}/backend.log`, text: '{"sessionMode":"PVP","profileId":"niven"}' },
  ]
}

// His previous life: eighty quests accepted over ten days. None of them can be
// completed inside this corpus -- the prestige reset them, so the completions
// that would close them will never be written by any import.
const previousLife = TASK_IDS.map((id, index) => questStarted(id, FIRST_START + index * 3600, `pre-${index}`))
// After the prestige he accepts eight of them again over the next two days.
const afterPrestige = TASK_IDS.slice(0, REACCEPTED_TASKS)
  .map((id, index) => questStarted(id, PRESTIGE_AT + index * 5 * 3600, `post-${index}`))

function importedRows(files, { includePreWipeHistory = false } = {}) {
  const preview = parseEftLogFiles(files, TASK_IDS, { gameMode: 'regular' })
  const selection = {
    includedVersions: preview.includedVersions,
    profileKey: preview.discoveredProfiles[0]?.profileKey || null,
    unknownModeTargets: {},
    includePreWipeHistory,
  }
  const events = selectImportEvents(preview, selection, 'regular', TASK_IDS)
  return { preview, rows: Object.values(reduceQuestLogState(events)) }
}

describe('importing a fresh prestige', () => {
  const files = [...session('before', previousLife), ...session('after', afterPrestige)]

  it('opens only the quests accepted since the prestige', () => {
    const { preview, rows } = importedRows(files)

    expect(preview.wipeBoundaryAt).toBe(new Date(PRESTIGE_AT * 1000).toISOString())
    expect(rows.filter(row => row.state === 'active')).toHaveLength(REACCEPTED_TASKS)
  })

  it('still imports the whole history when the reader asks for it', () => {
    // The boundary is a default, not a verdict. INCLUDE FULL HISTORY is the
    // escape hatch for a reader whose restarts were not a wipe at all.
    const { rows } = importedRows(files, { includePreWipeHistory: true })
    expect(rows.filter(row => row.state === 'active')).toHaveLength(PRE_PRESTIGE_TASKS)
  })

  it('repairs a list that was imported before the boundary was detectable', () => {
    // Filtering the events only helps the next import. Someone who imported
    // while detection was blind already has the eighty rows written, and
    // reconciliation never removes anything, so they would stay open forever.
    const { preview } = importedRows(files)
    const alreadyImported = Object.values(reduceQuestLogState(
      parseEftLogFiles(files, TASK_IDS, { gameMode: 'regular' }).events,
    ))
    expect(alreadyImported.filter(row => row.state === 'active')).toHaveLength(PRE_PRESTIGE_TASKS)

    const stale = stalePreWipeQuestIds(alreadyImported, preview.wipeBoundaryAt)
    const repaired = alreadyImported.filter(row => !stale.includes(row.quest_id))
    expect(repaired.filter(row => row.state === 'active')).toHaveLength(REACCEPTED_TASKS)
  })
})
