export const RELEASE_VERSION = '2026.14'

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
    version: '2026.14',
    date: '2026-08-31',
    title: 'QUEST MANAGER, REBUILT',
    items: [
      {
        title: 'YOUR QUESTS, GROUPED BY MAP',
        body: 'Quest Manager opens on map art and sorts your list into a card per map, biggest first. Each card carries its own quest count, kappa tally and collapse, so a twenty-quest list reads as five destinations instead of one long column.',
      },
      {
        title: 'SEARCH AND FILTER WITHOUT SCROLLING',
        body: 'A bar pinned to the top searches your quests by name, trader or map, filters to one map, and narrows to Kappa-only. Import and sync moved into a side rail and a pop-up, so the list itself is what you land on.',
      },
      {
        title: 'TICK SEVERAL, ACT ONCE',
        body: 'Select any number of quests and mark them done, skip, star or remove them in one go. Rows are roomier, show the trader’s portrait and your level gate, and drag by the handle to set the priority your party sees.',
      },
      {
        title: 'COMPLETED AND FAILED QUESTS',
        body: 'A history section lists what you have handed in and what you failed on this character, with the date and the trader. Anything in there can be put back on your active list in one click.',
      },
    ],
  },
  {
    version: '2026.13',
    date: '2026-08-29',
    title: 'ONE MAP, TWO STATES',
    items: [
      {
        title: 'MAP TAB AND RAID VIEW ARE ONE PAGE',
        body: 'There is one MAP destination now. Out of raid it plans — spawns, routes, prep and squad readiness. The moment the leader starts a raid it becomes live, with pings, distances and raid time elapsed, without you moving anywhere.',
      },
      {
        title: 'MY TASKS, TICKABLE MID-RAID',
        body: 'A personal objective list sits beside the map, grouped by quest and sorted by distance from your last ping. One tap ticks an objective and it saves immediately — no SUBMIT, and it never retires the quest off your squad’s list.',
      },
      {
        title: 'FOLLOW CAMERA',
        body: 'The camera can hold your squad in frame instead of jumping to each new ping. FOLLOW keeps everyone within 250 m of you on screen, zooms to fit, and gets out of the way for six seconds whenever you pan.',
      },
    ],
  },
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
