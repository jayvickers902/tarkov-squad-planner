import { describe, expect, it } from 'vitest'
import { buildObjectiveRows, carryItem, groupRowsByQuest, objectiveLabel } from './raidObjectives'
import { objectiveProgressKey, questDoneKey } from './partyMembers'

const WOODS = 'woods'

function zone(x, z) {
  return { id: `z-${x}-${z}`, position: { x, y: 0, z }, map: { normalizedName: WOODS } }
}

function task(id, name, objectives, map = WOODS) {
  return { id, name, map: map ? { normalizedName: map } : null, objectives }
}

const TASKS = [
  task('t1', 'Woods Keeper', [
    { id: 'o1', type: 'visit', description: 'Locate the camp', zones: [zone(100, 0)] },
    { id: 'o2', type: 'findItem', description: 'Find the stash', zones: [zone(300, 0)] },
  ]),
  task('t2', 'Long Line', [
    { id: 'o3', type: 'mark', description: 'Mark pylon #2', markerItem: { name: 'MS2000' }, zones: [zone(50, 0)] },
    { id: 'o4', type: 'shoot', description: 'Kill 7 PMCs', zones: [] },
    { id: 'o5', type: 'visit', description: 'Optional side trip', optional: true, zones: [zone(10, 0)] },
  ]),
]

const MEMBERS = [
  { user_id: 'me', callsign: 'SOLARIS', quests: [{ id: 't1' }, { id: 't2' }] },
  { user_id: 'them', callsign: 'BJORN', quests: [{ id: 't1' }] },
]
const NAMES = ['SOLARIS', 'BJORN']
const IDS = ['me', 'them']

function pinsFor(rows) {
  return rows.map(([memberName, taskId, objectiveId, x, z]) => ({
    id: `${memberName}-${taskId}-${objectiveId}`,
    key: `${taskId}::${objectiveId}`,
    memberName,
    questName: taskId,
    lat: z,
    lng: x,
  }))
}

const PINS = pinsFor([
  ['SOLARIS', 't1', 'o1', 100, 0],
  ['SOLARIS', 't1', 'o2', 300, 0],
  ['SOLARIS', 't2', 'o3', 50, 0],
  ['BJORN', 't1', 'o1', 100, 0],
  ['BJORN', 't1', 'o2', 300, 0],
])

function build(overrides = {}) {
  return buildObjectiveRows({
    tasks: TASKS,
    memberQuests: MEMBERS,
    memberNames: NAMES,
    memberIds: IDS,
    progress: {},
    starredQuests: {},
    mapNorm: WOODS,
    pins: PINS,
    myPing: null,
    ...overrides,
  })
}

