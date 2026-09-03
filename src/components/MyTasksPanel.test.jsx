import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MyTasksPanel from './MyTasksPanel'

afterEach(cleanup)

const ROWS = [
  {
    key: 'k1', focusKey: 't1::o1', taskId: 't1', objectiveId: 'o1', memberUserId: 'me',
    questName: 'Woods Keeper', questColor: '#c9a84c',
    description: 'Locate the camp', action: 'locate', carry: null,
    hasLocation: true, range: { dist: 210, dir: 'NE' },
  },
  {
    key: 'k2', focusKey: 't1::o2', taskId: 't1', objectiveId: 'o2', memberUserId: 'me',
    questName: 'Woods Keeper', questColor: '#c9a84c',
    description: 'Mark the pylon', action: 'place marker', carry: { name: 'MS2000', count: 1 },
    hasLocation: true, range: { dist: 640, dir: 'W' },
  },
  {
    key: 'k3', focusKey: 't2::o3', taskId: 't2', objectiveId: 'o3', memberUserId: 'me',
    questName: 'Test Drive', questColor: '#4b8fb8',
    description: 'Eliminate 7 PMCs', action: 'eliminate', carry: null,
    hasLocation: false, range: null,
  },
]

const GROUPS = [
  {
    questId: 't1', questName: 'Woods Keeper', color: '#c9a84c', rows: ROWS.slice(0, 2),
    done: 1, total: 2, tally: '1/2',
    wiki: 'https://escapefromtarkov.antifandom.com/wiki/Woods_Keeper',
  },
  { questId: 't2', questName: 'Test Drive', color: '#4b8fb8', rows: ROWS.slice(2), done: 0, total: 1, tally: '0/1', wiki: null },
]

function renderPanel(props = {}) {
  return render(
    <MyTasksPanel
      live
      groups={GROUPS}
      doneCount={1}
      totalCount={3}
      isDone={row => row.key === 'k1'}
      onToggle={vi.fn()}
      {...props}
    />,
  )
}

