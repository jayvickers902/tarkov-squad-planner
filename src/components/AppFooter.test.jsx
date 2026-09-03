import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

  it('links out to the repo, the issue form and the data source', () => {
    render(<AppFooter />)
    const links = screen.getAllByRole('link')
    expect(links.map(a => a.getAttribute('href'))).toEqual([
      REPO,
      `${REPO}/issues/new`,
      'https://tarkov.dev',
    ])
    // Every one leaves the app, so every one needs the opener guard.
    for (const link of links) expect(link).toHaveAttribute('rel', 'noopener noreferrer')
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
