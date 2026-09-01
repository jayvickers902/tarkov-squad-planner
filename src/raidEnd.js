export async function endRaid({ session = null, raidKey = null, endSession, setSetting, onError } = {}) {
  if (!session) return setSetting?.('raid_ended_stamp', raidKey)
  try {
    const result = await endSession?.()
    if (result?.error) onError?.(result.error?.message || String(result.error))
    return result
  } catch (error) {
    onError?.(error?.message || String(error))
    return { data: null, error }
  }
}
