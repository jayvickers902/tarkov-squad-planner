import { describe, expect, it, vi } from 'vitest'
import { handleDeepLinkNotice, SAFE_DEEP_LINK_NOTICE } from './deepLink.js'

describe('deep-link notice boundary', () => {
  it('does not surface OAuth or other URL contents', () => {
    const notify = vi.fn()
    const secretUrl = 'tarkov-squad-planner://auth?code=do-not-render-this'

    expect(handleDeepLinkNotice([secretUrl], notify)).toBe(true)
    expect(notify).toHaveBeenCalledWith(SAFE_DEEP_LINK_NOTICE)
    expect(notify.mock.calls.flat().join(' ')).not.toContain(secretUrl)
  })

  it('ignores empty or malformed events', () => {
    const notify = vi.fn()

    expect(handleDeepLinkNotice([], notify)).toBe(false)
    expect(handleDeepLinkNotice(null, notify)).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })
})
