import { useState } from 'react'
import { RELEASE_VERSION } from '../whatsNew'

const REPO = 'https://github.com/jayvickers902/tarkov-squad-planner'

const DISCLAIMER = 'Escape from Tarkov is a trademark of Battlestate Games Limited. Squad Planner is an unofficial fan project, not affiliated with or endorsed by Battlestate Games. Quest, map and item data via tarkov.dev.'
const OPEN_SOURCE = 'Open source under the MIT licence — free to use, fork and self-host.'

// The mark is decoration, not information. It lives in public/ because the CSP
// is img-src 'self', so it can never be hotlinked, and it drops itself if the
// file is missing rather than leaving a broken-image box in the floor. The
// byline carries the name either way.
function Mark() {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      className="app-footer-mark"
      src="/jayshalla.webp"
      alt=""
      width="34"
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
export default function AppFooter({ compact = false }) {
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
