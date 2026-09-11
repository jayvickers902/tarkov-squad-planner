import { describe, expect, it } from 'vitest'
import { loadPrebaked } from './index'

describe('loadPrebaked', () => {
  it('preserves the generated mode stamp used by mode-scoped hooks', async () => {
    const tasks = await loadPrebaked('tasks')

    expect(tasks).toEqual(expect.objectContaining({
      gameMode: 'regular',
      generatedAt: expect.any(String),
      counts: expect.any(Object),
    }))
    expect(tasks.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '657315ddab5a49b71f098853' }),
    ]))
  })

  it('resolves unknown datasets as an absent floor', async () => {
    await expect(loadPrebaked('not-a-dataset')).resolves.toBeNull()
  })
})
