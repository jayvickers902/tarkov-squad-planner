import { describe, expect, it } from 'vitest'
import { inferredTaskMapNorm, objectiveIsOnMap, objectiveIsUnplacedMapAction, objectivePins, objectiveSubjectItem, requiredKeyItems, taskIsOnMap } from './tarkovObjectives'

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

describe('unplaced map actions', () => {
  // The real shape of The Punisher - Part 1: one Customs kill count that
  // upstream cannot pin, because the whole map is where you do it.
  const punisher = {
    id: '59c512ad86f7741f0d09de9b',
    name: 'The Punisher - Part 1',
    map: { normalizedName: 'customs' },
    objectives: [{
      id: 'kill-scavs',
      type: 'shoot',
      optional: false,
      description: 'Eliminate Scavs with AKS-74U on Customs',
      maps: [{ normalizedName: 'customs' }],
      zones: [],
    }],
  }

  it('keeps a map-named kill count on the map it names, and only there', () => {
    expect(objectiveIsUnplacedMapAction(punisher.objectives[0], punisher, 'customs')).toBe(true)
    expect(objectiveIsUnplacedMapAction(punisher.objectives[0], punisher, 'woods')).toBe(false)
    expect(objectiveIsUnplacedMapAction(punisher.objectives[0], punisher, null)).toBe(false)
  })

  it('reads a maps array that covers most of the game as any-location, not as ten map scopes', () => {
    // Upstream publishes "anywhere" by enumerating every map rather than none,
    // so the array only counts as a scope while it leaves somewhere out.
    const anywhere = {
      id: 'wounded-beast',
      name: 'The Survivalist Path - Wounded Beast',
      map: null,
      objectives: [{
        id: 'kill-in-pain',
        type: 'shoot',
        optional: false,
        description: 'Eliminate Scavs while suffering from the Pain status effect',
        maps: ['icebreaker', 'lighthouse', 'interchange', 'customs', 'shoreline', 'night-factory',
          'woods', 'streets-of-tarkov', 'factory', 'reserve', 'ground-zero-tutorial']
          .map(normalizedName => ({ normalizedName })),
        zones: [],
      }],
    }
    expect(objectiveIsUnplacedMapAction(anywhere.objectives[0], anywhere, 'customs')).toBe(false)

    // Two maps out of ten is a real routing constraint and stays scoped.
    const pair = {
      id: 'the-guide',
      name: 'The Guide',
      map: null,
      objectives: [{
        id: 'extract-factory-customs',
        type: 'extract',
        optional: false,
        description: 'Survive and extract from Factory or Customs with the "Survived" exit status',
        maps: [{ normalizedName: 'factory' }, { normalizedName: 'night-factory' }, { normalizedName: 'customs' }],
        zones: [],
      }],
    }
    expect(objectiveIsUnplacedMapAction(pair.objectives[0], pair, 'customs')).toBe(true)
    expect(objectiveIsUnplacedMapAction(pair.objectives[0], pair, 'woods')).toBe(false)
  })

  it('admits only in-raid actions, so trader and hideout work stays off the map', () => {
    const task = {
      id: 'bench-task',
      name: 'Bench Task',
      map: { normalizedName: 'customs' },
      objectives: [
        { id: 'hand-in', type: 'giveItem', optional: false, maps: [], zones: [] },
        { id: 'build', type: 'buildWeapon', optional: false, maps: [], zones: [] },
        { id: 'find', type: 'findItem', optional: false, maps: [], zones: [] },
        { id: 'loyalty', type: 'traderLevel', optional: false, maps: [], zones: [] },
      ],
    }
    for (const objective of task.objectives) {
      expect(objectiveIsUnplacedMapAction(objective, task, 'customs')).toBe(false)
    }
  })

  it('does not re-admit an objective that already has a zone to pin', () => {
    const task = {
      id: 'angry-watchman',
      name: 'The Huntsman Path - Angry Watchman',
      map: { normalizedName: 'customs' },
      objectives: [{
        id: 'kill-dorms',
        type: 'shoot',
        optional: false,
        description: 'Eliminate PMC operatives in the Dorms area on Customs',
        maps: [{ normalizedName: 'customs' }],
        zones: [{ id: 'dorms', map: { normalizedName: 'customs' }, position: { x: 1, y: 2, z: 3 } }],
      }],
    }
    expect(objectiveIsUnplacedMapAction(task.objectives[0], task, 'customs')).toBe(false)
  })

  it('leaves a genuinely any-location objective with no map scope at all off every map', () => {
    const task = {
      id: 'grenadier',
      name: 'Grenadier',
      map: null,
      objectives: [{
        id: 'nade-kills',
        type: 'shoot',
        optional: false,
        description: 'Eliminate any target with hand grenades or grenade launchers',
        maps: [],
        zones: [],
      }],
    }
    for (const mapNorm of ['customs', 'woods', 'the-lab']) {
      expect(objectiveIsOnMap(task.objectives[0], task, mapNorm)).toBe(true)
      expect(objectiveIsUnplacedMapAction(task.objectives[0], task, mapNorm)).toBe(false)
    }
  })
})

describe('objective pin presentation data', () => {
  const questItem = { id: 'ledx-special', name: 'LEDX (special)', iconLink: 'https://assets.tarkov.dev/ledx-icon.webp' }
  const task = {
    id: 'quality-standard',
    name: 'Quality Standard',
    trader: { name: 'Therapist', imageLink: 'https://assets.tarkov.dev/therapist.webp' },
    map: { normalizedName: 'the-lab' },
    objectives: [{
      id: 'find-ledx',
      type: 'findQuestItem',
      description: 'Locate and obtain the special version of the LEDX Skin Transilluminator in The Lab',
      optional: false,
      item: questItem,
      count: 1,
      requiredKeys: [[{ id: 'lab-key', name: 'Lab access keycard', iconLink: 'https://assets.tarkov.dev/keycard.webp' }]],
      maps: [{ normalizedName: 'the-lab' }],
      zones: [{ id: 'zone-1', position: { x: -173, y: 1, z: -374 }, map: { normalizedName: 'the-lab' } }],
    }],
  }
  const members = [{ user_id: 'u1', callsign: 'Jayshalla', quests: ['quality-standard'] }]

  it('carries the trader, item art and a readable verb onto the pin', () => {
    const [pin] = objectivePins([task], members, ['Jayshalla'], {}, 'the-lab')
    expect(pin.traderName).toBe('Therapist')
    expect(pin.traderImage).toBe('https://assets.tarkov.dev/therapist.webp')
    expect(pin.itemName).toBe('LEDX (special)')
    expect(pin.itemIcon).toBe('https://assets.tarkov.dev/ledx-icon.webp')
    expect(pin.objAction).toBe('FIND')
    expect(pin.requiredKeys.map(key => key.name)).toEqual(['Lab access keycard'])
  })

  it('reads a mark objective from its marker item, not its quest item', () => {
    const marker = { id: 'ms2000', name: 'MS2000 Marker', iconLink: 'https://assets.tarkov.dev/ms2000.webp' }
    expect(objectiveSubjectItem({ type: 'mark', markerItem: marker, item: questItem })).toBe(marker)
    expect(objectiveSubjectItem({ type: 'visit' })).toBe(null)
  })

  it('flattens alternative key sets and drops duplicates', () => {
    const key = { id: 'k1', name: 'Key one' }
    expect(requiredKeyItems({ requiredKeys: [[key], [key, { id: 'k2', name: 'Key two' }]] })
      .map(entry => entry.name)).toEqual(['Key one', 'Key two'])
    expect(requiredKeyItems({})).toEqual([])
  })
})