describe('MyTasksPanel', () => {
  it('groups rows under their quest and shows each group tally', () => {
    renderPanel()
    expect(screen.getByText('Woods Keeper')).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getByText('0/1')).toBeInTheDocument()
  })

  it('reads the carried item into the objective sub-line', () => {
    renderPanel()
    expect(screen.getByText('place marker · carry MS2000 ×1')).toBeInTheDocument()
    expect(screen.getByText('locate')).toBeInTheDocument()
  })

  it('shows distance chips in LIVE and prep chips in PLAN', () => {
    const { rerender } = renderPanel()
    expect(screen.getByText('210 m NE')).toBeInTheDocument()
    expect(screen.getByText('ANYWHERE')).toBeInTheDocument()

    rerender(
      <MyTasksPanel live={false} groups={GROUPS} doneCount={1} totalCount={3}
        isDone={row => row.key === 'k1'} onToggle={vi.fn()} />,
    )
    expect(screen.getByText('PREP')).toBeInTheDocument()
    expect(screen.getByText('ON MAP')).toBeInTheDocument()
  })

  it('ticks from anywhere on the row, by click and by keyboard', () => {
    const onToggle = vi.fn()
    renderPanel({ onToggle })
    const row = screen.getByTitle('Mark the pylon')

    fireEvent.click(row)
    expect(onToggle).toHaveBeenCalledWith(ROWS[1])

    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    expect(onToggle).toHaveBeenCalledTimes(3)
  })

  it('marks a done row pressed and struck through', () => {
    renderPanel()
    const done = screen.getByTitle('Locate the camp')
    expect(done).toHaveAttribute('aria-pressed', 'true')
    expect(done.className).toContain('is-done')
    expect(within(done).getByText('✕')).toBeInTheDocument()
  })

  it('keeps a row with no map location tickable', () => {
    const onToggle = vi.fn()
    renderPanel({ onToggle })
    fireEvent.click(screen.getByTitle('Eliminate 7 PMCs'))
    expect(onToggle).toHaveBeenCalledWith(ROWS[2])
  })

  it('focuses the map from the chip without also ticking the row', () => {
    const onToggle = vi.fn()
    const onToggleFocus = vi.fn()
    renderPanel({ onToggle, onToggleFocus })

    fireEvent.click(screen.getByRole('button', { name: /Show Locate the camp on the map/ }))
    expect(onToggleFocus).toHaveBeenCalledWith('t1::o1')
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('offers no focus control for a row the map cannot place', () => {
    renderPanel()
    expect(screen.queryByRole('button', { name: /Show Eliminate 7 PMCs/ })).not.toBeInTheDocument()
  })

  it('changes its sub-line and footer note between PLAN and LIVE', () => {
    const { rerender } = renderPanel()
    expect(screen.getByText('SORTED BY DISTANCE FROM YOU')).toBeInTheDocument()
    expect(screen.getByText('TICKS SAVE INSTANTLY — NO SUBMIT')).toBeInTheDocument()

    rerender(
      <MyTasksPanel live={false} groups={GROUPS} doneCount={1} totalCount={3}
        isDone={() => false} onToggle={vi.fn()} />,
    )
    expect(screen.getByText('PREP CHECK · SELF-ONLY TICKS')).toBeInTheDocument()
    expect(screen.getByText('TICK PREP ITEMS BEFORE YOU QUEUE')).toBeInTheDocument()
  })

  it('says so when there is nothing on this map', () => {
    render(<MyTasksPanel live groups={[]} doneCount={0} totalCount={0} isDone={() => false} onToggle={vi.fn()} />)
    expect(screen.getByText('NO OBJECTIVES ON THIS MAP')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'FOLD ALL' })).not.toBeInTheDocument()
  })

  it('folds a quest to its header and back, keeping the tally readable', () => {
    renderPanel()
    const head = screen.getByRole('button', { name: 'Woods Keeper' })
    expect(head).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(head)
    expect(screen.getByRole('button', { name: 'Woods Keeper' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTitle('Locate the camp')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Mark the pylon')).not.toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getByTitle('Eliminate 7 PMCs')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Woods Keeper' }))
    expect(screen.getByTitle('Locate the camp')).toBeInTheDocument()
  })

  it('folds every quest at once, then opens them all again', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'FOLD ALL' }))
    expect(screen.queryByTitle('Locate the camp')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Eliminate 7 PMCs')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'OPEN ALL' }))
    expect(screen.getByTitle('Locate the camp')).toBeInTheDocument()
    expect(screen.getByTitle('Eliminate 7 PMCs')).toBeInTheDocument()
  })

  it('folds a finished quest by default and reopens it on request', () => {
    const finished = [{ ...GROUPS[0], done: 2, tally: '2/2' }, GROUPS[1]]
    render(
      <MyTasksPanel live groups={finished} doneCount={2} totalCount={3}
        isDone={row => row.taskId === 't1'} onToggle={vi.fn()} />,
    )
    // Woods Keeper is finished so it arrives folded; the quest with work left does not.
    expect(screen.queryByTitle('Locate the camp')).not.toBeInTheDocument()
    expect(screen.getByText('Woods Keeper')).toBeInTheDocument()
    expect(screen.getByTitle('Eliminate 7 PMCs')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Woods Keeper' }))
    expect(screen.getByTitle('Locate the camp')).toBeInTheDocument()
  })

  it('links the quest header at the wiki article, and offers nothing when there is none', () => {
    renderPanel()
    const link = screen.getByRole('link', { name: 'Open Woods Keeper on the wiki' })
    expect(link).toHaveAttribute('href', 'https://escapefromtarkov.antifandom.com/wiki/Woods_Keeper')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.queryByRole('link', { name: /Test Drive/ })).not.toBeInTheDocument()
  })

  it('reports the density preference up rather than owning it', () => {
    const onSetDense = vi.fn()
    const { rerender } = renderPanel({ onSetDense })
    const toggle = screen.getByRole('button', { name: 'DENSE' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(toggle)
    expect(onSetDense).toHaveBeenCalledWith(true)

    rerender(
      <MyTasksPanel live groups={GROUPS} doneCount={1} totalCount={3} dense onSetDense={onSetDense}
        isDone={row => row.key === 'k1'} onToggle={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'DENSE' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('.mr-tasks').className).toContain('is-dense')
    // Dense is a layout change only: the carry hint still ships with the row.
    expect(screen.getByText('place marker · carry MS2000 ×1')).toBeInTheDocument()
  })
})
