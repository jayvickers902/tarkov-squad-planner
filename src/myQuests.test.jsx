import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: { from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) },
}))
vi.mock('./useTarkov', () => ({ useTasks: () => ({ tasks: [], loading: false }) }))

import MyQuests from './components/MyQuests'

afterEach(() => {
  localStorage.clear()
  cleanup()
})

const baseProps = {
  userId: 'user-1',
  userQuests: [],
  onAdd: vi.fn(),
  onBulkAdd: vi.fn(),
  onRemove: vi.fn(),
  onToggleImportant: vi.fn(),
  onToggleSkipped: vi.fn(),
  onClearAll: vi.fn(),
  onRestore: vi.fn(),
  onDone: vi.fn(),
  inParty: false,
  userSettings: {},
  onSetUserSetting: vi.fn(),
  gameMode: 'regular',
}

function quest(overrides = {}) {
  return {
    quest_id: 'q1',
    quest_name: 'Debut',
    map_norm: 'customs',
    important: false,
    skipped: false,
    ...overrides,
  }
}

// MyQuests had no render coverage, which let a temporal-dead-zone reference
// (snapKey reading gameMode before its declaration) reach the working tree while
// the build and 38 other tests stayed green. This renders the real component.
describe('MyQuests render smoke', () => {
  it('renders for a signed-in user without throwing', () => {
    render(<MyQuests {...baseProps} />)

    expect(screen.getByRole('heading', { name: 'QUEST MANAGER' })).toBeInTheDocument()
    expect(screen.getByText('NO QUESTS YET')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'GET YOUR QUESTS IN' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'BACK TO PARTY' })).not.toBeInTheDocument()
    // Snapshot and danger zone belong to a populated list.
    expect(screen.queryByRole('button', { name: /SAVE \(/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /CLEAR ALL/ })).not.toBeInTheDocument()
  })

  it('keeps the return action when Quest Manager is opened from a party', () => {
    const onDone = vi.fn()
    render(<MyQuests {...baseProps} inParty onDone={onDone} />)

    fireEvent.click(screen.getByRole('button', { name: 'BACK TO PARTY' }))

    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('focuses the rail search, which is always mounted', () => {
    render(<MyQuests {...baseProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'ADD ONE MANUALLY' }))

    expect(screen.getByRole('textbox', { name: 'Search saved quests' })).toHaveFocus()
  })
})

describe('MyQuests saved list', () => {
  it('groups quests by map and counts them in the banner readout', () => {
    render(<MyQuests {...baseProps} userQuests={[
      quest(),
      quest({ quest_id: 'q2', quest_name: 'Checking', important: true }),
      quest({ quest_id: 'q3', quest_name: 'Shootout Picnic', map_norm: null, skipped: true }),
    ]} />)

    expect(screen.getByText('3 ACTIVE')).toBeInTheDocument()
    expect(screen.getByText('★ 1 STARRED')).toBeInTheDocument()
    expect(screen.getByText('⊘ 1 SKIPPED')).toBeInTheDocument()

    const customs = screen.getByRole('region', { name: 'CUSTOMS' })
    expect(within(customs).getByText('2 QUESTS')).toBeInTheDocument()
    expect(within(customs).getByText('Debut')).toBeInTheDocument()
    // ANY MAP is always the last group, never sorted in by count.
    const groups = screen.getAllByRole('region').map(node => node.getAttribute('aria-label'))
    expect(groups).toEqual(['CUSTOMS', 'ANY MAP', 'Quest history'])
  })

  it('filters the list by the toolbar search', () => {
    render(<MyQuests {...baseProps} userQuests={[quest(), quest({ quest_id: 'q2', quest_name: 'Checking' })]} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Search your quests' }), { target: { value: 'check' } })

    expect(screen.getByText('Checking')).toBeInTheDocument()
    expect(screen.queryByText('Debut')).not.toBeInTheDocument()
  })

  it('says so rather than rendering an empty group when a filter excludes everything', () => {
    render(<MyQuests {...baseProps} userQuests={[quest()]} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Search your quests' }), { target: { value: 'nothing' } })

    expect(screen.getByText('NO QUESTS FOR THIS FILTER')).toBeInTheDocument()
  })

  it('runs a bulk action over every ticked row, then clears the selection', async () => {
    const onRemove = vi.fn()
    render(<MyQuests {...baseProps} onRemove={onRemove} userQuests={[quest(), quest({ quest_id: 'q2', quest_name: 'Checking' })]} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Debut' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Checking' }))
    expect(screen.getByText('2 SELECTED')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '× REMOVE' }))

    // Rows are applied one at a time so a failure cannot burst the whole set.
    await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(2))
    expect(onRemove.mock.calls.map(([id]) => id)).toEqual(['q1', 'q2'])
    expect(screen.queryByText('2 SELECTED')).not.toBeInTheDocument()
  })

  it('collapses a map group and remembers it', () => {
    const view = render(<MyQuests {...baseProps} userQuests={[quest()]} />)

    fireEvent.click(within(screen.getByRole('region', { name: 'CUSTOMS' })).getByRole('button', { name: 'COLLAPSE' }))
    expect(screen.queryByText('Debut')).not.toBeInTheDocument()

    view.unmount()
    render(<MyQuests {...baseProps} userQuests={[quest()]} />)
    expect(screen.queryByText('Debut')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'EXPAND' })).toBeInTheDocument()
  })
})

