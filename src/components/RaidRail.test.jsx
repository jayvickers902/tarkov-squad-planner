import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RaidRail from './RaidRail'

afterEach(cleanup)

const CARDS = [
  {
    userId: 'them', name: 'BJORN', color: '#5fd4a0', pingId: 'p-bjorn',
    state: { label: 'IN FRAME', tone: 'grn' },
    age: '42s',
    detail: ['180 m NE of you · moving E 3.1 m/s · ground level'],
    rows: [{ key: 'r1', label: 'Long Line — mark pylon', dist: '590 m' }],
  },
  {
    userId: 'me', name: 'YOU · SOLARIS', color: '#e8c96a', pingId: null,
    state: { label: 'NO ECHO', tone: 'dim' },
    age: 'NO ECHO',
    detail: ['no position ping this raid'],
    rows: [],
  },
]

function renderRail(props = {}) {
  return render(
    <RaidRail
      heading="SQUAD · LIVE"
      meta="1 ECHO"
      cards={CARDS}
      {...props}
    />,
  )
}

describe('RaidRail', () => {
  it('renders one card per member with its state, age and detail', () => {
    renderRail()
    expect(screen.getByText('SQUAD · LIVE')).toBeInTheDocument()
    expect(screen.getByText('BJORN')).toBeInTheDocument()
    expect(screen.getByText('IN FRAME')).toBeInTheDocument()
    expect(screen.getByText('42s')).toBeInTheDocument()
    expect(screen.getByText('180 m NE of you · moving E 3.1 m/s · ground level')).toBeInTheDocument()
  })

  it('renders a teammate objective read-only — no checkbox anywhere', () => {
    renderRail()
    expect(screen.getByText('Long Line — mark pylon')).toBeInTheDocument()
    expect(screen.getByText('590 m')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('focuses a member ping on click and on Enter', () => {
    const onFocusPing = vi.fn()
    renderRail({ onFocusPing })
    const card = screen.getByText('BJORN').closest('.mr-member')

    fireEvent.click(card)
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(onFocusPing).toHaveBeenCalledTimes(2)
    expect(onFocusPing).toHaveBeenCalledWith('p-bjorn')
  })

  it('leaves a member with no ping unfocusable', () => {
    const onFocusPing = vi.fn()
    renderRail({ onFocusPing })
    const card = screen.getByText('YOU · SOLARIS').closest('.mr-member')

    expect(card).not.toHaveAttribute('role', 'button')
    fireEvent.click(card)
    expect(onFocusPing).not.toHaveBeenCalled()
  })

  it('renders the aside and the footer call to action', () => {
    const onClick = vi.fn()
    renderRail({
      aside: { heading: 'EXTRACTS ON WOODS', body: 'RUAF Gate — needs a switch thrown.' },
      cta: { label: 'START RAID · 3 IN SQUAD', tone: 'gold', onClick },
    })

    expect(screen.getByText('EXTRACTS ON WOODS')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'START RAID · 3 IN SQUAD' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disables the call to action when it is waiting on somebody else', () => {
    renderRail({ cta: { label: 'WAITING FOR THE LEADER TO START', disabled: true, onClick: vi.fn() } })
    expect(screen.getByRole('button', { name: 'WAITING FOR THE LEADER TO START' })).toBeDisabled()
  })

  it('hosts the tasks panel and a drag handle only on mobile', () => {
    const { rerender } = renderRail({ tasksSlot: <div>MY TASKS SLOT</div> })
    expect(screen.getByText('MY TASKS SLOT')).toBeInTheDocument()

    rerender(<RaidRail heading="SQUAD" meta="" cards={CARDS} isMobile mobileHeight={40} onMobileHeight={vi.fn()} />)
    expect(screen.getByRole('separator', { name: 'Resize squad panel' })).toBeInTheDocument()
  })

  it('resizes the mobile sheet with the arrow keys', () => {
    const onMobileHeight = vi.fn()
    render(<RaidRail heading="SQUAD" meta="" cards={[]} isMobile mobileHeight={40} onMobileHeight={onMobileHeight} />)
    const handle = screen.getByRole('separator', { name: 'Resize squad panel' })

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(onMobileHeight).toHaveBeenCalledWith(45)
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(onMobileHeight).toHaveBeenCalledWith(35)
  })

  it('shows the empty label when nobody has reported', () => {
    render(<RaidRail heading="SQUAD · LIVE" meta="0 ECHOES" cards={[]} emptyLabel="NO SQUAD ECHO YET" />)
    expect(screen.getByText('NO SQUAD ECHO YET')).toBeInTheDocument()
  })

  it('tints the card rail with the member colour', () => {
    renderRail()
    const card = screen.getByText('BJORN').closest('.mr-member')
    expect(card).toHaveStyle({ borderLeftColor: '#5fd4a0' })
    expect(within(card).getByText('BJORN')).toHaveStyle({ color: '#5fd4a0' })
  })
})
