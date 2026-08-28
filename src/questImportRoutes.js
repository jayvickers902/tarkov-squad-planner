export const IMPORT_ROUTES = [
  {
    key: 'logs',
    title: 'Import EFT logs',
    recommended: true,
    blurb: 'Reads your Tarkov Logs folder in this browser. Most complete — picks up started, failed and completed tasks.',
    bestWhen: 'Best if you have played on this PC.',
    requiresChromium: true,
  },
  {
    key: 'screenshot',
    title: 'Scan a screenshot',
    recommended: false,
    blurb: 'Reads a screenshot of your in-game quest list. Runs entirely in your browser.',
    bestWhen: 'Best on a phone, or if log import is unavailable.',
    requiresChromium: false,
  },
  {
    key: 'catchup',
    title: 'Catch up by trader',
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

export function recommendedRoute({ logsSupported } = {}) {
  return logsSupported
    ? { key: 'logs', reason: '' }
    : { key: 'screenshot', reason: 'Log import needs Chrome or Edge on desktop.' }
}
