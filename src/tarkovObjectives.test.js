import { describe, expect, it } from 'vitest'
import { inferredTaskMapNorm, objectiveIsOnMap, taskIsOnMap } from './tarkovObjectives'

describe('inferredTaskMapNorm', () => {
  it('assigns Supervisor-style objectives to Interchange', () => {
    const task = {
      map: null,
      objectives: [
        { type: 'plantItem', description: 'Stash the Goshan cash register key on Interchange', optional: false },
        { type: 'plantItem', description: 'Stash the IDEA cash register key at Register #9 on Interchange', optional: false },
        { type: 'plantItem', description: 'Stash the OLI cash register key on Interchange', optional: false },
        { type: 'findItem', description: 'Obtain the key', optional: true },
      ],
    }
    expect(inferredTaskMapNorm(task)).toBe('interchange')
    expect(objectiveIsOnMap(task.objectives[0], task, 'interchange')).toBe(true)
    expect(objectiveIsOnMap(task.objectives[0], task, 'shoreline')).toBe(false)
  })

  it('leaves mixed or unresolved any-map tasks unassigned', () => {
    expect(inferredTaskMapNorm({ objectives: [
      { type: 'plantItem', description: 'Place the item on Interchange', optional: false },
      { type: 'plantItem', description: 'Place the item on Shoreline', optional: false },
    ] })).toBeNull()
    expect(inferredTaskMapNorm({ objectives: [
      { type: 'plantItem', description: 'Place the item in the marked room', optional: false },
    ] })).toBeNull()
  })

  it('keeps the multi-map sniper scav variant on all valid maps', () => {
    const task = { id: '5bc4836986f7740c0152911c', map: null, objectives: [
      { type: 'shoot', description: 'Eliminate Sniper Scavs with a bolt-action rifle', optional: false, maps: [{ normalizedName: 'streets-of-tarkov' }] },
    ] }
    expect(taskIsOnMap(task, 'streets-of-tarkov')).toBe(true)
    expect(taskIsOnMap(task, 'customs')).toBe(true)
    expect(taskIsOnMap(task, 'shoreline')).toBe(true)
    expect(taskIsOnMap(task, 'woods')).toBe(true)
    expect(taskIsOnMap(task, 'interchange')).toBe(false)
    expect(objectiveIsOnMap(task.objectives[0], task, 'woods')).toBe(true)
  })
})

describe('map-planning exclusions', () => {
  it('keeps non-raid any-location quests out of every selected map without removing them from the unscoped list', () => {
    const task = {
      id: 'gunsmith-task',
      name: 'Gunsmith Master - Part 1',
      map: null,
      objectives: [{ id: 'build', type: 'buildWeapon', optional: false, maps: [], zones: [] }],
    }

    expect(taskIsOnMap(task, 'customs')).toBe(false)
    expect(taskIsOnMap(task, 'factory')).toBe(false)
    expect(taskIsOnMap(task, null)).toBe(true)
  })

  it('also excludes hand-in-only any-location quests', () => {
    const task = {
      id: 'hand-in-task',
      name: 'Trader Hand-in',
      map: null,
      objectives: [{ id: 'give', type: 'giveItem', optional: false, maps: [], zones: [] }],
    }

    expect(taskIsOnMap(task, 'customs')).toBe(false)
  })

  it('keeps any-location find-in-raid quests because they can progress during a raid', () => {
    const task = {
      id: 'fir-task',
      name: 'Find Supplies',
      map: null,
      objectives: [{ id: 'find', type: 'findItem', optional: false, maps: [], zones: [] }],
    }

    expect(taskIsOnMap(task, 'customs')).toBe(true)
    expect(taskIsOnMap(task, 'shoreline')).toBe(true)
  })

  it('preserves explicit map assignments even when the published objective is a hand-in', () => {
    const task = {
      id: 'mapped-hand-in-task',
      name: 'Mapped Hand-in',
      map: { normalizedName: 'woods' },
      objectives: [{ id: 'give', type: 'giveQuestItem', optional: false, maps: [], zones: [] }],
    }

    expect(taskIsOnMap(task, 'woods')).toBe(true)
    expect(taskIsOnMap(task, 'customs')).toBe(false)
  })
})
