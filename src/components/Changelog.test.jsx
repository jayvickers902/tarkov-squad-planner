import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Changelog, { releaseAnchor, releaseDateLabel } from './Changelog'
import { RELEASES, RELEASE_TAGS } from '../whatsNew'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const releases = () => document.querySelectorAll('.changelog-release')

describe('releaseAnchor', () => {
  it('turns a version into a fragment the URL can carry', () => {
    expect(releaseAnchor('2026.15')).toBe('v2026-15')
  })
})

describe('releaseDateLabel', () => {
  it('reads the date off the string rather than through a timezone', () => {
    // new Date('2026-03-31') is UTC midnight, which is 30 March in the Americas.
    expect(releaseDateLabel('2026-03-31')).toBe('31 MAR 2026')
  })

  it('passes an unparseable date through instead of rendering NaN', () => {
    expect(releaseDateLabel('whenever')).toBe('whenever')
  })
})

describe('Changelog', () => {
  it('lists every release, newest first, with its date', () => {
    render(<Changelog />)
    const rendered = releases()
    expect(rendered).toHaveLength(RELEASES.length)
    expect(rendered[0].id).toBe(releaseAnchor(RELEASES[0].version))
    expect(rendered[rendered.length - 1].id).toBe(releaseAnchor(RELEASES[RELEASES.length - 1].version))
    expect(within(rendered[0]).getByText(releaseDateLabel(RELEASES[0].date))).toBeInTheDocument()
  })

  it('badges only the shipped version as LATEST', () => {
    render(<Changelog />)
    expect(screen.getAllByText('LATEST')).toHaveLength(1)
    expect(within(releases()[0]).getByText('LATEST')).toBeInTheDocument()
  })

  it('gives every release an anchor that both the index and its own heading link to', () => {
    render(<Changelog />)
    const anchor = `#${releaseAnchor(RELEASES[2].version)}`
    const links = screen.getAllByRole('link').filter(a => a.getAttribute('href') === anchor)
    // One in the jump index, one on the version number itself.
    expect(links).toHaveLength(2)
    expect(document.getElementById(anchor.slice(1))).not.toBeNull()
  })

  it('filters to one tag and drops the releases left with nothing', () => {
    render(<Changelog />)
    const fixed = RELEASES.filter(r => r.items.some(i => i.tag === 'FIXED'))
    // A tag worth testing has to be absent from at least one release.
    expect(fixed.length).toBeLessThan(RELEASES.length)

    fireEvent.click(screen.getByRole('button', { name: /^FIXED/ }))
    expect(releases()).toHaveLength(fixed.length)
    expect(screen.getByText(`${fixed.length} OF ${RELEASES.length} RELEASES`)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^ALL/ }))
    expect(releases()).toHaveLength(RELEASES.length)
  })

  it('counts the items each filter would show', () => {
    render(<Changelog />)
    for (const tag of RELEASE_TAGS) {
      const total = RELEASES.reduce((n, r) => n + r.items.filter(i => i.tag === tag).length, 0)
      expect(screen.getByRole('button', { name: `${tag} ${total}` })).toBeInTheDocument()
    }
  })

  it('says where the reconstructed entries came from', () => {
    render(<Changelog />)
    expect(document.querySelector('.changelog-provenance')).toHaveTextContent('reconstructed from the commit history')
  })

  it('offers BACK only when there is somewhere to go back to', () => {
    const { unmount } = render(<Changelog />)
    expect(screen.queryByRole('button', { name: /BACK/ })).toBeNull()
    unmount()

    let backs = 0
    render(<Changelog onBack={() => { backs += 1 }} />)
    fireEvent.click(screen.getByRole('button', { name: /BACK/ }))
    expect(backs).toBe(1)
  })

  it('clears the nav offset only for the signed-out mount', () => {
    const { unmount } = render(<Changelog />)
    expect(document.querySelector('.changelog-page').className).not.toContain('changelog-navless')
    unmount()

    render(<Changelog navless />)
    expect(document.querySelector('.changelog-page').className).toContain('changelog-navless')
  })

  it('scrolls a deep link into view, and ignores a fragment it does not have', () => {
    const scrolled = []
    const original = window.HTMLElement.prototype.scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this.id) }
    try {
      window.location.hash = '#v2026-13'
      const { unmount } = render(<Changelog />)
      expect(scrolled).toEqual(['v2026-13'])
      unmount()

      window.location.hash = '#not-a-release'
      render(<Changelog />)
      expect(scrolled).toEqual(['v2026-13'])
    } finally {
      window.HTMLElement.prototype.scrollIntoView = original
    }
  })
})

describe('release data', () => {
  it('carries a known tag on every item', () => {
    for (const release of RELEASES) {
      for (const item of release.items) {
        expect(RELEASE_TAGS, `${release.version} / ${item.title}`).toContain(item.tag)
      }
    }
  })

  it('runs newest to oldest by both version and date', () => {
    const versions = RELEASES.map(r => r.version)
    expect(versions).toEqual([...versions].sort().reverse())
    const dates = RELEASES.map(r => r.date)
    expect(dates).toEqual([...dates].sort().reverse())
  })

  it('has no duplicate versions to collide on the same anchor', () => {
    const anchors = RELEASES.map(r => releaseAnchor(r.version))
    expect(new Set(anchors).size).toBe(anchors.length)
  })
})
