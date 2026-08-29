export const IMPORT_ROUTES = [
  {
    key: 'desktop',
    title: 'Use the desktop app',
    recommended: true,
    blurb: 'Keep quests and position pings synced automatically, even when this browser tab is closed.',
    bestWhen: 'Best for most Windows players. Install once, sign in, and let it run in the background.',
    requiresChromium: false,
  },
  {
    key: 'logs',
    title: 'Import or sync EFT logs',
    recommended: false,
    blurb: 'Use your Tarkov logs for the most complete quest history, including started, failed and completed tasks.',
    bestWhen: 'Connect a folder to sync in this tab, or choose files for a one-time import.',
    requiresChromium: true,
  },
  {
    key: 'manual',
    title: 'Add manually',
    recommended: false,
    blurb: 'Search the task list and add quests one at a time.',
    bestWhen: 'Best for topping up a list you already have.',
    requiresChromium: false,
  },
]

export function recommendedRoute({
  desktopConnected = false,
} = {}) {
  return {
    key: 'desktop',
    reason: desktopConnected
      ? 'Already connected — open the app whenever you want to review its folders or sync status.'
      : 'Recommended: it keeps working in the background after you close this tab.',
  }
}
