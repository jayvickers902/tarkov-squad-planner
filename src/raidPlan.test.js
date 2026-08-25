import { describe, expect, it } from 'vitest'
import {
  buildObjectiveAssignments,
  buildPackingManifest,
  buildPlanRoute,
  scoreSquadMaps,
} from './raidPlan'

const maps = [
  { id: 'customs-id', name: 'Customs', normalizedName: 'customs' },
  { id: 'woods-id', name: 'Woods', normalizedName: 'woods' },
]

const members = [
  {
    user_id: 'u-b',
    callsign: 'Bravo',
    quests_all: [{ id: 'q-two', important: true }, { id: 'q-three' }],
  },
  {
    user_id: 'u-a',
    callsign: 'Alpha',
    quests_all: [{ id: 'q-one' }, { id: 'q-three' }],
  },
]

const tasks = [
  {
    id: 'q-one',
    name: 'Exact visit',
    map: { normalizedName: 'customs' },
    neededKeys: [],
    objectives: [{
      id: 'o-one',
      type: 'visit',
      description: 'Visit the office',
      maps: [{ normalizedName: 'customs' }],
      zones: [{ id: 'customs-0', position: { x: 142.2, y: 1, z: -87.4 }, map: { normalizedName: 'customs' } }],
    }],
  },
  {
    id: 'q-two',
    name: 'Map-only action',
    map: { normalizedName: 'customs' },
    neededKeys: [],
    objectives: [{
      id: 'o-two',
      type: 'shoot',
      description: 'Clear targets',
      maps: [{ normalizedName: 'customs' }],
      zones: [],
    }],
  },
  {
    id: 'q-three',
    name: 'Shared key',
    map: { normalizedName: 'customs' },
    neededKeys: [{
      map: { normalizedName: 'customs' },
      keys: [{ id: 'flat-key', name: 'Flat key' }],
    }],
    objectives: [{
      id: 'o-three',
      type: 'plantItem',
      description: 'Plant a camera',
      maps: [{ normalizedName: 'customs' }],
      zones: [{ id: 'customs-0', position: { x: 142.49, y: 1, z: -87.49 }, map: { normalizedName: 'customs' } }],
      item: { id: 'camera', name: 'Camera' },
      requiredKeys: [[
        { id: 'key-a', name: 'Key A' },
        { id: 'key-b', name: 'Key B' },
        { id: 'key-c', name: 'Key C' },
      ]],
    }],
  },
]

function baseInput(extra = {}) {
  return {
    maps,
    tasks,
    members,
    progress: {},
    overrides: {},
    keyClaims: { 'u-a': ['key-a', 'flat-key'], 'u-b': ['camera'] },
    mapExtras: {
      customs: { extractCount: 4, bossChances: [0.6], goonReportAgeMs: 1000 },
      woods: { extractCount: 0, bossChances: [0], goonReportAgeMs: 999999999 },
    },
    ...extra,
  }
}

