import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import StartRaidModal from './StartRaidModal'

// The real hooks hand back stable references, and so must these: a mock that
// allocates a fresh array every render busts every downstream memo, which hides
// anything that only misbehaves once a memo is actually cached.
vi.mock('../useTarkov', () => {
  const allKeys = []
  const bosses = []
  const extracts = [
    { id: 'power', name: 'D-2', faction: 'pmc', switchIds: ['switch'] },
    { id: 'coop', name: 'Scav Lands (Co-Op)', faction: 'shared', switchIds: [] },
    { id: 'scav', name: 'Scav Camp (Co-Op)', faction: 'scav', switchIds: [] },
  ]
  const getBossesForMap = () => bosses
  return {
    useBossSpawns: () => ({ getBossesForMap, loading: false }),
    useExtracts: () => ({ loading: false, extracts }),
    useKeys: () => ({ allKeys }),
  }
})

const item = { id: 'marker', name: 'MS2000 Marker', iconLink: null }
const salewa = { id: 'salewa', name: 'Salewa First Aid Kit', iconLink: null }
const tasks = [{
  id: 'task',
  name: 'A Fuel Matter',
  map: { normalizedName: 'reserve' },
  objectives: [{ id: 'objective', type: 'plantItem', item, count: 2 }],
}, {
  id: 'task-find',
  name: 'Postman Pat',
  map: { normalizedName: 'reserve' },
  objectives: [{ id: 'objective-find', type: 'findItem', item: salewa, count: 3, foundInRaid: true }],
}]
const party = {
  id: 'party',
  map_norm: 'reserve',
  map_name: 'Reserve',
  progress: {},
  members: [{ user_id: 'me', callsign: 'Jayshalla', quests: [{ id: 'task' }, { id: 'task-find' }] }],
}

const PACKED_KEY = '__prep__:marker:BRING::me'

function renderModal(overrides = {}) {
  const props = {
    party,
    myUserId: 'me',
    tasks,
    gameMode: 'regular',
    onSubmitProgress: vi.fn(),
    onClose: () => {},
    ...overrides,
  }
  return { ...render(<StartRaidModal {...props} />), props }
}

