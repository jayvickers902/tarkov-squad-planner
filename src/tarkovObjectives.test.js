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

  it('excludes any-location find-in-raid-only quests from map planning', () => {
    const task = {
      id: 'fir-task',
      name: 'Find Supplies',
      map: null,
      objectives: [
        { id: 'find', type: 'findItem', foundInRaid: true, optional: false, maps: [], zones: [] },
        { id: 'give', type: 'giveItem', foundInRaid: true, optional: false, maps: [], zones: [] },
      ],
    }

    expect(taskIsOnMap(task, 'customs')).toBe(false)
    expect(taskIsOnMap(task, 'shoreline')).toBe(false)
    expect(taskIsOnMap(task, null)).toBe(true)
  })

  it('excludes obtain-item-only quests from map planning', () => {
    const task = {
      id: 'obtain-task',
      name: 'Obtain Supplies',
      map: null,
      objectives: [
        { id: 'find', type: 'findItem', foundInRaid: false, optional: false, maps: [], zones: [] },
        { id: 'give', type: 'giveItem', foundInRaid: false, optional: false, maps: [], zones: [] },
      ],
    }

    expect(taskIsOnMap(task, 'factory')).toBe(false)
  })

  it('keeps only the approved item-only Icebreaker exceptions', () => {
    const itemObjective = { id: 'find', type: 'findItem', optional: false, maps: [], zones: [] }
    const exceptions = [
      ['69ce21e990144e437802b1e0', 'Fresh Stock'],
      ['69ce1de03e15cd80bd06f6c9', 'Oil Change'],
      ['69ce204c8702b378f9091e4b', 'War Never Changes'],
    ]
    for (const [id, name] of exceptions) {
      expect(taskIsOnMap({ id, name, map: { normalizedName: 'icebreaker' }, objectives: [itemObjective] }, 'icebreaker')).toBe(true)
    }
    expect(taskIsOnMap({ id: '59675d6c86f7740a842fc482', name: 'Ice Cream Cones', map: { normalizedName: 'woods' }, objectives: [itemObjective] }, 'woods')).toBe(false)
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
