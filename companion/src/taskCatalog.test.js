import { describe, expect, it } from 'vitest'
import { loadTrustedTaskIds } from './taskCatalog.js'

describe('trusted companion task catalog', () => {
  it('keeps only unique canonical task ids', async () => {
    const taskId = '59c9392986f7742f6923add2'
    const ids = await loadTrustedTaskIds(async () => ({
      default: { data: [{ id: taskId }, { id: taskId }, { id: '../unsafe' }, null] },
    }))
    expect(ids).toEqual([taskId])
  })

  it('loads the website prebake as a non-empty trust source', async () => {
    const ids = await loadTrustedTaskIds()
    expect(ids.length).toBeGreaterThan(100)
    expect(ids).toContain('59c9392986f7742f6923add2')
  })
})