describe('StartRaidModal', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('writes a packed tick into shared party progress rather than local storage', () => {
    const { props } = renderModal()

    const itemRow = screen.getByRole('checkbox', { name: /MS2000 Marker/i })
    expect(itemRow).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('0 / 1 PACKED BY SQUAD')).toBeInTheDocument()

    fireEvent.click(itemRow)

    expect(props.onSubmitProgress).toHaveBeenCalledWith({ [PACKED_KEY]: true })
  })

  it('reads every packed tick back out of party progress', () => {
    renderModal({ party: { ...party, progress: { [PACKED_KEY]: true } } })

    expect(screen.getByRole('checkbox', { name: /MS2000 Marker/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('1 / 1 PACKED BY SQUAD')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('EVERYTHING PACKED')
  })

  it('shows a teammate packing their own item without offering their checkbox', () => {
    const squad = {
      ...party,
      progress: { '__prep__:marker:BRING::mate': true },
      members: [
        { user_id: 'me', callsign: 'Jayshalla', quests: [{ id: 'task-find' }] },
        { user_id: 'mate', callsign: 'Tlbt', quests: [{ id: 'task' }] },
      ],
    }
    renderModal({ party: squad })

    // Not mine to tick — merge_progress would stamp my uid on it, not theirs.
    expect(screen.queryByRole('checkbox', { name: /MS2000 Marker/i })).not.toBeInTheDocument()
    const row = screen.getByText('MS2000 Marker').closest('.start-raid-prep-row')
    expect(within(row).getByTitle('TLBT — packed')).toBeInTheDocument()
    expect(screen.getByText('1 / 1 PACKED BY SQUAD')).toBeInTheDocument()
  })

  it('splits a shared row into what each operator personally has to bring', () => {
    const squad = {
      ...party,
      members: [
        { user_id: 'me', callsign: 'Jayshalla', quests: [{ id: 'task' }] },
        { user_id: 'mate', callsign: 'Tlbt', quests: [{ id: 'task' }] },
      ],
    }
    renderModal({ party: squad })

    const row = screen.getByText('MS2000 Marker').closest('.start-raid-prep-row')
    // The row total is 4 between them; neither operator has to bring 4.
    expect(within(row).getByText('4×')).toBeInTheDocument()
    expect(within(row).getByTitle('JAYSHALLA needs 2 — not ticked yet')).toHaveTextContent('2×')
    expect(within(row).getByTitle('TLBT needs 2 — not ticked yet')).toHaveTextContent('2×')
  })

  it('keeps found-in-raid items out of the carry list and in WHAT TO LOOK OUT FOR', () => {
    const { container } = renderModal()

    const carry = container.querySelector('[aria-labelledby="raid-prep-items-title"]')
    const lookout = container.querySelector('[aria-labelledby="raid-prep-find-title"]')
    expect(within(carry).getByText('MS2000 Marker')).toBeInTheDocument()
    expect(within(carry).queryByText('Salewa First Aid Kit')).not.toBeInTheDocument()
    expect(within(lookout).getByText('Salewa First Aid Kit')).toBeInTheDocument()
    expect(screen.getByText('WHAT TO LOOK OUT FOR')).toBeInTheDocument()
    // A thing you loot in the raid is not a readiness question.
    expect(screen.getByText('0 / 1 PACKED BY SQUAD')).toBeInTheDocument()
  })

  // Upstream's Vitamins rework updated the objective text and items but left the
  // objective's maps, zones and requiredKeys pinned to Shoreline. The task-scope
  // override relocates the objective to Factory, and the key must not ride along
  // with it — Health Resort is not on Factory, and the quest needs no key at all.
  it('keeps a key repudiated by a task-scope override off the Factory prep list', () => {
    const staleKey = { id: 'health-resort-room-112', name: 'Health Resort west wing office room 112 key' }
    const vitamins = {
      id: '5b478eca86f7744642012254',
      name: 'Vitamins',
      map: null,
      objectives: [{
        id: '5b478f6886f774464201225a',
        type: 'findQuestItem',
        description: 'Locate and obtain the chemical container on Factory',
        maps: [{ normalizedName: 'shoreline' }],
        zones: [{ id: 'z', map: { normalizedName: 'shoreline' }, position: { x: 1, y: 0, z: 2 } }],
        requiredKeys: [[staleKey]],
      }],
    }
    renderModal({
      tasks: [vitamins],
      party: {
        ...party,
        map_norm: 'factory',
        map_name: 'Factory',
        members: [{ user_id: 'me', callsign: 'Jayshalla', quests: [{ id: vitamins.id }] }],
      },
    })

    expect(screen.queryByText(staleKey.name)).not.toBeInTheDocument()
    expect(screen.getByText('0 / 0 PACKED BY SQUAD')).toBeInTheDocument()
  })

  it('counts only raid-eligible extracts and labels structured conditions', () => {
    renderModal()

    expect(screen.getByText('2 EXTRACTS · 2 CONDITIONAL')).toBeInTheDocument()
    expect(screen.getByText('POWER')).toBeInTheDocument()
    expect(screen.getByText('CO-OP')).toBeInTheDocument()
  })

  it('puts lookouts before conditional extracts in the numbered brief', () => {
    const { container } = renderModal()
    const sections = [...container.querySelectorAll('.start-raid-main > section')]

    expect(sections.map(section => section.querySelector('.start-raid-section-number')?.textContent)).toEqual(['1', '2', '3'])
    expect(sections[1]).toHaveAttribute('aria-labelledby', 'raid-prep-find-title')
    expect(sections[2]).toHaveAttribute('aria-labelledby', 'raid-prep-extracts-title')
  })

  it('resets the dialog scroll position after the initial focus lands', () => {
    const originalFocus = HTMLElement.prototype.focus
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function focus(...args) {
      originalFocus.apply(this, args)
      const dialog = this.closest('[role="dialog"]')
      if (dialog) dialog.scrollTop = 999
    })

    try {
      const { container } = renderModal()
      expect(container.querySelector('[role="dialog"]')).toHaveProperty('scrollTop', 0)
    } finally {
      vi.restoreAllMocks()
    }
  })

  // The prep memos are only warm on the second render, so a hook called inside
  // one of them renders fine and then throws when the memo is cached. Every
  // other test here renders once, which is precisely how that shipped.
  it('survives a re-render once its memos are warm', () => {
    const props = {
      party,
      myUserId: 'me',
      tasks,
      gameMode: 'regular',
      onSubmitProgress: vi.fn(),
      onClose: () => {},
    }
    const { rerender } = render(<StartRaidModal {...props} />)

    rerender(<StartRaidModal {...props} onlineMemberIds={['me']} />)

    expect(screen.getByText('MS2000 Marker')).toBeInTheDocument()
  })
})
