import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import StartRaidModal from './StartRaidModal'

vi.mock('../useTarkov', () => ({
  useBossSpawns: () => ({ getBossesForMap: () => [], loading: false }),
  useExtracts: () => ({
    loading: false,
    extracts: [
      { id: 'power', name: 'D-2', faction: 'pmc', switchIds: ['switch'] },
      { id: 'coop', name: 'Scav Lands (Co-Op)', faction: 'shared', switchIds: [] },
      { id: 'scav', name: 'Scav Camp (Co-Op)', faction: 'scav', switchIds: [] },
    ],
  }),
  useKeys: () => ({ allKeys: [] }),
}))

const item = { id: 'marker', name: 'MS2000 Marker', iconLink: null }
const tasks = [{
  id: 'task',
  name: 'A Fuel Matter',
  map: { normalizedName: 'reserve' },
  objectives: [{ id: 'objective', type: 'plantItem', item, count: 2 }],
}]
const party = {
  id: 'party',
  map_norm: 'reserve',
  map_name: 'Reserve',
  progress: {},
  members: [{ user_id: 'me', callsign: 'Jayshalla', quests: [{ id: 'task' }] }],
}

describe('StartRaidModal', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('updates the packed-item progress from the full interactive row', () => {
    render(<StartRaidModal party={party} myUserId="me" tasks={tasks} gameMode="regular" onClose={() => {}} />)

    const itemRow = screen.getByRole('checkbox', { name: /MS2000 Marker/i })
    expect(itemRow).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('0 / 1 ITEMS PACKED')).toBeInTheDocument()

    fireEvent.click(itemRow)

    expect(itemRow).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('1 / 1 ITEMS PACKED')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('EVERYTHING PACKED')
  })

  it('counts only raid-eligible extracts and labels structured conditions', () => {
    render(<StartRaidModal party={party} myUserId="me" tasks={tasks} gameMode="regular" onClose={() => {}} />)

    expect(screen.getByText('2 EXTRACTS · 2 CONDITIONAL')).toBeInTheDocument()
    expect(screen.getByText('POWER')).toBeInTheDocument()
    expect(screen.getByText('CO-OP')).toBeInTheDocument()
  })
})
