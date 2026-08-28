const SAFE_DEEP_LINK_NOTICE = 'Secure sign-in link received. Continue in the companion window.'

/**
 * Handle deep-link delivery without ever reflecting its contents. Deep links
 * can contain OAuth codes or other credentials and must stay at the adapter
 * boundary until the sync/auth engine consumes them.
 *
 * @param {unknown} urls
 * @param {(message: string) => void} notify
 * @returns {boolean} whether a non-empty event was handled
 */
export function handleDeepLinkNotice(urls, notify) {
  if (!Array.isArray(urls) || urls.length === 0) return false
  notify(SAFE_DEEP_LINK_NOTICE)
  return true
}

export { SAFE_DEEP_LINK_NOTICE }
