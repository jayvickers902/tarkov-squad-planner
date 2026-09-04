import { describe, expect, it } from 'vitest'
import { indexTasksById } from './taskIndex'

describe('indexTasksById', () => {
  it('indexes tasks by id for O(1) lookup', () => {
    const tasks = [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Bravo' },
      { id: 'c', name: 'Charlie' },
    ]
    const index = indexTasksById(tasks)
    expect(index).toBeInstanceOf(Map)
    expect(index.size).toBe(3)
    expect(index.get('a')).toBe(tasks[0])
    expect(index.get('b')).toBe(tasks[1])
    expect(index.get('c')).toBe(tasks[2])
    expect(index.get('missing')).toBeUndefined()
  })

  it('returns an empty map for undefined, null, or empty input', () => {
    expect(indexTasksById(undefined).size).toBe(0)
    expect(indexTasksById(null).size).toBe(0)
    expect(indexTasksById([]).size).toBe(0)
  })

  it('resolves a duplicate id to the first entry, as tasks.find did', () => {
    const first = { id: 'dup', name: 'First' }
    const second = { id: 'dup', name: 'Second' }
    const index = indexTasksById([first, second])
    expect(index.size).toBe(1)
    expect(index.get('dup')).toBe(first)
    expect(index.get('dup')).toBe([first, second].find(task => task.id === 'dup'))
  })

  it('skips entries with no id rather than indexing them under undefined', () => {
    const tasks = [{ id: 'a' }, { name: 'no id' }, { id: null, name: 'null id' }]
    const index = indexTasksById(tasks)
    expect(index.size).toBe(1)
    expect(index.has(undefined)).toBe(false)
    expect(index.get('a')).toEqual({ id: 'a' })
  })
})
