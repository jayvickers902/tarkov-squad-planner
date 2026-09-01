import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../useTarkov', () => ({
  useKeys: () => ({ allKeys: [] }),
  useItemSourcing: () => ({ sourcing: { item: { fleaPrice: 100, minLevelForFlea: 1 } }, loading: false }),
}))

import RequiredItems from './RequiredItems'

describe('RequiredItems sourcing', () => {
  it('does not render a purchase source for a found-in-raid hand-in', () => {
    render(
      <RequiredItems
        tasks={[{
          id: 'task',
          name: 'Task',
          objectives: [{ id: 'objective', type: 'plantItem', item: { id: 'item', name: 'Quest item' }, foundInRaid: true }],
        }]}
        memberQuests={[{ callsign: 'ME', user_id: 'user', quests: [{ id: 'task' }] }]}
        progress={{}}
        mapNorm={null}
        gameMode="regular"
      />,
    )
    expect(screen.getByText('FIR')).toBeInTheDocument()
    expect(screen.queryByText(/₽100|FLEA ·|Prapor LL/)).not.toBeInTheDocument()
  })
})
