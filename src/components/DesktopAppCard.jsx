import { relativeTime } from '../syncStatus'

// TODO(owner): set this to the real release URL before shipping.
export const DESKTOP_APP_URL = ''

export function DesktopDownloadAction({ url = DESKTOP_APP_URL } = {}) {
  return url
    ? <a className="btn-gold btn-sm" href={url} rel="noopener noreferrer">DOWNLOAD DESKTOP APP</a>
    : <button className="btn-ghost btn-sm" type="button" disabled>Download link coming soon</button>
}

export default function DesktopAppCard({ companion }) {
  if (companion?.desktopConnected === true) {
    return (
      <div className="card desktop-app-card" data-state="connected">
        <span className="desktop-app-card-dot" aria-hidden="true" />
        <span className="mono desktop-app-card-label">DESKTOP APP CONNECTED</span>
        <span className="desktop-app-card-last-sync">Last sync {relativeTime(companion.desktopLastSeen) || 'NOT YET'}</span>
      </div>
    )
  }

  return (
    <div className="card desktop-app-card" data-state="available">
      <h3>SYNC WITHOUT THE TAB OPEN</h3>
      <p>
        The browser can watch your folders only while this site is open. The desktop app keeps
        your quests and pings in sync in the background.
      </p>
      <ol>
        <li>Download the desktop app.</li>
        <li>Sign in with the same Google account you use here.</li>
        <li>That is it — this card will switch to CONNECTED once it reports in.</li>
      </ol>
      <DesktopDownloadAction />
    </div>
  )
}
