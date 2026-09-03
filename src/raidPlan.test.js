import { describe, expect, it } from 'vitest'
import {
  buildObjectiveAssignments,
  capsForGoal,
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

  it('does not carry the stale Vitamins key into the Factory blocker or prep manifest', () => {
    const staleKey = { id: 'health-resort-room-112', name: 'Health Resort west wing office room 112 key' }
    const vitamins = {
      id: '5b478eca86f7744642012254',
      name: 'Vitamins',
      map: null,
      neededKeys: [{ map: { normalizedName: 'shoreline' }, keys: [staleKey] }],
      objectives: [{
        id: '5b478f6886f774464201225a',
        type: 'findQuestItem',
        description: 'Locate and obtain the chemical container on Factory',
        maps: [{ normalizedName: 'shoreline' }],
        zones: [{ map: { normalizedName: 'shoreline' }, position: { x: 1, y: 0, z: 2 } }],
        requiredKeys: [[staleKey]],
      }],
    }
    const input = {
      maps: [{ id: 'factory-id', name: 'Factory', normalizedName: 'factory' }],
      tasks: [vitamins],
      members: [{ user_id: 'u-vitamins', quests_all: [{ id: vitamins.id }] }],
      keyClaims: { 'u-vitamins': ['unrelated-key'] },
      mapExtras: {},
    }

    const score = scoreSquadMaps(input)[0]
    expect(score.blockers.some(blocker => blocker.itemAlternatives.some(item => item.id === staleKey.id))).toBe(false)

    const manifest = buildPackingManifest({ ...input, mapNorm: 'factory' })
    expect(manifest.required.some(item => item.itemAlternatives.some(item => item.id === staleKey.id))).toBe(false)
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

  // The map added here must genuinely outscore Customs. An empty second map does
  // not discriminate: under relative normalisation the best map is still Customs
  // both times, so it still lands on the cap and the assertion holds anyway.
  it('keeps absolute scores stable when a genuinely better map is added', () => {
    const richMembers = ['u-a', 'u-b', 'u-c', 'u-d'].map(userId => ({
      user_id: userId,
      callsign: userId.toUpperCase(),
      quests_all: [{ id: 'q-rich-one', important: true }, { id: 'q-rich-two', important: true }],
    }))
    const richTasks = ['q-rich-one', 'q-rich-two'].flatMap(id => [{
      id,
      name: id,
      map: { normalizedName: 'rich' },
      neededKeys: [],
      objectives: Array.from({ length: 6 }, (unused, index) => ({
        id: `${id}-o${index}`,
        type: 'visit',
        description: 'Rich objective',
        maps: [{ normalizedName: 'rich' }],
        zones: [{ id: `rich-${index}`, position: { x: index, y: 0, z: index }, map: { normalizedName: 'rich' } }],
      })),
    }])
    const richMap = { id: 'rich-id', name: 'Rich', normalizedName: 'rich' }

    const alone = scoreSquadMaps(baseInput({ maps: [maps[0]] }))[0]
    const withRich = scoreSquadMaps(baseInput({
      maps: [maps[0], richMap],
      tasks: [...tasks, ...richTasks],
      members: [...members, ...richMembers],
    }))

    const rich = withRich.find(result => result.map.normalizedName === 'rich')
    const customs = withRich.find(result => result.map.normalizedName === 'customs')

    // Guard the guard: if the added map does not actually outscore Customs the
    // test proves nothing, so assert the premise before the invariant.
    expect(rich.score).toBeGreaterThan(alone.score)
    expect(customs.score).toBe(alone.score)
    expect(customs.components).toEqual(alone.components)
  })

  it('shares one fixed component budget across every goal preset', () => {
    const budget = Object.values(capsForGoal('quest-push')).reduce((total, cap) => total + cap, 0)
    for (const preset of ['quest-push', 'squad-overlap', 'money-run', 'boss-hunt']) {
      const caps = capsForGoal(preset)
      const total = Object.values(caps).reduce((sum, cap) => sum + cap, 0)
      expect(total).toBeCloseTo(budget, 6)
    }
    // A preset must re-weight, not inflate: no preset may reach 100 more easily
    // than quest-push, because the clamp would flatten the top of the ranking.
    expect(capsForGoal('squad-overlap').overlap).toBeGreaterThan(capsForGoal('quest-push').overlap)
    expect(capsForGoal('squad-overlap').coverage).toBeLessThan(capsForGoal('quest-push').coverage)
    expect(capsForGoal('money-run').opportunity).toBeGreaterThan(capsForGoal('quest-push').opportunity)
  })

  it('names only the members actually inside an overlap', () => {
    const zone = (x, z) => ({ id: 'z', position: { x, z }, map: { normalizedName: 'customs' } })
    const overlapTasks = [
      {
        id: 'q-shared',
        name: 'Shared',
        map: { normalizedName: 'customs' },
        neededKeys: [],
        objectives: [{ id: 'o1', type: 'visit', maps: [{ normalizedName: 'customs' }], zones: [zone(100, 200)] }],
      },
      {
        id: 'q-lonely',
        name: 'Lonely',
        map: { normalizedName: 'customs' },
        neededKeys: [],
        objectives: [{ id: 'o9', type: 'visit', maps: [{ normalizedName: 'customs' }], zones: [zone(900, 900)] }],
      },
    ]
    const result = scoreSquadMaps(baseInput({
      maps: [maps[0]],
      tasks: overlapTasks,
      members: [
        { user_id: 'u-a', callsign: 'A', quests_all: [{ id: 'q-shared' }] },
        { user_id: 'u-b', callsign: 'B', quests_all: [{ id: 'q-shared' }] },
        { user_id: 'u-c', callsign: 'C', quests_all: [{ id: 'q-lonely' }] },
      ],
    }))[0]
    const exact = result.reasons.find(item => item.code === 'overlap.exact-position')
    expect(exact.memberIds).toEqual(['u-a', 'u-b'])
  })

  it('reports medium confidence when quest data is complete but auxiliary data is not', () => {
    const complete = scoreSquadMaps(baseInput())[0]
    expect(complete.confidence).toBe('high')

    const noExtras = scoreSquadMaps(baseInput({ mapExtras: {} }))
      .find(result => result.map.normalizedName === 'customs')
    expect(noExtras.confidence).toBe('medium')

    const noClaims = scoreSquadMaps(baseInput({ keyClaims: {} }))
      .find(result => result.map.normalizedName === 'customs')
    expect(noClaims.confidence).toBe('medium')

    // An incomplete quest list is the one thing that still drops to low.
    const incomplete = scoreSquadMaps(baseInput({ members: [{ user_id: 'u-a' }] }))[0]
    expect(incomplete.confidence).toBe('low')
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
