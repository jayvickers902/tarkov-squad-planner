// A1 compatibility storage for the raid-scoped state that A2 will move to
// real columns. No other module should know the progress keys used here.

const SETTINGS_KEY = '__settings__'
const RAID_ID_KEY = '__raid_id__'
const RAID_START_KEY = '__raid_start__'

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function hasKey(progress, key) {
  return !!progress
    && typeof progress === 'object'
    && Object.prototype.hasOwnProperty.call(progress, key)
}

export function getRaidSettings(progress) {
  const value = objectValue(progress?.[SETTINGS_KEY])
  return value ? { ...value } : {}
}

export function getRaidId(progress) {
  const value = progress?.[RAID_ID_KEY]
  return Number.isInteger(value) && value >= 0 ? value : null
}

export function withRaidSettings(progress, settings) {
  const next = objectValue(progress) ? { ...progress } : {}
  const value = objectValue(settings)
  if (value) next[SETTINGS_KEY] = { ...value }
  else delete next[SETTINGS_KEY]
  return next
}

export function withRaidId(progress, raidId) {
  const next = objectValue(progress) ? { ...progress } : {}
  if (Number.isInteger(raidId) && raidId >= 0) next[RAID_ID_KEY] = raidId
  else delete next[RAID_ID_KEY]
  return next
}

// select_map_party clears progress on the current schema. Reapply only the
// compatibility keys, leaving the rest of the new-map progress empty.
export function preserveRaidState(progress, previousProgress) {
  let next = objectValue(progress) ? { ...progress } : {}

  if (hasKey(previousProgress, SETTINGS_KEY)) {
    next = withRaidSettings(next, getRaidSettings(previousProgress))
  }
  if (hasKey(previousProgress, RAID_ID_KEY)) {
    next = withRaidId(next, getRaidId(previousProgress))
  }
  return next
}

export function beginRaid(progress, timestamp = Date.now()) {
  const nextId = (getRaidId(progress) ?? 0) + 1
  const next = objectValue(progress) ? { ...progress } : {}
  next[RAID_ID_KEY] = nextId
  next[RAID_START_KEY] = timestamp
  return next
}

export function raidIdChanged(previousProgress, nextProgress) {
  return getRaidId(previousProgress) !== getRaidId(nextProgress)
}

export function hasRaidWork(progress) {
  return Object.keys(progress || {}).some(key => key !== RAID_START_KEY && key !== SETTINGS_KEY && key !== RAID_ID_KEY)
}
