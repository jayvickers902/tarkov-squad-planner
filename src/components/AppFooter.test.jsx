import { cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AppFooter from './AppFooter'
import { RELEASE_VERSION } from '../whatsNew'

afterEach(cleanup)

const REPO = 'https://github.com/jayvickers902/tarkov-squad-planner'

describe('AppFooter', () => {
  it('carries the byline, the shipped version and the maker mark', () => {
    render(<AppFooter />)
    const foot = screen.getByRole('contentinfo')
    expect(within(foot).getByText(/MADE WITH/)).toHaveTextContent('BY JAYSHALLA')
    expect(within(foot).getByText(`v${RELEASE_VERSION}`)).toBeInTheDocument()
    // Decoration, so it stays out of the accessibility tree.
    expect(foot.querySelector('img.app-footer-mark')).toHaveAttribute('alt', '')
  })

  it('links to the changelog, the repo, the issue form and the data source', () => {
    render(<AppFooter />)
    const links = screen.getAllByRole('link')
    expect(links.map(a => a.getAttribute('href'))).toEqual([
      '/changelog',
      REPO,
      `${REPO}/issues/new`,
      'https://tarkov.dev',
    ])
    // Every link that leaves the app needs the opener guard; the changelog is
    // our own route, so it stays in the tab and takes neither target nor rel.
    const [changelog, ...external] = links
    expect(changelog).not.toHaveAttribute('target')
    expect(changelog).not.toHaveAttribute('rel')
    for (const link of external) expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('routes CHANGELOG in-app when it is given a handler', () => {
    let opened = 0
    render(<AppFooter onOpenChangelog={() => { opened += 1 }} />)
    const link = screen.getByRole('link', { name: 'CHANGELOG' })
    const event = createEvent.click(link)
    fireEvent(link, event)
    expect(opened).toBe(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves a modified click to the browser', () => {
    let opened = 0
    render(<AppFooter onOpenChangelog={() => { opened += 1 }} />)
    const link = screen.getByRole('link', { name: 'CHANGELOG' })
    const event = createEvent.click(link, { metaKey: true })
    fireEvent(link, event)
    expect(opened).toBe(0)
    expect(event.defaultPrevented).toBe(false)
  })

  it('falls back to a plain page load when no handler is given', () => {
    render(<AppFooter />)
    const link = screen.getByRole('link', { name: 'CHANGELOG' })
    const event = createEvent.click(link)
    fireEvent(link, event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('states the licence and disclaims the trademark', () => {
    render(<AppFooter />)
    const legal = screen.getByRole('contentinfo').querySelector('.app-footer-legal')
    expect(legal).toHaveTextContent('Open source under the MIT licence')
    expect(legal).toHaveTextContent('not affiliated with or endorsed by Battlestate Games')
  })

  it('drops the licence sentence in the compact sign-in variant', () => {
    render(<AppFooter compact />)
    const legal = screen.getByRole('contentinfo').querySelector('.app-footer-legal')
    expect(legal).not.toHaveTextContent('MIT licence')
    expect(legal).toHaveTextContent('not affiliated with or endorsed by Battlestate Games')
  })

  it('removes the mark rather than leaving a broken image when the file is absent', () => {
    render(<AppFooter />)
    const foot = screen.getByRole('contentinfo')
    const mark = foot.querySelector('img.app-footer-mark')
    fireEvent.error(mark)
    expect(foot.querySelector('img.app-footer-mark')).toBeNull()
    // The name survives the mark going missing.
    expect(within(foot).getByText(/MADE WITH/)).toHaveTextContent('BY JAYSHALLA')
  })
})
