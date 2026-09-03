import { describe, expect, it } from 'vitest'
import { appRoutePath, CHANGELOG_PATH, parseAppPath } from './useAppRoute'

describe('the changelog route', () => {
  it('parses its path, whatever case it arrives in', () => {
    expect(parseAppPath('/changelog')).toEqual({ screen: 'changelog' })
    expect(parseAppPath('/CHANGELOG')).toEqual({ screen: 'changelog' })
  })

  it('round-trips back to the same path', () => {
    expect(appRoutePath({ screen: 'changelog' })).toBe(CHANGELOG_PATH)
    expect(parseAppPath(appRoutePath({ screen: 'changelog' }))).toEqual({ screen: 'changelog' })
  })

  it('never carries a party code, even when one is handed to it', () => {
    // The page is public and party-independent — a member reading release notes
    // is still in their party, and the URL has no business implying otherwise.
    expect(appRoutePath({ screen: 'changelog', code: 'ABC123' })).toBe(CHANGELOG_PATH)
  })

  it('is not reachable as a party section', () => {
    expect(parseAppPath('/party/ABC123/changelog')).toEqual({ screen: 'lobby' })
  })

  it('leaves the other screens where they were', () => {
    expect(parseAppPath('/')).toEqual({ screen: 'lobby' })
    expect(parseAppPath('/quests')).toEqual({ screen: 'quests' })
    expect(parseAppPath('/admin')).toEqual({ screen: 'admin' })
    expect(parseAppPath('/party/ABC123')).toEqual({ screen: 'room', code: 'ABC123' })
    expect(parseAppPath('/changelogs')).toEqual({ screen: 'lobby' })
  })
})