describe('MyQuests history', () => {
  it('loads terminal rows on first expand and reactivates one', async () => {
    const onAdd = vi.fn()
    const onGetQuestHistory = vi.fn().mockResolvedValue([
      { quest_id: 'q9', quest_name: 'Gunsmith - Part 1', state: 'completed', state_at: '2026-08-28T00:00:00.000Z', map_norm: null },
      { quest_id: 'q8', quest_name: 'The Extortionist', state: 'failed', state_at: '2026-08-26T00:00:00.000Z', map_norm: 'customs' },
      { quest_id: 'q7', quest_name: 'Still active', state: 'active', state_at: '2026-08-25T00:00:00.000Z', map_norm: null },
    ])
    render(<MyQuests {...baseProps} onAdd={onAdd} onGetQuestHistory={onGetQuestHistory} userQuests={[quest()]} />)

    expect(onGetQuestHistory).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'SHOW HISTORY' }))

    expect(await screen.findByText('Gunsmith - Part 1')).toBeInTheDocument()
    // Only completed and failed rows are history; an active row is the list itself.
    expect(screen.queryByText('Still active')).not.toBeInTheDocument()
    expect(screen.getByText('1 COMPLETED')).toBeInTheDocument()
    expect(screen.getByText('1 FAILED')).toBeInTheDocument()

    const failedRow = screen.getByText('The Extortionist').closest('.quest-history-row')
    fireEvent.click(within(failedRow).getByRole('button', { name: 'REACTIVATE' }))

    expect(onAdd).toHaveBeenCalledWith({ id: 'q8', name: 'The Extortionist' }, 'customs')
    expect(screen.queryByText('The Extortionist')).not.toBeInTheDocument()
  })
})