describe('raid planning engine', () => {
  it('returns a stable, explainable ordered score', () => {
    const first = scoreSquadMaps(baseInput())
    const second = scoreSquadMaps(baseInput())
    expect(second).toEqual(first)
    expect(first[0].map.normalizedName).toBe('customs')
    expect(first[0].scoreVersion).toBe('squad-v1')
    expect(first[0].components).toEqual(expect.objectContaining({ coverage: 13.33, overlap: expect.any(Number) }))
    expect(first[0].reasons.map(item => item.code)).toEqual([...first[0].reasons.map(item => item.code)].sort())
    expect(first[0].reasons.every(item => [...item.memberIds].sort().join() === item.memberIds.join())).toBe(true)
  })

  it('excludes completed objectives from every score component', () => {
    const result = scoreSquadMaps(baseInput({
      tasks: [tasks[0]],
      members: [
        { user_id: 'u-a', quests_all: [{ id: 'q-one' }] },
        { user_id: 'u-b', quests_all: [{ id: 'q-one' }] },
      ],
      progress: {
        'q-one::o-one::u-a': true,
        'q-one::o-one::u-b': true,
      },
      keyClaims: {},
      mapExtras: {},
    }))[0]
    expect(result.components.coverage).toBe(0)
    expect(result.components.overlap).toBe(0)
    expect(result.components.carry).toBe(0)
    expect(result.components.priority).toBe(0)
    expect(result.components.friction).toBe(0)
  })

  it('groups three alternative keys into one blocker and one packing requirement', () => {
    const input = baseInput({ keyClaims: { 'u-a': [], 'u-b': [] } })
    const score = scoreSquadMaps(input).find(result => result.map.normalizedName === 'customs')
    expect(score.blockers).toHaveLength(0)

    const knownEmptyIsUnknown = scoreSquadMaps(baseInput({ keyClaims: { 'u-a': ['unrelated'] } }))
      .find(result => result.map.normalizedName === 'customs')
    expect(knownEmptyIsUnknown.blockers.filter(blocker => blocker.kind === 'key' && blocker.itemAlternatives.length === 3)).toHaveLength(1)

    const assignments = buildObjectiveAssignments({ ...input, mapNorm: 'customs' })
    const manifest = buildPackingManifest({ ...input, mapNorm: 'customs', assignments })
    expect(manifest.required.filter(item => item.itemAlternatives.length === 3)).toHaveLength(1)
    expect(manifest.required.find(item => item.sourceKinds.includes('task-needed-key')).itemAlternatives).toHaveLength(1)
  })

  it('gives exact-position overlap more weight than map-only overlap', () => {
    const exact = scoreSquadMaps(baseInput({
      tasks: [tasks[0]],
      members: [
        { user_id: 'u-a', quests_all: [{ id: 'q-one' }] },
        { user_id: 'u-b', quests_all: [{ id: 'q-one' }] },
      ],
      keyClaims: { 'u-a': ['x'] },
    }))[0]
    const mapOnly = scoreSquadMaps(baseInput({
      tasks: [tasks[1]],
      members: [
        { user_id: 'u-a', quests_all: [{ id: 'q-two' }] },
        { user_id: 'u-b', quests_all: [{ id: 'q-two' }] },
      ],
      keyClaims: { 'u-a': ['x'] },
    }))[0]
    expect(exact.components.overlap).toBeGreaterThan(mapOnly.components.overlap)
  })

  it('does not use colliding synthesized possible-location ids as exact overlap', () => {
    const possibleLocationTask = {
      id: 'q-possible',
      name: 'Possible locations',
      objectives: [{
        id: 'o-possible',
        type: 'visit',
        maps: [{ normalizedName: 'customs' }],
        // This is the adapted shape produced from possibleLocations. The id is
        // synthesized and intentionally collides across unrelated objectives.
        zones: [{ id: 'customs-id-0', map: { normalizedName: 'customs' }, position: { x: 100, y: 0, z: 200 } }],
      }],
    }
    const otherPossibleLocationTask = {
      ...possibleLocationTask,
      id: 'q-other-possible',
      objectives: [{
        ...possibleLocationTask.objectives[0],
        id: 'o-other-possible',
        zones: [{ id: 'customs-id-0', map: { normalizedName: 'customs' }, position: { x: 500, y: 0, z: 800 } }],
      }],
    }
    const result = scoreSquadMaps(baseInput({
      tasks: [possibleLocationTask, otherPossibleLocationTask],
      members: [
        { user_id: 'u-a', quests_all: [{ id: 'q-possible' }] },
        { user_id: 'u-b', quests_all: [{ id: 'q-other-possible' }] },
      ],
      keyClaims: { 'u-a': ['x'] },
    }))[0]
    expect(result.components.overlap).toBe(0)
    expect(result.reasons.some(reason => reason.code === 'overlap.exact-position')).toBe(false)
  })

  it('keeps partial objective rules and lets solo overrides remove carry credit', () => {
    const partial = scoreSquadMaps(baseInput({
      overrides: { 'q-three': { verdict: 'partial' } },
    }))[0]
    expect(partial.components.carry).toBeGreaterThan(0)
    const solo = scoreSquadMaps(baseInput({
      overrides: { 'q-three': { verdict: 'solo' } },
    }))[0]
    expect(solo.components.carry).toBeLessThan(partial.components.carry)
    const assignment = buildObjectiveAssignments({ ...baseInput({ overrides: { 'q-three': { verdict: 'solo' } } }), mapNorm: 'customs' })
      .find(item => item.questId === 'q-three')
    expect(assignment.shareability).toBe('personal')
    expect(assignment.shareabilitySource).toBe('override')
  })

  it('keeps absolute scores stable when a better map is added', () => {
    const one = scoreSquadMaps(baseInput({ maps: [maps[0]] }))[0]
    const two = scoreSquadMaps(baseInput({ maps: [maps[0], { id: 'better', name: 'Better', normalizedName: 'better' }] }))[0]
    expect(two.score).toBe(one.score)
    expect(two.components).toEqual(one.components)
  })

  it('emits a human-readable reason for every nonzero score component', () => {
    const result = scoreSquadMaps(baseInput())[0]
    for (const [component, value] of Object.entries(result.components)) {
      if (value === 0) continue
      expect(result.reasons.some(item => item.code.startsWith(component))).toBe(true)
    }
    expect(scoreSquadMaps(baseInput({ goal: 'unknown-goal' }))[0].components)
      .toEqual(scoreSquadMaps(baseInput({ goal: 'quest-push' }))[0].components)
  })

  it('degrades missing upstream collections to low confidence without throwing', () => {
    for (const input of [
      {},
      { maps },
      { maps, tasks },
      { maps, tasks, members: [] },
      { maps, tasks, members: [{ user_id: 'u-a' }] },
      { maps, tasks, members, keyClaims: {}, mapExtras: {} },
      { maps, tasks, members, keyClaims: { 'u-a': ['camera'] } },
    ]) {
      expect(() => scoreSquadMaps(input)).not.toThrow()
      const result = scoreSquadMaps(input)
      if (result.length) expect(['low', 'medium']).toContain(result[0].confidence)
    }
    expect(scoreSquadMaps({ maps: [], tasks, members })).toEqual([])

    const maplessGive = scoreSquadMaps(baseInput({
      tasks: [{
        id: 'q-give',
        map: { normalizedName: 'customs' },
        objectives: [{ id: 'o-give', type: 'giveItem', maps: [], zones: [], item: { id: 'x' } }],
      }],
      members: [{ user_id: 'u-a', quests_all: [{ id: 'q-give' }] }],
      keyClaims: { 'u-a': ['x'] },
    }))[0]
    expect(maplessGive.components.coverage).toBe(0)
  })

  it('builds conservative assignments and a deterministic nearest-stop route', () => {
    const assignments = buildObjectiveAssignments({ ...baseInput(), mapNorm: 'customs' })
    expect(assignments.every(item => item.assigneeUserId === item.beneficiaryUserId)).toBe(true)
    expect(assignments.every(item => item.carrierUserId === null)).toBe(true)
    expect(assignments.every(item => ['derived', 'override'].includes(item.shareabilitySource))).toBe(true)
    expect(assignments.every(item => item.objectiveKey.endsWith(`::${item.beneficiaryUserId}`))).toBe(true)
    expect(assignments.find(item => item.questId === 'q-three').itemRequirementIds).toContain('flat-key')

    const route = buildPlanRoute({
      mapNorm: 'customs',
      spawn: { x: 0, z: 0 },
      objectives: [
        { objectiveKey: 'near', matchKey: 'customs:10:10' },
        { objectiveKey: 'far', matchKey: 'customs:100:100' },
      ],
      assignments: [
        { objectiveKey: 'far', mapNorm: 'customs', order: 0 },
        { objectiveKey: 'near', mapNorm: 'customs', order: 1 },
      ],
    })
    expect(route.map(item => item.objectiveKey)).toEqual(['near', 'far'])
    expect(route.map(item => item.order)).toEqual([0, 1])
  })
})
