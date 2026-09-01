import { describe, expect, it, vi } from 'vitest'
import { endRaid } from './raidEnd'

describe('endRaid', () => {
  it('ends a session through the shared RPC wrapper', async () => {
    const endSession = vi.fn().mockResolvedValue({ data: { status: 'debrief' }, error: null })
    const setSetting = vi.fn()
    await endRaid({ session: { id: 'session-1' }, raidKey: 'raid-1', endSession, setSetting })
    expect(endSession).toHaveBeenCalledOnce()
    expect(setSetting).not.toHaveBeenCalled()
  })

  it('marks a legacy raid ended for the reader', async () => {
    const setSetting = vi.fn()
    await endRaid({ raidKey: 'raid-1', setSetting })
    expect(setSetting).toHaveBeenCalledWith('raid_ended_stamp', 'raid-1')
  })

  it('surfaces an RPC rejection', async () => {
    const error = new Error('not a session member')
    const onError = vi.fn()
    const result = await endRaid({ session: { id: 'session-1' }, endSession: vi.fn().mockRejectedValue(error), onError })
    expect(result.error).toBe(error)
    expect(onError).toHaveBeenCalledWith(error.message)
  })
})
