export const RELEASE_VERSION = '2026.12'

export const SETUP_STEPS = [
  {
    title: 'CHOOSE YOUR CHARACTER MODE',
    body: 'PVP, PVE and Season each keep a separate quest list because they are separate characters. Choose the character you are setting up before importing.',
  },
  {
    title: 'LOAD YOUR QUESTS',
    body: 'Quest Manager recommends the best available route: background desktop sync, a one-time local log import, a screenshot, trader catch-up, or manual search.',
  },
  {
    title: 'CREATE OR JOIN A PARTY',
    body: 'Share the six-character code, or send a dudgy.net/join/CODE link. Add squadmates as friends and rejoining is one click.',
  },
]

export const RELEASES = [
  {
    version: '2026.12',
    date: '2026-08-27',
    title: 'GETTING STARTED, GUIDED',
    items: [
      {
        title: 'GUIDED QUEST IMPORT',
        body: 'GET YOUR QUESTS IN opens a guided import hub with a recommended route for your browser and situation.',
      },
      {
        title: 'STEP-BY-STEP LOG IMPORT',
        body: 'EFT log import now takes you through the required steps and says in plain words why it cannot continue.',
      },
      {
        title: 'DESKTOP APP DISCOVERY',
        body: 'A new desktop app card explains how to keep quests and screenshot pings in sync in the background.',
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
