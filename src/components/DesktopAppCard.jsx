import { relativeTime } from '../syncStatus'

export const DESKTOP_RELEASE_BASE = 'https://github.com/jayvickers902/tarkov-squad-planner/releases/latest/download'
export const DESKTOP_INSTALLERS = {
  x64Exe: `${DESKTOP_RELEASE_BASE}/Tarkov-Squad-Planner-Companion_x64-setup.exe`,
  x64Msi: `${DESKTOP_RELEASE_BASE}/Tarkov-Squad-Planner-Companion_x64.msi`,
  x86Exe: `${DESKTOP_RELEASE_BASE}/Tarkov-Squad-Planner-Companion_x86-setup.exe`,
  x86Msi: `${DESKTOP_RELEASE_BASE}/Tarkov-Squad-Planner-Companion_x86.msi`,
}

export function DesktopDownloadActions({ installers = DESKTOP_INSTALLERS } = {}) {
  return (
    <div className="desktop-downloads">
      <div className="desktop-downloads-primary" aria-label="64-bit Windows installers">
        <a className="btn-gold btn-sm" href={installers.x64Exe} target="_blank" rel="noopener noreferrer">DOWNLOAD .EXE · 64-BIT</a>
        <a className="btn-ghost btn-sm" href={installers.x64Msi} target="_blank" rel="noopener noreferrer">DOWNLOAD .MSI · 64-BIT</a>
      </div>
      <details className="desktop-downloads-legacy">
        <summary>Using 32-bit Windows?</summary>
        <p>Only choose these if Windows shows “32-bit operating system” in Settings → System → About.</p>
        <div aria-label="32-bit Windows installers">
          <a href={installers.x86Exe} target="_blank" rel="noopener noreferrer">Download .exe · 32-bit</a>
          <a href={installers.x86Msi} target="_blank" rel="noopener noreferrer">Download .msi · 32-bit</a>
        </div>
      </details>
    </div>
  )
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

export default function DesktopAppCard({ companion, showDownloads = false }) {
  const state = desktopState(companion)
  if (state === 'connected') {
    return (
      <div className="card desktop-app-card" data-state="connected">
        <span className="desktop-app-card-dot" aria-hidden="true" />
        <span className="mono desktop-app-card-label">DESKTOP APP CONNECTED</span>
        <DesktopTimestamps companion={companion} />
        {showDownloads && <DesktopDownloadActions />}
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
        {showDownloads && <DesktopDownloadActions />}
      </div>
    )
  }

  return (
    <div className="card desktop-app-card" data-state="available">
      <h3>SYNC WITHOUT THE TAB OPEN</h3>
      <p>The desktop app keeps your quests and position pings synced in the background. It is the recommended setup for Windows.</p>
      <ol>
        <li>Download either the .exe installer (simplest) or the .msi installer.</li>
        <li>Install it and sign in with the same account you use here.</li>
        <li>Choose your EFT folders once; the app handles future checks.</li>
      </ol>
      <DesktopDownloadActions />
    </div>
  )
}
