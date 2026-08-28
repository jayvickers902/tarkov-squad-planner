import { describe, expect, it, vi } from 'vitest'
import { buildEventRows, loadTaskNames } from './scanReport.js'

describe('companion scan report helpers', () => {
  it('loads task names lazily from the prebaked catalog and skips unknown ids', async () => {
    const loader = vi.fn(async () => ({ default: {
      data: [
        { id: '59c9392986f7742f6923add2', name: 'Aid Stations' },
        { id: 'NOT-A-TASK', name: 'Unsafe' },
        { id: '5a68663e86f774501078f78a' },
        { id: '59c9392986f7742f6923add2', name: 'Aid Stations' },
      ],
    } }))
    const names = await loadTaskNames(loader)
    expect(loader).toHaveBeenCalledOnce()
    expect(names).toEqual(new Map([['59c9392986f7742f6923add2', 'Aid Stations']]))
  })

  it('groups applied and pending events while retaining raw ids for unknown tasks', () => {
    const taskId = '59c9392986f7742f6923add2'
    const unknownId = '5a68663e86f774501078f78a'
    const rows = buildEventRows([
      { taskId, state: 'completed', occurredAt: '2026-08-27T12:00:00Z', applied: true },
      { taskId: unknownId, state: 'active', occurredAt: null, applied: false },
    ], new Map([[taskId, 'Aid Stations']]))
    expect(rows.applied).toEqual([{ taskId, name: 'Aid Stations', state: 'completed', occurredAt: '2026-08-27T12:00:00Z', applied: true }])
    expect(rows.pending).toEqual([{ taskId: unknownId, name: unknownId, state: 'active', occurredAt: null, applied: false }])
  })
})
