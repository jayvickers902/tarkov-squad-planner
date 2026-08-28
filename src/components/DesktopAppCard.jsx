import { relativeTime } from '../syncStatus'

// TODO(owner): set this to the real release URL before shipping.
export const DESKTOP_APP_URL = ''

export function DesktopDownloadAction({ url = DESKTOP_APP_URL } = {}) {
  return url
    ? <a className="btn-gold btn-sm" href={url} rel="noopener noreferrer">DOWNLOAD DESKTOP APP</a>
    : <button className="btn-ghost btn-sm" type="button" disabled>Download link coming soon</button>
}

function desktopState(companion) {
  if (companion?.desktopState) return companion.desktopState
  return companion?.desktopConnected === true ? 'connected' : 'not-setup'
}

function DesktopTimestamps({ companion }) {
  const lastSuccessfulSync = companion?.desktopLastSuccessfulSync ?? companion?.desktopLastSyncAt
  return (
    <span className="desktop-app-card-last-sync">
      Last report {relativeTime(companion?.desktopLastSeen) || 'NOT YET'}
      {' · '}Last successful check {relativeTime(lastSuccessfulSync) || 'NOT YET'}
    </span>
  )
}

export default function DesktopAppCard({ companion }) {
  const state = desktopState(companion)
  if (state === 'connected') {
    return (
      <div className="card desktop-app-card" data-state="connected">
        <span className="desktop-app-card-dot" aria-hidden="true" />
        <span className="mono desktop-app-card-label">DESKTOP APP CONNECTED</span>
        <DesktopTimestamps companion={companion} />
      </div>
    )
  }

  if (state === 'attention' || state === 'offline') {
    return (
      <div className="card desktop-app-card" data-state={state}>
        <h3>{state === 'attention' ? 'DESKTOP APP NEEDS ATTENTION' : 'DESKTOP APP OFFLINE'}</h3>
        <p>
          {state === 'attention'
            ? 'The desktop app reported a setup or sync problem. Open it to review the affected folder.'
            : 'The desktop app was set up, but it has not reported recently. Start it to resume background checks.'}
        </p>
        <DesktopTimestamps companion={companion} />
      </div>
    )
  }

  const downloadable = Boolean(DESKTOP_APP_URL)
  return (
    <div className="card desktop-app-card" data-state={downloadable ? 'available' : 'coming-soon'}>
      <h3>{downloadable ? 'SYNC WITHOUT THE TAB OPEN' : 'BACKGROUND SYNC APP · COMING SOON'}</h3>
      {downloadable ? (
        <>
          <p>The browser can watch your folders only while this site is open. The desktop app keeps your quests and pings in sync in the background.</p>
          <ol>
            <li>Download the desktop app.</li>
            <li>Sign in with the same Google account you use here.</li>
            <li>That is it — this card will switch to CONNECTED once it reports in.</li>
          </ol>
        </>
      ) : (
        <p>
          Website folder sync pauses when this tab closes. A Windows companion for continuous quest
          and ping checks is being prepared; it will pair by using the same Google account.
        </p>
      )}
      <DesktopDownloadAction />
    </div>
  )
}
