import { describe, expect, it, vi } from 'vitest'
import { endRaid, isRaidLive } from './raidLive'

describe('isRaidLive', () => {
  it.each([
    [{ session: { status: 'active' } }, true],
    [{ session: { status: 'debrief' }, raidKey: 'raid-1' }, false],
    [{ session: { status: 'closed' }, raidKey: 'raid-1' }, false],
    [{ raidKey: 'raid-1', endedStamp: null }, true],
    [{ raidKey: 'raid-1', endedStamp: 'raid-1' }, false],
    [{ raidKey: null, endedStamp: null }, false],
  ])('resolves %j to %j', (input, expected) => {
    expect(isRaidLive(input)).toBe(expected)
  })
})

describe('endRaid', () => {
  it('uses the session RPC instead of the legacy setting', async () => {
    const endSession = vi.fn().mockResolvedValue({ data: { status: 'debrief' }, error: null })
    const setSetting = vi.fn()
    await endRaid({ session: { id: 'session-1' }, raidKey: 'raid-1', endSession, setSetting })
    expect(endSession).toHaveBeenCalledOnce()
    expect(setSetting).not.toHaveBeenCalled()
  })

  it('writes the legacy setting when there is no session', async () => {
    const setSetting = vi.fn()
    await endRaid({ raidKey: 'raid-1', setSetting })
    expect(setSetting).toHaveBeenCalledWith('raid_ended_stamp', 'raid-1')
  })

  it('surfaces an RPC rejection to the app error handler', async () => {
    const error = new Error('not a session member')
    const onError = vi.fn()
    const result = await endRaid({ session: { id: 'session-1' }, endSession: vi.fn().mockRejectedValue(error), onError })
    expect(result.error).toBe(error)
    expect(onError).toHaveBeenCalledWith(error)
  })
})
