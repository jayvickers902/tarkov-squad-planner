import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// useQuestShareOverrides talks to Supabase. These tests drive the panels, not the
// network, so the client is stubbed per-test and the hook's module-level memo is
// reset between them.
const overrideRows = { current: [] }
const overrideFails = { current: false }

vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: () => (overrideFails.current
        ? Promise.reject(new Error('no such table'))
        : Promise.resolve({ data: overrideRows.current, error: null })),
    }),
  },
}))

const TASKS = [
  {
    // Every objective is a world action → fully shareable.
    id: 'task-shared',
    name: 'Shared Task',
    trader: { name: 'Prapor', imageLink: null },
    traderRequirements: [
      { requirementType: 'level', compareMethod: '>=', value: 2, trader: { name: 'Jaeger' } },
      { requirementType: 'level', compareMethod: '>=', value: 2, trader: { name: 'Therapist' } },
      { requirementType: 'level', compareMethod: '>=', value: 3, trader: { name: 'Skier' } },
    ],
    objectives: [
      { id: 'o-shoot', type: 'shoot', description: 'Eliminate targets', optional: false },
      { id: 'o-visit', type: 'visit', description: 'Locate the place', optional: false },
    ],
  },
  {
    // Mixed: one world action, one hand-in, one FIR find.
    id: 'task-mixed',
    name: 'Mixed Task',
    trader: { name: 'Therapist', imageLink: null },
    traderRequirements: [],
    objectives: [
      { id: 'o-plant', type: 'plantItem', description: 'Stash the package', optional: false },
      // Not giveItem: objsForMap deliberately drops hand-in objectives from this
      // panel, because they are done at the trader rather than in raid.
      { id: 'o-find', type: 'findItem', description: 'Find the goods', optional: false },
      { id: 'o-fir', type: 'plantItem', description: 'Plant a found item', optional: false, foundInRaid: true },
    ],
  },
  {
    // Types that used to leak as raw camelCase.
    id: 'task-labels',
    name: 'Label Task',
    trader: { name: 'Mechanic', imageLink: null },
    traderRequirements: [{ requirementType: 'reputation', compareMethod: '>=', value: 1, trader: { name: 'Fence' } }],
    objectives: [
      { id: 'o-build', type: 'buildWeapon', description: 'Build it', optional: false },
      { id: 'o-loyalty', type: 'traderLevel', description: 'Reach loyalty', optional: false },
      { id: 'o-use', type: 'useItem', description: 'Use the thing', optional: false },
    ],
  },
]

const MY_QUESTS = TASKS.map(task => ({ id: task.id, name: task.name }))

async function renderPanel(overrides = []) {
  overrideRows.current = overrides
  const { default: MyQuestPanel } = await import('./components/MyQuestPanel')
  render(
    <MyQuestPanel
      myQuests={MY_QUESTS}
      tasks={TASKS}
      progress={{}}
      userObjProgress={{}}
      myUserId="user-1"
      myName="DUDGY"
      onSubmit={() => {}}
      mapNorm={null}
      loading={false}
      settings={{}}
    />,
  )
  // Let the overrides promise settle so badges reflect curated data.
  await screen.findByText('Shared Task')
}

// The objective row is a flex div holding: checkbox, a wrapper around the
// description, the type label, and the badge. The description sits two levels
// down, so walk up twice to reach the row that holds its siblings.
function objectiveRow(description) {
  return screen.getByText(description).parentElement.parentElement
}

beforeEach(() => {
  overrideRows.current = []
  overrideFails.current = false
  vi.resetModules()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('quest panel shareability badges', () => {
  it('badges squad objectives and leaves personal ones unbadged', async () => {
    await renderPanel()

    expect(within(objectiveRow('Eliminate targets')).getByText('SQUAD')).toBeTruthy()
    expect(within(objectiveRow('Locate the place')).getByText('SQUAD')).toBeTruthy()
    expect(within(objectiveRow('Stash the package')).getByText('SQUAD')).toBeTruthy()

    expect(within(objectiveRow('Find the goods')).queryByText('SQUAD')).toBeNull()
  })

  it('treats a found-in-raid item as personal even when its type is a world action', async () => {
    await renderPanel()
    expect(within(objectiveRow('Plant a found item')).queryByText('SQUAD')).toBeNull()
  })

  it('marks the badge as derived rather than stating it as fact', async () => {
    await renderPanel()
    const badge = within(objectiveRow('Eliminate targets')).getByText('SQUAD')
    expect(badge.getAttribute('title')).toMatch(/inferred/i)
  })

  it('lets a solo override strip every badge on that task', async () => {
    await renderPanel([{ task_id: 'task-shared', verdict: 'solo' }])
    expect(within(objectiveRow('Eliminate targets')).queryByText('SQUAD')).toBeNull()
    expect(within(objectiveRow('Locate the place')).queryByText('SQUAD')).toBeNull()
    // An unrelated task keeps its own verdict.
    expect(within(objectiveRow('Stash the package')).getByText('SQUAD')).toBeTruthy()
  })

  it('lets a partial override keep per-objective badges', async () => {
    // The review fix: `partial` must not flatten a mixed task to look like `solo`.
    await renderPanel([{ task_id: 'task-shared', verdict: 'partial' }])
    expect(within(objectiveRow('Eliminate targets')).getByText('SQUAD')).toBeTruthy()
  })
})

describe('objective type labels', () => {
  it('renders real labels instead of raw upstream camelCase', async () => {
    await renderPanel()

    expect(within(objectiveRow('Find the goods')).getByText('FIND')).toBeTruthy()
    expect(within(objectiveRow('Build it')).getByText('BUILD')).toBeTruthy()
    expect(within(objectiveRow('Reach loyalty')).getByText('LOYALTY')).toBeTruthy()
    expect(within(objectiveRow('Use the thing')).getByText('USE')).toBeTruthy()

    for (const leaked of ['BUILDWEAPON', 'TRADERLEVEL', 'USEITEM', 'FINDITEM']) {
      expect(screen.queryByText(leaked)).toBeNull()
    }
  })
})

describe('trader gates', () => {
  it('renders every gate, not just the first', async () => {
    await renderPanel()
    expect(screen.getByText('Jaeger LL2 · Therapist LL2 · Skier LL3')).toBeTruthy()
  })

  it('renders a reputation gate distinctly and omits the element when there is no gate', async () => {
    await renderPanel()
    expect(screen.getByText('Fence REP 1')).toBeTruthy()
    // Mixed Task has no traderRequirements — nothing gate-shaped should exist for it.
    expect(screen.queryByText(/Therapist LL\d$/)).toBeNull()
  })
})

describe('degradation when curated overrides are unavailable', () => {
  it('still renders the panel and still classifies from types', async () => {
    overrideFails.current = true
    const { default: MyQuestPanel } = await import('./components/MyQuestPanel')
    render(
      <MyQuestPanel
        myQuests={MY_QUESTS}
        tasks={TASKS}
        progress={{}}
        userObjProgress={{}}
        myUserId="user-1"
        myName="DUDGY"
        onSubmit={() => {}}
        mapNorm={null}
        loading={false}
        settings={{}}
      />,
    )
    await screen.findByText('Shared Task')
    expect(screen.getByText('Mixed Task')).toBeTruthy()
    expect(within(objectiveRow('Eliminate targets')).getByText('SQUAD')).toBeTruthy()
  })
})
