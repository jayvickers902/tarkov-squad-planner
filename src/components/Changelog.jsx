import { useEffect, useMemo, useState } from 'react'
import AppFooter from './AppFooter'
import Icon from './Icon'
import { FIRST_LIVE_NOTES_VERSION, RELEASES, RELEASE_TAGS } from '../whatsNew'

const ALL = 'ALL'
const BANNER_ART = "url('/splash-2560.webp')"

// A version is a URL fragment, so the dot has to go: '2026.15' -> 'v2026-15'.
// Stable forever — an anchor someone linked to must not move under them.
export function releaseAnchor(version) {
  return `v${String(version).replace(/\./g, '-')}`
}

// Dates are authored as plain YYYY-MM-DD. new Date() on that string is UTC
// midnight, which renders as the previous day for anyone west of Greenwich,
// so the parts are read off the string instead of through a timezone.
export function releaseDateLabel(date) {
  const [year, month, day] = String(date).split('-')
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  const name = months[Number(month) - 1]
  if (!name || !year) return String(date)
  return `${Number(day)} ${name} ${year}`
}

function tagCounts(releases) {
  const counts = { [ALL]: 0 }
  for (const tag of RELEASE_TAGS) counts[tag] = 0
  for (const release of releases) {
    for (const item of release.items) {
      counts[ALL] += 1
      if (counts[item.tag] !== undefined) counts[item.tag] += 1
    }
  }
  return counts
}

// `navless` is the signed-out mount: App renders this page on its own, with no
// AppNav above it, so the sticky filter bar has no 38px of chrome to clear.
export default function Changelog({ onBack, navless = false }) {
  const [tag, setTag] = useState(ALL)

  const counts = useMemo(() => tagCounts(RELEASES), [])

  // Filtering drops the items that do not match and then the releases left with
  // nothing in them, so FIXED does not scroll past ten empty version headers.
  const visible = useMemo(() => {
    if (tag === ALL) return RELEASES
    return RELEASES
      .map(release => ({ ...release, items: release.items.filter(item => item.tag === tag) }))
      .filter(release => release.items.length > 0)
  }, [tag])

  const span = `${releaseDateLabel(RELEASES[RELEASES.length - 1].date)} — ${releaseDateLabel(RELEASES[0].date)}`

  // A deep link lands before the list has painted, so the browser has nothing to
  // scroll to yet. Do it once on mount, and only for a fragment that names a
  // release we actually have.
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!hash) return
    if (!RELEASES.some(release => releaseAnchor(release.version) === hash)) return
    document.getElementById(hash)?.scrollIntoView({ block: 'start' })
  }, [])

  return (
    <div className={`changelog-page${navless ? ' changelog-navless' : ''}`}>
      <header className="room-banner changelog-banner">
        <div className="room-banner-art" aria-hidden="true">
          <div className="room-banner-layer" style={{ backgroundImage: BANNER_ART }} />
          <div className="room-banner-fade" />
          <div className="room-banner-vignette" />
          <div className="room-banner-underline" />
        </div>
        <div className="room-banner-row">
          <div className="room-banner-identity">
            <span className="room-banner-rail" aria-hidden="true" />
            <div className="room-banner-identity-copy">
              <div className="mono room-banner-meta">
                <span className="room-banner-meta-label">RELEASE HISTORY</span>
                <span className="room-banner-meta-divider" aria-hidden="true" />
                <span className="room-banner-readout">{RELEASES.length} RELEASES</span>
                <span className="room-banner-meta-divider" aria-hidden="true" />
                <span className="room-banner-readout">{span}</span>
              </div>
              <h1 className="room-banner-title">CHANGELOG</h1>
              <p className="changelog-lede">
                Everything that has shipped to dudgy.net, newest first.
              </p>
            </div>
          </div>
          <div className="room-banner-spacer" />
          <div className="room-banner-controls">
            {onBack && (
              <button className="room-banner-btn" onClick={onBack} type="button">
                <Icon name="arrow-left" size="sm" /> BACK
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="changelog-toolbar">
        <div className="changelog-filters" role="group" aria-label="Filter by change type">
          {[ALL, ...RELEASE_TAGS].map(value => (
            <button
              key={value}
              type="button"
              className={`mono changelog-chip${tag === value ? ' is-active' : ''}`}
              aria-pressed={tag === value}
              onClick={() => setTag(value)}
            >
              {value} <span className="changelog-chip-count">{counts[value]}</span>
            </button>
          ))}
        </div>
        {tag !== ALL && (
          <span className="mono changelog-filter-note">
            {visible.length} OF {RELEASES.length} RELEASES
          </span>
        )}
      </div>

      <div className="changelog-body">
        {/* The index is navigation, not content, and every entry it lists is
            already on the page below it — so it is hidden from narrow screens
            rather than stacked above a list it duplicates. */}
        <nav className="changelog-index" aria-label="Jump to a release">
          <span className="lbl">RELEASES</span>
          <ol>
            {visible.map(release => (
              <li key={release.version}>
                <a href={`#${releaseAnchor(release.version)}`}>
                  <span className="mono changelog-index-ver">{release.version}</span>
                  <span className="changelog-index-title">{release.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <main className="changelog-list">
          {visible.map(release => {
            const anchor = releaseAnchor(release.version)
            const isLatest = release.version === RELEASES[0].version
            return (
              <article className="changelog-release" id={anchor} key={release.version}>
                <div className="changelog-release-head">
                  <a className="mono changelog-version" href={`#${anchor}`}>
                    {release.version}
                    {isLatest && <span className="changelog-latest">LATEST</span>}
                  </a>
                  <time className="mono changelog-date" dateTime={release.date}>
                    {releaseDateLabel(release.date)}
                  </time>
                </div>
                <div className="changelog-release-body">
                  <h2>{release.title}</h2>
                  <ul className="changelog-items">
                    {release.items.map(item => (
                      <li className="changelog-item" key={item.title}>
                        <span className={`mono changelog-tag is-${item.tag.toLowerCase()}`}>{item.tag}</span>
                        <div className="changelog-item-copy">
                          <h3>{item.title}</h3>
                          <p>{item.body}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            )
          })}

          {visible.length === 0 && (
            <p className="changelog-empty">Nothing in this release history is tagged {tag}.</p>
          )}

          {visible.length > 0 && (
            <p className="changelog-provenance">
              Release notes have been written as the work shipped since {FIRST_LIVE_NOTES_VERSION}. The
              entries before it were reconstructed from the commit history afterwards and grouped by the
              week they landed, so their dates are accurate but their headlines were chosen in hindsight.
            </p>
          )}
        </main>
      </div>

      <AppFooter />
    </div>
  )
}
