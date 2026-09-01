export function isRaidLive({ raidKey = null, endedStamp = null, session = null } = {}) {
  if (session) return session.status === 'active'
  if (raidKey === null || raidKey === undefined) return false
  return endedStamp !== raidKey
}

export const deriveRaidLive = isRaidLive

export async function endRaid({ session = null, raidKey = null, endSession, setSetting, onError } = {}) {
  if (!session) return setSetting?.('raid_ended_stamp', raidKey)
  try {
    const result = await endSession?.()
    if (result?.error) onError?.(result.error)
    return result
  } catch (error) {
    onError?.(error)
    return { data: null, error }
  }
}