describe('MyQuests ordering', () => {
  const three = [
    { quest_id: 'a', quest_name: 'Alpha', map_norm: 'customs', important: false, skipped: false },
    { quest_id: 'b', quest_name: 'Bravo', map_norm: 'customs', important: false, skipped: false },
    { quest_id: 'c', quest_name: 'Charlie', map_norm: 'woods', important: false, skipped: false },
  ]

  function names() {
    return [...document.querySelectorAll('.quest-row-name')].map(node => node.textContent)
  }

  function dragHandle(name) {
    return screen.getByRole('button', { name: new RegExp(`^Reorder ${name}\.`) })
  }

  it('reorders on drop', () => {
    render(<MyQuests {...baseProps} userQuests={three} />)
    expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie'])

    const dataTransfer = { effectAllowed: '' }
    fireEvent.dragStart(dragHandle('Bravo'), { dataTransfer })
    fireEvent.drop(screen.getByText('Alpha').closest('.quest-row'), { dataTransfer })

    expect(names()).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })

  it('lets a drop across groups move a row inside its own group', () => {
    // A drag never changes a quest's map, so a cross-group drop is only ever
    // visible as a move within the dragged row's own group — but it is the one
    // way to edit the single flat order the party reads as priority.
    render(<MyQuests {...baseProps} userQuests={[
      ...three,
      { quest_id: 'd', quest_name: 'Delta', map_norm: 'woods', important: false, skipped: false },
    ]} />)
    expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])

    const dataTransfer = { effectAllowed: '' }
    fireEvent.dragStart(dragHandle('Delta'), { dataTransfer })
    fireEvent.drop(screen.getByText('Alpha').closest('.quest-row'), { dataTransfer })

    expect(names()).toEqual(['Alpha', 'Bravo', 'Delta', 'Charlie'])
  })

  it('moves a row with Alt and an arrow key, keeping focus on its handle', () => {
    render(<MyQuests {...baseProps} userQuests={three} />)

    const handle = dragHandle('Bravo')
    handle.focus()
    fireEvent.keyDown(handle, { key: 'ArrowUp', altKey: true })

    expect(names()).toEqual(['Bravo', 'Alpha', 'Charlie'])
    expect(dragHandle('Bravo')).toHaveFocus()
  })

  // HTML5 drag never fires for touch, so the handle runs a pointer gesture too.
  // Reordering by finger is the only path a phone has: the buttons this replaced
  // were onClick, and Alt+arrow needs a keyboard.
  // jsdom has no elementFromPoint at all, which is why the component calls it
  // optionally; stub it rather than spy on it.
  function overPoint(target, run) {
    document.elementFromPoint = () => target
    try { run() } finally { delete document.elementFromPoint }
  }

  function pointerDrag(fromName, toName, { finish = 'up' } = {}) {
    const handle = dragHandle(fromName)
    const target = screen.getByText(toName).closest('.quest-row')
    overPoint(target, () => {
      fireEvent.pointerDown(handle, { pointerId: 7, pointerType: 'touch' })
      fireEvent.pointerMove(handle, { pointerId: 7, pointerType: 'touch', clientX: 10, clientY: 40 })
      if (finish === 'up') fireEvent.pointerUp(handle, { pointerId: 7, pointerType: 'touch' })
      else fireEvent.pointerCancel(handle, { pointerId: 7, pointerType: 'touch' })
    })
  }

  it('reorders from a touch drag on the handle', () => {
    render(<MyQuests {...baseProps} userQuests={three} />)

    pointerDrag('Bravo', 'Alpha')

    expect(names()).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })

  it('leaves the order alone when a touch drag is cancelled', () => {
    render(<MyQuests {...baseProps} userQuests={three} />)

    pointerDrag('Bravo', 'Alpha', { finish: 'cancel' })

    expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('leaves a mouse pointer to the native drag path so one gesture is not handled twice', () => {
    render(<MyQuests {...baseProps} userQuests={three} />)
    const target = screen.getByText('Alpha').closest('.quest-row')

    overPoint(target, () => {
      fireEvent.pointerDown(dragHandle('Bravo'), { pointerId: 3, pointerType: 'mouse' })
      fireEvent.pointerMove(dragHandle('Bravo'), { pointerId: 3, pointerType: 'mouse', clientX: 10, clientY: 40 })
      fireEvent.pointerUp(dragHandle('Bravo'), { pointerId: 3, pointerType: 'mouse' })
    })

    expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('ignores an arrow key without Alt so the row is not reordered by browsing', () => {
    render(<MyQuests {...baseProps} userQuests={three} />)

    fireEvent.keyDown(dragHandle('Bravo'), { key: 'ArrowUp' })

    expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })
})

describe('MyQuests kappa filter', () => {
  it('keeps only the kappa quests when the toggle is on', () => {
    render(<MyQuests {...baseProps} userQuests={[quest(), quest({ quest_id: 'q2', quest_name: 'Checking' })]} />)

    // Without live task data nothing is known to be kappa, so the filter empties
    // the list rather than silently passing everything through.
    fireEvent.click(screen.getByRole('button', { name: 'κ ONLY' }))

    expect(screen.getByText('NO QUESTS FOR THIS FILTER')).toBeInTheDocument()
  })
})
