export const RELEASE_VERSION = '2026.12'

export const SETUP_STEPS = [
  {
    title: 'LOAD YOUR QUESTS',
    body: 'Quest Manager holds your active task list. Import your EFT Logs folder locally, drop in a screenshot of your in-game quest list, or search and add tasks by hand.',
  },
  {
    title: 'PICK YOUR GAME MODE',
    body: 'PVP, PVE and Season each keep a separate quest list, because they are separate characters. A party fixes its mode when it is created.',
  },
  {
    title: 'CREATE OR JOIN A PARTY',
    body: 'Share the six-character code, or send a dudgy.net/join/CODE link. Add squadmates as friends and rejoining is one click.',
  },
  {
    title: 'PICK THE MAP AND PLAN',
    body: 'The party map drives every tab: TODO LIST, REQUIRED ITEMS, WHAT TO LOOK FOR, MAP / ROUTE, BOSS SPAWNS / KEYS. Draw routes and drop markers; the squad sees them live.',
  },
  {
    title: 'GO INTO RAID',
    body: 'START RAID gives the pre-raid brief: boss odds, extracts, keys, in-game time. Raid View is the in-raid layout with the objective rail and live squad pings.',
  },
]

export const RELEASES = [
  {
    version: '2026.12',
    date: '2026-08-27',
    title: 'ONE SWITCH, HONESTLY LABELLED',
    items: [
      {
        title: 'AUTO-APPLY IS NOW ITS OWN SWITCH',
        body: 'The KEEP CHECKING checkbox controlled more than it said: with it ticked, quest states were written from your logs without a preview. That setting is now an AUTO-APPLY switch on the connected folder itself, and it says what it does. If you had the old checkbox on, nothing changed except that you can now see it and turn it off.',
      },
      {
        title: 'CONNECTING A LOGS FOLDER IS ONE BUTTON',
        body: 'CONNECT LOGS FOLDER remembers the folder and can keep it in sync. One-time imports moved to a link beside it, so the option that can never sync no longer looks like the one that can. CONFIRM & KEEP IN SYNC sits next to the changes it authorises.',
      },
      {
        title: 'LOG AND SCREENSHOT SYNC LOOK ALIKE',
        body: 'Both local folder watchers now use the same strip: a status dot, the state in one word, and only the controls that state allows. A connected logs folder shows whether it is syncing without opening anything.',
      },
    ],
  },
  {
    version: '2026.11',
    date: '2026-08-27',
    title: 'SYNC YOU CAN SEE',
    items: [
      {
        title: 'SYNC STATUS IN THE HEADER',
        body: 'LOGS, PINGS and MONITOR chips sit in the room header and show what each local folder watcher is doing right now. Open one for the last check, the folder it is watching, and its controls.',
      },
      {
        title: 'TARKOV MONITOR LINK REMOVED',
        body: 'The companion-app relay is gone. Map switching and screenshot position pings are read from your own EFT folders in the browser, so nothing depends on a third-party socket staying up.',
      },
    ],
  },
  {
    version: '2026.10',
    date: '2026-08-26',
    title: 'IMPORTS THAT SURVIVE',
    items: [
      {
        title: 'RESUMABLE LOG IMPORT',
        body: 'Large imports apply in batches behind a progress bar. Progress is saved after every batch, so you can leave the page and finish the import when you come back.',
      },
      {
        title: 'CLEARER IMPORT DIAGNOSTICS',
        body: 'Skipped records and unrecognized task IDs now name the file, line and reason instead of reporting a bare count.',
      },
      {
        title: 'STEADIER CONNECTION',
        body: 'Party polling and heartbeats back off when the server is struggling instead of hammering it, then recover on their own.',
      },
    ],
  },
  {
    version: '2026.09',
    date: '2026-08-25',
    title: 'EFT LOG IMPORT',
    items: [
      {
        title: 'IMPORT EFT LOGS',
        body: 'Choose your EFT Logs folder to preview started, failed, and completed task events. Logs stay on this device; only bounded quest events are synchronized.',
      },
      {
        title: 'GAME MODE PER CHARACTER',
        body: 'PVP, PVE and Season each keep their own quest list.',
      },
      {
        title: 'QUEST SHAREABILITY',
        body: 'Shared objectives show whether a squadmate can push them for you. The verdict is derived from objective types, and every surface says so.',
      },
      {
        title: 'QUEST IMPORT BY SCREENSHOT',
        body: 'Drop a screenshot of your quest list and it reads the names. Runs entirely in your browser.',
      },
      {
        title: 'PING FOCUS',
        body: 'Click a ping to fly to it, and choose whether the map auto-follows ALL pings, ALERTS only, or nothing.',
      },
    ],
  },
]
