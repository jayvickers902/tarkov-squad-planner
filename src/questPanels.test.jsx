import { useCallback, useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TASKS = [
  {
    // Objective types that previously triggered the inferred SQUAD badge.
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
    // A mix of world-action, item, and found-in-raid objectives.
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

async function renderPanel() {
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
}

// The objective row is a flex div holding a checkbox, description wrapper, and
// type label. The description sits two levels down, so walk up twice to reach
// the row that holds its siblings.
function objectiveRow(description) {
  return screen.getByText(description).parentElement.parentElement
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('quest panel objective metadata', () => {
  it('does not guess whether objectives are squad-shareable', async () => {
    await renderPanel()
    expect(screen.queryByText('SQUAD')).toBeNull()
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

// The empty state used to inline a button mid-sentence and point at a control
// ("AT THE TOP") that the header no longer shows. Both regressions are cheap to
// reintroduce because the same empty state is duplicated in Room.jsx.
describe('empty state', () => {
  async function renderEmpty(onOpenQuestManager = () => {}) {
    const { default: MyQuestPanel } = await import('./components/MyQuestPanel')
    render(
      <MyQuestPanel
        myQuests={[]}
        tasks={[]}
        progress={{}}
        userObjProgress={{}}
        myUserId="user-1"
        myName="DUDGY"
        onSubmit={() => {}}
        onOpenQuestManager={onOpenQuestManager}
        mapNorm={null}
        loading={false}
        settings={{}}
      />,
    )
    return screen.getByRole('button', { name: /QUEST MANAGER/ })
  }

  it('offers Quest Manager as a standalone control, not a word in a sentence', async () => {
    const button = await renderEmpty()

    expect(button.style.display).toBe('inline-flex')
    expect(screen.queryByText(/AT THE TOP/)).toBeNull()
  })

  it('routes to Quest Manager when the control is used', async () => {
    const opened = vi.fn()
    const button = await renderEmpty(opened)

    button.click()
    expect(opened).toHaveBeenCalledTimes(1)
  })
})

describe('map-scoped quest placeholders', () => {
  const customsTask = {
    id: 'customs-task',
    name: 'Customs Task',
    trader: { name: 'Prapor', imageLink: null },
    objectives: [{
      id: 'customs-objective',
      type: 'visit',
      description: 'Visit the Customs location',
      optional: false,
      maps: [{ normalizedName: 'customs' }],
      zones: [{ position: { x: 1, y: 0, z: 1 }, map: { normalizedName: 'customs' } }],
    }],
  }
  const selectedQuests = [
    { id: customsTask.id, name: customsTask.name },
    { id: 'off-map-task', name: 'Off-map Task' },
  ]

  it('does not rebuild an off-map personal quest as an empty card', async () => {
    const { default: MyQuestPanel } = await import('./components/MyQuestPanel')
    render(
      <MyQuestPanel
        myQuests={selectedQuests}
        tasks={[customsTask]}
        progress={{}}
        userObjProgress={{}}
        myUserId="user-1"
        myName="DUDGY"
        onSubmit={() => {}}
        mapNorm="customs"
        loading={false}
        settings={{}}
      />,
    )

    expect(await screen.findByText('Customs Task')).toBeTruthy()
    expect(screen.queryByText('Off-map Task')).toBeNull()
  })

  it('does not rebuild an off-map squad quest as an empty card', async () => {
    const { default: TodoList } = await import('./components/TodoList')
    render(
      <TodoList
        tasks={[customsTask]}
        memberQuests={[{
          user_id: 'user-1',
          callsign: 'DUDGY',
          quests: selectedQuests,
          quests_all: selectedQuests,
        }]}
        progress={{}}
        onToggleStar={() => {}}
        starredQuests={{}}
        myUserId="user-1"
        mapNorm="customs"
      />,
    )

    expect(await screen.findByText('Visit the Customs location')).toBeTruthy()
    expect(screen.queryByText('Off-map Task')).toBeNull()
  })
})

// Completion is owned by the EFT log sync. This panel used to write a per-user
// done flag into party progress, which retired the quest in user_quests; the
// only per-quest control it offers now is hiding, which changes nothing but
// this reader's own view of the column.
describe('hiding a quest', () => {
  async function renderHidable(initialSettings = {}) {
    const { default: MyQuestPanel } = await import('./components/MyQuestPanel')

    // onSetSetting has to be stable: the panel writes quest_order from an
    // effect keyed on the callback, so a fresh closure per render would loop.
    function Harness() {
      const [settings, setSettings] = useState(initialSettings)
      const setSetting = useCallback((key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }))
      }, [])
      return (
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
          settings={settings}
          onSetSetting={setSetting}
          gameMode="regular"
        />
      )
    }

    render(<Harness />)
    await screen.findByText('MY QUESTS')
  }

  it('offers no way to mark a quest complete', async () => {
    await renderHidable()

    expect(screen.queryByText(/DONE/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Mark complete/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Hide Shared Task' })).toBeTruthy()
  })

  it('moves a hidden quest out of the list and into the drawer', async () => {
    await renderHidable()

    fireEvent.click(screen.getByRole('button', { name: 'Hide Shared Task' }))

    expect(screen.queryByText('Shared Task')).toBeNull()
    expect(screen.getByText('Mixed Task')).toBeTruthy()

    const drawer = screen.getByRole('button', { name: /HIDDEN \(1\)/ })
    expect(drawer.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(drawer)
    expect(screen.getByText('Shared Task')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unhide Shared Task' })).toBeTruthy()
  })

  it('puts an unhidden quest back in the list', async () => {
    await renderHidable({ quest_hidden: { regular: ['task-shared'] } })

    expect(screen.queryByText('Shared Task')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /HIDDEN \(1\)/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Unhide Shared Task' }))

    expect(screen.getByText('Shared Task')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /HIDDEN/ })).toBeNull()
  })

  it('reads the hidden list for the active game mode only', async () => {
    await renderHidable({ quest_hidden: { pve: ['task-shared'] } })

    expect(screen.getByText('Shared Task')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /HIDDEN/ })).toBeNull()
  })

  it('says so when every quest on the map is hidden', async () => {
    await renderHidable({ quest_hidden: { regular: MY_QUESTS.map(q => q.id) } })

    expect(screen.getByText('EVERY QUEST HERE IS HIDDEN')).toBeTruthy()
    expect(screen.getByRole('button', { name: /HIDDEN \(3\)/ })).toBeTruthy()
  })
})
