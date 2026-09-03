import { describe, expect, it } from 'vitest'
import { deriveMapStats } from './roomViewModel'

const taskIsOnMap = (task, map) => task?.maps?.includes(map) === true

describe('room map recommendation view model', () => {
  it('ranks maps by total quests and then shared quest crossover', () => {
    const maps = [{ normalizedName: 'customs' }, { normalizedName: 'woods' }]
    const allTasks = [
      { id: 'shared', maps: ['customs'] },
      { id: 'solo', maps: ['customs'] },
      { id: 'woods-task', maps: ['woods'] },
    ]
    const allTasksById = new Map(allTasks.map(task => [task.id, task]))
    const members = [
      { callsign: 'Alpha', quests_all: [{ id: 'shared' }, { id: 'solo' }] },
      { callsign: 'Bravo', quests_all: [{ id: 'shared' }] },
      { callsign: 'Charlie', quests_all: [{ id: 'woods-task' }] },
    ]

    expect(deriveMapStats({ allTasks, allTasksById, maps, members, taskIsOnMap })).toEqual([
      { map: maps[0], total: 3, crossover: 1, perMember: { Alpha: 2, Bravo: 1, Charlie: 0 } },
      { map: maps[1], total: 1, crossover: 0, perMember: { Alpha: 0, Bravo: 0, Charlie: 1 } },
    ])
  })

  it('returns no recommendations without a catalogue, maps, or active quests', () => {
    expect(deriveMapStats({ allTasks: [], allTasksById: new Map(), maps: [], members: [], taskIsOnMap })).toEqual([])
    expect(deriveMapStats({
      allTasks: [{ id: 'task' }],
      allTasksById: new Map([['task', { id: 'task' }]]),
      maps: [{ normalizedName: 'customs' }],
      members: [{ callsign: 'Alpha', quests_all: [] }],
      taskIsOnMap,
    })).toEqual([])
  })
})