describe('buildObjectiveRows', () => {
  it('orders by distance from my ping, nearest first', () => {
    const rows = build({ myPing: { x: 0, z: 0 }, forUserId: 'me' })
    expect(rows.map(row => row.objectiveId)).toEqual(['o3', 'o1', 'o2'])
    expect(rows[0].range).toEqual({ dist: 50, dir: 'E' })
  })

  it('orders starred first when there is no ping', () => {
    const rows = build({ starredQuests: { t2: true }, forUserId: 'me' })
    expect(rows[0].taskId).toBe('t2')
    expect(rows.slice(1).every(row => row.taskId === 't1')).toBe(true)
  })

  it('sinks rows with no location to the bottom once there is a ping to sort by', () => {
    const withPing = build({ myPing: { x: 0, z: 0 }, forUserId: 'me', includeUnplaced: true })
    expect(withPing.at(-1).objectiveId).toBe('o4')
  })

  it('falls back to starred then quest order when there is no ping', () => {
    const rows = build({ forUserId: 'me', includeUnplaced: true, starredQuests: { t2: true } })
    expect(rows.map(row => row.taskId)).toEqual(['t2', 't2', 't1', 't1'])
  })

  it('filters to one member with forUserId', () => {
    expect(build().map(row => row.memberUserId)).toContain('them')
    const mine = build({ forUserId: 'me' })
    expect(mine.every(row => row.memberUserId === 'me')).toBe(true)
    expect(mine).toHaveLength(3)
  })

  it('excludes quests already marked done for that member', () => {
    const rows = build({ progress: { [questDoneKey('t1', 'me')]: true }, forUserId: 'me' })
    expect(rows.map(row => row.taskId)).toEqual(['t2'])
    const theirs = build({ progress: { [questDoneKey('t1', 'me')]: true }, forUserId: 'them' })
    expect(theirs).toHaveLength(2)
  })

  it('excludes optional objectives', () => {
    expect(build().some(row => row.objectiveId === 'o5')).toBe(false)
  })

  it('dedupes a quest listed twice on one member', () => {
    const twice = [{ user_id: 'me', callsign: 'SOLARIS', quests: [{ id: 't1' }, { id: 't1' }] }]
    const rows = build({ memberQuests: twice, forUserId: 'me' })
    expect(rows.map(row => row.key)).toEqual([...new Set(rows.map(row => row.key))])
    expect(rows).toHaveLength(2)
  })

  it('omits unplaced objectives unless includeUnplaced is set', () => {
    expect(build({ forUserId: 'me' }).some(row => row.objectiveId === 'o4')).toBe(false)
    expect(build({ forUserId: 'me', includeUnplaced: true }).some(row => row.objectiveId === 'o4')).toBe(true)
  })

  it('does not pull an unplaced objective off a quest for another map', () => {
    const elsewhere = [task('t3', 'Elsewhere', [{ id: 'o9', type: 'giveItem', description: 'Hand in', zones: [] }], 'customs')]
    const rows = buildObjectiveRows({
      tasks: elsewhere,
      memberQuests: [{ user_id: 'me', callsign: 'SOLARIS', quests: [{ id: 't3' }] }],
      memberNames: NAMES, memberIds: IDS, progress: {}, starredQuests: {},
      mapNorm: WOODS, pins: [], myPing: null, forUserId: 'me', includeUnplaced: true,
    })
    expect(rows).toEqual([])
  })

  it('carries the keys the panel needs to write progress', () => {
    const row = build({ forUserId: 'me' }).find(candidate => candidate.objectiveId === 'o3')
    expect(row.key).toBe(objectiveProgressKey('t2', 'o3', 'me'))
    expect(row.memberUserId).toBe('me')
    expect(row.taskId).toBe('t2')
    expect(row.carry).toEqual({ name: 'MS2000', count: 1 })
  })
})

describe('carryItem', () => {
  it('reads the marker item for a mark objective', () => {
    expect(carryItem({ type: 'mark', markerItem: { name: 'MS2000' } })).toEqual({ name: 'MS2000', count: 1 })
  })

  it('reads the quest item and count for a plant objective', () => {
    expect(carryItem({ type: 'plantItem', item: { name: 'Bronze pocket watch' }, count: 2 }))
      .toEqual({ name: 'Bronze pocket watch', count: 2 })
  })

  it('is null for objectives that need nothing carried', () => {
    expect(carryItem({ type: 'visit' })).toBeNull()
    expect(carryItem({ type: 'mark' })).toBeNull()
    expect(carryItem(null)).toBeNull()
  })
})

describe('groupRowsByQuest', () => {
  it('groups without reordering and tallies my ticks', () => {
    const rows = build({ myPing: { x: 0, z: 0 }, forUserId: 'me' })
    const groups = groupRowsByQuest(rows, row => row.key === objectiveProgressKey('t1', 'o1', 'me'))
    expect(groups.map(group => group.questId)).toEqual(['t2', 't1'])
    expect(groups[1].tally).toBe('1/2')
    expect(groups[0].tally).toBe('0/1')
  })
})

describe('objectiveLabel', () => {
  it('spaces out an unmapped camelCase type', () => {
    expect(objectiveLabel({ type: 'traderLevel' })).toBe('trader level')
    expect(objectiveLabel({ type: 'visit' })).toBe('locate')
  })
})
