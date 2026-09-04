import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// AdminKeyManager is the only UI that writes the admin-curated map_keys and
// map_loot reference data, and its writes are preserved across every Phase 10
// cutover. But this file tests user experience, not authorization.
//
// AdminKeyManager itself performs NO admin check — it has no isAdmin prop and
// no internal is_admin lookup. The only gate is `isAdmin && ...` in App.jsx
// (profiles.is_admin), and the real security boundary is server-side: RLS
// policies and SECURITY DEFINER RPCs on map_keys/map_loot in Postgres. See
// docs/developer-readiness.md: "UI visibility is not treated as
// authorization." The privilege hole this component's data was exposed to —
// any signed-in user could self-grant profiles.is_admin — was closed by
// migration 10_34 at the database, not by anything a component can do.
// A green test in this file proves the write controls render and call the
// right hook with the right payload once mounted. It proves nothing about who
// is allowed to mount it.

const KEYS = [
  { id: 'k1', name: 'Dorm 114 Marked Key' },
  { id: 'k2', name: 'Emercom Med Unit 24 key' },
]

const TASKS = [
  { id: 't1', name: 'Debut' },
  { id: 't2', name: 'Shootout Picture' },
]

// Each hook AdminKeyManager reads is stubbed here so the component can mount
// without touching Supabase or tarkov.dev. vi.doMock (rather than a hoisted
// vi.mock) lets each test hand back its own spies and data, matching the
// dynamic-import pattern in ../questPanels.test.jsx.
function mockHooks({
  keys = KEYS,
  keysLoading = false,
  mapKeys = {},
  upsertKey = vi.fn(async () => ({ error: null })),
  lootRows = [],
  lootError = null,
  addLoot = vi.fn(async () => ({ error: null })),
  removeLoot = vi.fn(async () => ({ error: null })),
  tasks = TASKS,
  overrides = {},
  overridesLoading = false,
  upsertOverride = vi.fn(async () => ({ error: null, data: {} })),
} = {}) {
  vi.doMock('../useTarkov', () => ({
    useKeys: () => ({ keys, loading: keysLoading }),
    useTasks: () => ({ tasks }),
  }))
  vi.doMock('../useMapKeys', () => ({
    useMapKeys: () => ({ mapKeys, upsertKey }),
  }))
  vi.doMock('../useMapLoot', () => ({
    useMapLoot: () => ({ lootRows, error: lootError, addLoot, removeLoot }),
  }))
  vi.doMock('../useIntel', () => ({
    useIntel: () => ({ intelPoints: [] }),
  }))
  vi.doMock('../useIsMobile', () => ({
    useIsMobile: () => false,
  }))
  vi.doMock('../useQuestShareOverrides', () => ({
    useQuestShareOverrides: () => ({ overrides, loading: overridesLoading, upsertOverride }),
  }))
  return { upsertKey, addLoot, removeLoot, upsertOverride }
}

async function renderAdmin(hookOverrides, props = {}) {
  const spies = mockHooks(hookOverrides)
  const { default: AdminKeyManager } = await import('./AdminKeyManager')
  render(<AdminKeyManager onBack={vi.fn()} gameMode="regular" {...props} />)
  return spies
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('the authorization boundary is not in this component', () => {
  it('renders full write controls in every section as soon as it mounts, taking no admin prop of its own', async () => {
    await renderAdmin()

    // Keys section (default): the priority toggle and PLACE button are the
    // write controls for map_keys.
    expect(screen.getAllByRole('button', { name: '☆' }).length).toBe(KEYS.length)
    expect(screen.getAllByRole('button', { name: 'PLACE' }).length).toBe(KEYS.length)

    // Documents section: the write control for map_loot.
    fireEvent.click(screen.getByRole('button', { name: /DOCUMENTS/ }))
    expect(screen.getByRole('button', { name: /PLACE ON MAP/ })).toBeInTheDocument()

    // Shareability overrides section: writes quest_share_overrides.
    fireEvent.click(screen.getByRole('button', { name: /SHAREABILITY/ }))
    expect(screen.getByRole('button', { name: 'SAVE OVERRIDE' })).toBeInTheDocument()
  })

})

describe('write actions dispatch the expected hook callback', () => {
  it('marks a key priority through upsertKey, preserving its existing location', async () => {
    const mapKeys = { 'Dorm 114 Marked Key': { priority: false, loc_x: 0.4, loc_y: 0.6 } }
    const { upsertKey } = await renderAdmin({ mapKeys })

    fireEvent.click(screen.getAllByRole('button', { name: '☆' })[0])

    expect(upsertKey).toHaveBeenCalledWith('customs', 'Dorm 114 Marked Key', true, 0.4, 0.6)
  })

  it('deletes a placed document through removeLoot, by row id', async () => {
    const lootRows = [{ id: 'loot-7', loot_name: 'Test documentation', loc_x: 0.2, loc_y: 0.3, notes: null }]
    const { removeLoot } = await renderAdmin({ lootRows })

    fireEvent.click(screen.getByRole('button', { name: /DOCUMENTS/ }))
    fireEvent.click(screen.getByRole('button', { name: '×' }))

    expect(removeLoot).toHaveBeenCalledWith('loot-7')
    expect(removeLoot).toHaveBeenCalledTimes(1)
  })

  it('saves a shareability override through upsertOverride with the selected task and verdict', async () => {
    const { upsertOverride } = await renderAdmin()

    fireEvent.click(screen.getByRole('button', { name: /SHAREABILITY/ }))
    const [taskSelect, verdictSelect] = screen.getAllByRole('combobox')
    fireEvent.change(taskSelect, { target: { value: 't2' } })
    fireEvent.change(verdictSelect, { target: { value: 'shared' } })
    fireEvent.change(screen.getByLabelText('Override note'), { target: { value: 'Confirmed solo in patch notes' } })
    fireEvent.click(screen.getByRole('button', { name: 'SAVE OVERRIDE' }))

    expect(upsertOverride).toHaveBeenCalledWith({
      taskId: 't2',
      taskName: 'Shootout Picture',
      verdict: 'shared',
      note: 'Confirmed solo in patch notes',
    })
  })
})

describe('validation rejects an unprimed or incomplete write rather than submitting it', () => {
  it('disables SAVE OVERRIDE until a task is selected, so an id-less override cannot be submitted', async () => {
    const { upsertOverride } = await renderAdmin()
    fireEvent.click(screen.getByRole('button', { name: /SHAREABILITY/ }))

    const saveButton = screen.getByRole('button', { name: 'SAVE OVERRIDE' })
    expect(saveButton).toBeDisabled()

    // A disabled button does not dispatch a click in the DOM, so this also
    // proves the guard actually blocks the write rather than merely looking
    // disabled.
    fireEvent.click(saveButton)
    expect(upsertOverride).not.toHaveBeenCalled()

    const [taskSelect] = screen.getAllByRole('combobox')
    fireEvent.change(taskSelect, { target: { value: 't1' } })
    expect(saveButton).not.toBeDisabled()
  })

  it('ignores a map click in the keys section until a key is armed for placement', async () => {
    const { upsertKey } = await renderAdmin()

    fireEvent.click(screen.getByAltText('customs'))

    expect(upsertKey).not.toHaveBeenCalled()
  })

  it('ignores a map click in the documents section until PLACE ON MAP is armed', async () => {
    const { addLoot } = await renderAdmin()
    fireEvent.click(screen.getByRole('button', { name: /DOCUMENTS/ }))

    fireEvent.click(screen.getByAltText('customs'))

    expect(addLoot).not.toHaveBeenCalled()
  })
})
