/**
 * @param {{
 *   session?: { status?: string | null } | null,
 *   raidKey?: string | null,
 *   endSession?: () => Promise<{ error?: { message?: string } | null } | null | undefined>,
 *   setSetting?: (key: string, value: string | null) => unknown,
 *   onError?: (message: string) => void,
 * }} [options]
 * @returns {Promise<unknown>}
 */
export async function endRaid({ session = null, raidKey = null, endSession, setSetting, onError } = {}) {
  if (!session) return setSetting?.('raid_ended_stamp', raidKey)
  try {
    const result = await endSession?.()
    if (result?.error) onError?.(result.error?.message || String(result.error))
    return result
  } catch (error) {
    onError?.((/** @type {Error | null | undefined} */ (error))?.message || String(error))
    return { data: null, error }
  }
}
