export const RELEASE_VERSION = '2026.09'

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
  {
    title: 'OPTIONAL — LINK TARKOV MONITOR',
    body: 'Run TarkovMonitor next to the game and the squad map follows you into raid. The in-game screenshot key drops your position as a ping.',
  },
]

export const RELEASES = [
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
      {
        title: 'TARKOV MONITOR LINK',
        body: 'Automatic map switching and screenshot position pings.',
      },
    ],
  },
]
