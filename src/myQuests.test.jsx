import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: { from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) },
}))
vi.mock('./useTarkov', () => ({ useTasks: () => ({ tasks: [], loading: false }) }))

import MyQuests from './components/MyQuests'

afterEach(cleanup)

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

// MyQuests had no render coverage, which let a temporal-dead-zone reference
// (snapKey reading gameMode before its declaration) reach the working tree while
// the build and 38 other tests stayed green. This renders the real component.
describe('MyQuests render smoke', () => {
  it('renders for a signed-in user without throwing', () => {
    render(<MyQuests {...baseProps} />)

    expect(screen.getByRole('heading', { name: 'QUEST MANAGER' })).toBeInTheDocument()
    expect(screen.getByLabelText('Quest setup progress')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'GET YOUR QUESTS IN' })).toBeInTheDocument()
    expect(screen.queryByText('LIVE POSITION PINGS')).not.toBeInTheDocument()
    expect(screen.queryByText('ADD QUEST TO YOUR LIST')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /SAVE SNAPSHOT/ })).not.toBeInTheDocument()
  })

  it('reveals and focuses manual search without expanding the other advanced blocks', () => {
    render(<MyQuests {...baseProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'ADD ONE MANUALLY' }))

    expect(screen.getByRole('textbox', { name: 'Search saved quests' })).toHaveFocus()
    expect(screen.getByText('ADD QUEST TO YOUR LIST')).toBeInTheDocument()
    expect(screen.queryByText('LIVE POSITION PINGS')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ALL (0)' })).not.toBeInTheDocument()
  })
})
