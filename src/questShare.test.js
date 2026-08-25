import { describe, expect, it } from 'vitest'
import { classifyObjective, classifyTask } from './questShare'
import tasksPayload from './data/prebaked/tasks.json'

describe('quest shareability classifier', () => {
  it('maps world-action types to squad and inventory/profile types to personal', () => {
    for (const type of ['shoot', 'visit', 'plantItem', 'plantQuestItem', 'mark', 'extract', 'useItem']) {
      expect(classifyObjective({ type })).toBe('squad')
    }
    for (const type of ['giveItem', 'findItem', 'findQuestItem', 'giveQuestItem', 'buildWeapon', 'skill', 'traderLevel', 'traderStanding', 'sellItem', 'experience', 'taskStatus', 'dialogue', 'globalVariable']) {
      expect(classifyObjective({ type })).toBe('personal')
    }
  })

  it('lets FIR and task overrides win conservatively', () => {
    const task = { id: 'task-1', objectives: [{ type: 'shoot', foundInRaid: true }] }
    expect(classifyObjective(task.objectives[0], task)).toBe('personal')
    expect(classifyObjective({ type: 'shoot' }, task, { 'task-1': { verdict: 'solo' } })).toBe('personal')
    expect(classifyTask(task, { 'task-1': { verdict: 'shared' } })).toBe('shared')
  })

  it('rolls required objectives up to shared, partial, or solo', () => {
    expect(classifyTask({ objectives: [{ type: 'shoot' }, { type: 'visit' }] })).toBe('shared')
    expect(classifyTask({ objectives: [{ type: 'shoot' }, { type: 'giveItem' }] })).toBe('partial')
    expect(classifyTask({ objectives: [{ type: 'giveItem' }] })).toBe('solo')
    expect(classifyTask({ objectives: [{ type: 'shoot', optional: true }] })).toBe('solo')
  })

  it('lets a partial override keep per-objective type rules', () => {
    // `shared` and `solo` are absolute; `partial` must not flatten a mixed task,
    // or it renders exactly like `solo` and the verdict carries no information.
    const task = {
      id: 'task-2',
      objectives: [{ type: 'shoot' }, { type: 'giveItem' }],
    }
    const overrides = { 'task-2': { verdict: 'partial' } }
    expect(classifyTask(task, overrides)).toBe('partial')
    expect(classifyObjective(task.objectives[0], task, overrides)).toBe('squad')
    expect(classifyObjective(task.objectives[1], task, overrides)).toBe('personal')

    const solo = { 'task-2': { verdict: 'solo' } }
    expect(classifyObjective(task.objectives[0], task, solo)).toBe('personal')
  })

  it('accepts overrides as a Map and ignores unknown verdicts', () => {
    const task = { id: 'task-3', objectives: [{ type: 'shoot' }] }
    expect(classifyTask(task, new Map([['task-3', { verdict: 'solo' }]]))).toBe('solo')
    expect(classifyTask(task, { 'task-3': { verdict: 'nonsense' } })).toBe('shared')
  })

  it('uses safe defaults for malformed and unknown input', () => {
    expect(classifyObjective(null)).toBe('personal')
    expect(classifyObjective({}, {})).toBe('personal')
    expect(classifyTask(null)).toBe('solo')
    expect(classifyTask({})).toBe('solo')
    expect(classifyObjective({ type: 'newUpstreamType' })).toBe('personal')
  })

  it('keeps the committed task roll-up in a sane band', () => {
    const tasks = tasksPayload.data
    const totals = tasks.reduce((counts, task) => {
      counts[classifyTask(task)] += 1
      return counts
    }, { shared: 0, partial: 0, solo: 0 })
    expect(totals.shared / tasks.length).toBeGreaterThan(0.35)
    expect(totals.shared / tasks.length).toBeLessThan(0.55)
    expect(totals.shared + totals.partial + totals.solo).toBe(tasks.length)
  })
})
