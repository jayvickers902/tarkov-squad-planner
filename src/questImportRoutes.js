export const IMPORT_ROUTES = [
  {
    key: 'logs',
    title: 'Import or sync EFT logs',
    recommended: true,
    blurb: 'Use your Tarkov logs for the most complete quest history, including started, failed and completed tasks.',
    bestWhen: 'Connect a folder to sync in this tab, or choose files for a one-time import.',
    requiresChromium: true,
  },
  {
    key: 'screenshot',
    title: 'Import from a screenshot',
    recommended: false,
    blurb: 'Reads a screenshot of your in-game quest list. Runs entirely in your browser.',
    bestWhen: 'Best on a phone, or if log import is unavailable.',
    requiresChromium: false,
  },
  {
    key: 'catchup',
    title: 'Rebuild progress by trader',
    recommended: false,
    blurb: 'Pick the last task you finished for each trader and it infers everything before it.',
    bestWhen: 'Best if you know roughly where you are.',
    requiresChromium: false,
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
  gameMode,
  logsSupported = false,
  persistentSupported = false,
  desktopConnected = false,
  desktopFresh = false,
  mobileLikely = false,
} = {}) {
  if (gameMode === 'pvp-season') {
    return { key: 'screenshot', reason: 'Seasonal quest logs are not supported yet. Import a screenshot instead.' }
  }
  if (mobileLikely) {
    return { key: 'screenshot', reason: 'A screenshot is the simplest import on this device.' }
  }
  if (!logsSupported) {
    return { key: 'screenshot', reason: 'Log import needs Chrome or Edge on desktop.' }
  }
  return {
    key: 'logs',
    reason: desktopConnected && desktopFresh
      ? 'Desktop log sync is already connected. Use this for an immediate one-time check or a browser fallback.'
      : persistentSupported
        ? 'Connect your logs folder to keep quests synced while this tab is open.'
        : 'Import your logs once from this PC.',
  }
}
