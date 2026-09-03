import { useState } from 'react'
import { CHANGELOG_PATH } from '../useAppRoute'
import { RELEASE_VERSION } from '../whatsNew'

const REPO = 'https://github.com/jayvickers902/tarkov-squad-planner'

const DISCLAIMER = 'Escape from Tarkov is a trademark of Battlestate Games Limited. Squad Planner is an unofficial fan project, not affiliated with or endorsed by Battlestate Games. Quest, map and item data via tarkov.dev.'
const OPEN_SOURCE = 'Open source under the MIT licence — free to use, fork and self-host.'

// The mark is decoration, not information. It lives in public/ because the CSP
// is img-src 'self', so it can never be hotlinked, and it drops itself if the
// file is missing rather than leaving a broken-image box in the floor. The
// byline carries the name either way. The art is a wide plate rather than an
// avatar, so it sits at its own 2.5:1 and is never cropped square.
function Mark() {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      className="app-footer-mark"
      src="/squadplanner.webp"
      alt=""
      width="84"
      height="34"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

// `compact` is the sign-in panel's shape: a 496px grid track that cannot take
// the three-column floor. Same content, stacked, minus the licence sentence -
// the GITHUB link carries that on a screen nobody reads the small print on.
//
// `onOpenChangelog` turns CHANGELOG into an in-app route change. It stays a
// real href either way, so middle-click and "open in new tab" work and a mount
// that was not given the callback still reaches the page - by full page load,
// which is only wrong for someone sitting in a live party.
export default function AppFooter({ compact = false, onOpenChangelog = null }) {
  function openChangelog(event) {
    if (!onOpenChangelog) return
    // Leave the modified clicks to the browser: they mean "somewhere else".
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    onOpenChangelog()
  }

  return (
    <footer className={`app-footer${compact ? ' app-footer-compact' : ''}`} aria-label="Site information">
      <div className="app-footer-inner">
        <div className="app-footer-brand">
          <Mark />
          <div className="app-footer-brand-copy">
            <span className="mono app-footer-title">
              SQUAD PLANNER <span className="app-footer-ver">v{RELEASE_VERSION}</span>
            </span>
            <span className="mono app-footer-by">
              MADE WITH <span className="app-footer-heart" role="img" aria-label="love">&#10084;</span> BY JAYSHALLA
            </span>
          </div>
        </div>

        <ul className="app-footer-links mono">
          <li><a href={CHANGELOG_PATH} onClick={openChangelog}>CHANGELOG</a></li>
          <li><a href={REPO} target="_blank" rel="noopener noreferrer">GITHUB</a></li>
          <li><a href={`${REPO}/issues/new`} target="_blank" rel="noopener noreferrer">REPORT A BUG</a></li>
          <li><a href="https://tarkov.dev" target="_blank" rel="noopener noreferrer">TARKOV.DEV</a></li>
        </ul>

        <p className="app-footer-legal">
          {compact ? DISCLAIMER : `${OPEN_SOURCE} ${DISCLAIMER}`}
        </p>
      </div>
    </footer>
  )
}
