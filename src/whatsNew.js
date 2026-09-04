export const RELEASE_VERSION = '2026.18'

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

// The four kinds of line a release can carry, in the order the changelog filter
// offers them. Every item declares one, so the page can filter without guessing.
export const RELEASE_TAGS = ['NEW', 'IMPROVED', 'CHANGED', 'FIXED']

// The first release whose notes were written as the work shipped. Everything
// below it in RELEASES was reconstructed from the commit history afterwards and
// grouped by the week it landed; the changelog page says so rather than passing
// those entries off as contemporaneous.
export const FIRST_LIVE_NOTES_VERSION = '2026.09'

// Newest first — WelcomeModal shows RELEASES[0] and nothing else, so a new
// release goes on top of this array and RELEASE_VERSION moves with it.
export const RELEASES = [
  {
    version: '2026.18',
    date: '2026-09-04',
    title: 'BIGGER BUTTONS, QUIETER ICONS',
    items: [
      {
        tag: 'FIXED',
        title: 'EASIER TO HIT ON A PHONE',
        body: 'The footer links and the version headings on the changelog were small enough to miss on a touchscreen. Their tap area is taller now, and the text itself is unchanged.',
      },
      {
        tag: 'FIXED',
        title: 'THE MAP TOOLBAR READS CLEANLY ALOUD',
        body: 'Each map toolbar button carries a small icon before its label. A screen reader used to announce the icon as well as the name; it now reads just DRAW, QUEST MARKER, PMC SPAWNS and the rest.',
      },
    ],
  },
  {
    version: '2026.17',
    date: '2026-09-04',
    title: 'NO MORE SIDEWAYS SCROLLING',
    items: [
      {
        tag: 'FIXED',
        title: 'RELEASE HISTORY FITS THE SCREEN',
        body: 'On a narrow phone the release history header could push the whole page wider than the screen, forcing a sideways scroll just to read a release. The header now wraps like the rest of the page.',
      },
    ],
  },
  {
    version: '2026.16',
    date: '2026-09-02',
    title: 'PINGS WITHOUT THE WAIT',
    items: [
      {
        tag: 'IMPROVED',
        title: 'HERE PINGS LAND IMMEDIATELY',
        body: 'Your first position ping no longer waits for the double-tap window. A second or third screenshot upgrades that same marker to CONTACT or NEED HELP for the whole squad.',
      },
    ],
  },
  {
    version: '2026.15',
    date: '2026-09-02',
    title: 'FINDING YOURSELF ON THE MAP',
    items: [
      {
        tag: 'NEW',
        title: 'CENTRE ON ME',
        body: 'A button in the map header, and the C key, jump straight to your own last position. It works in PLAN as well as LIVE and whatever the camera is set to, so there is always one way to find yourself on the map.',
      },
      {
        tag: 'CHANGED',
        title: 'OVERVIEW NO LONGER RETIRES THE FOLLOW CAMERA',
        body: 'Pressing OVERVIEW still steps the camera back so it stops re-framing while you look around, but it no longer remembers that choice forever. FOLLOW comes back next time you open the map, and picking a camera mode yourself is still what sticks.',
      },
    ],
  },
  {
    version: '2026.14',
    date: '2026-08-31',
    title: 'QUEST MANAGER, REBUILT',
    items: [
      {
        tag: 'IMPROVED',
        title: 'YOUR QUESTS, GROUPED BY MAP',
        body: 'Quest Manager opens on map art and sorts your list into a card per map, biggest first. Each card carries its own quest count, kappa tally and collapse, so a twenty-quest list reads as five destinations instead of one long column.',
      },
      {
        tag: 'NEW',
        title: 'SEARCH AND FILTER WITHOUT SCROLLING',
        body: 'A bar pinned to the top searches your quests by name, trader or map, filters to one map, and narrows to Kappa-only. Import and sync moved into a side rail and a pop-up, so the list itself is what you land on.',
      },
      {
        tag: 'NEW',
        title: 'TICK SEVERAL, ACT ONCE',
        body: 'Select any number of quests and mark them done, skip, star or remove them in one go. Rows are roomier, show the trader’s portrait and your level gate, and drag by the handle to set the priority your party sees.',
      },
      {
        tag: 'NEW',
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
        tag: 'CHANGED',
        title: 'MAP TAB AND RAID VIEW ARE ONE PAGE',
        body: 'There is one MAP destination now. Out of raid it plans — spawns, routes, prep and squad readiness. The moment the leader starts a raid it becomes live, with pings, distances and raid time elapsed, without you moving anywhere.',
      },
      {
        tag: 'NEW',
        title: 'MY TASKS, TICKABLE MID-RAID',
        body: 'A personal objective list sits beside the map, grouped by quest and sorted by distance from your last ping. One tap ticks an objective and it saves immediately — no SUBMIT, and it never retires the quest off your squad’s list.',
      },
      {
        tag: 'NEW',
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
        tag: 'NEW',
        title: 'GUIDED QUEST IMPORT',
        body: 'GET YOUR QUESTS IN opens a guided import hub with a recommended route for your browser and situation.',
      },
      {
        tag: 'IMPROVED',
        title: 'STEP-BY-STEP LOG IMPORT',
        body: 'EFT log import now takes you through the required steps and says in plain words why it cannot continue.',
      },
      {
        tag: 'NEW',
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
        tag: 'NEW',
        title: 'SYNC STATUS IN THE HEADER',
        body: 'LOGS, PINGS and MONITOR chips sit in the room header and show what each local folder watcher is doing right now. Open one for the last check, the folder it is watching, and its controls.',
      },
      {
        tag: 'CHANGED',
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
        tag: 'IMPROVED',
        title: 'RESUMABLE LOG IMPORT',
        body: 'Large imports apply in batches behind a progress bar. Progress is saved after every batch, so you can leave the page and finish the import when you come back.',
      },
      {
        tag: 'IMPROVED',
        title: 'CLEARER IMPORT DIAGNOSTICS',
        body: 'Skipped records and unrecognized task IDs now name the file, line and reason instead of reporting a bare count.',
      },
      {
        tag: 'FIXED',
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
        tag: 'NEW',
        title: 'IMPORT EFT LOGS',
        body: 'Choose your EFT Logs folder to preview started, failed, and completed task events. Logs stay on this device; only bounded quest events are synchronized.',
      },
      {
        tag: 'NEW',
        title: 'GAME MODE PER CHARACTER',
        body: 'PVP, PVE and Season each keep their own quest list.',
      },
      {
        tag: 'NEW',
        title: 'QUEST SHAREABILITY',
        body: 'Shared objectives show whether a squadmate can push them for you. The verdict is derived from objective types, and every surface says so.',
      },
      {
        tag: 'NEW',
        title: 'QUEST IMPORT BY SCREENSHOT',
        body: 'Drop a screenshot of your quest list and it reads the names. Runs entirely in your browser.',
      },
      {
        tag: 'NEW',
        title: 'PING FOCUS',
        body: 'Click a ping to fly to it, and choose whether the map auto-follows ALL pings, ALERTS only, or nothing.',
      },
    ],
  },
  {
    version: '2026.08',
    date: '2026-08-10',
    title: 'ONE ACCOUNT, ONE IDENTITY',
    items: [
      {
        tag: 'CHANGED',
        title: 'PARTIES BELONG TO YOUR ACCOUNT',
        body: 'Membership, quest rows and progress are keyed to the signed-in account rather than to a callsign you typed. Knowing a party code is no longer the same thing as being in the party, and every read is scoped to the members of it.',
      },
      {
        tag: 'NEW',
        title: 'DRAW ON THE MAP WITH A FINGER',
        body: 'Freehand drawing works on touch screens, so a phone or a tablet can sketch a route for the squad instead of only reading one.',
      },
      {
        tag: 'NEW',
        title: 'TARKOV MONITOR SQUAD ECHO',
        body: 'The squad could follow your map changes and screenshot positions through a Tarkov Monitor relay. It was retired in 2026.11 in favour of local folder sync that does not depend on a third-party socket.',
      },
      {
        tag: 'IMPROVED',
        title: 'OBJECTIVES SCOPED TO WHERE THEY HAPPEN',
        body: 'The raid list stopped showing objectives belonging to other maps, and trader catch-up started ordering its picks by position in the quest chain rather than alphabetically.',
      },
      {
        tag: 'FIXED',
        title: 'SCREENSHOT PINGS STOPPED WIPING THEMSELVES',
        body: 'A new position ping no longer cleared the one before it, and the room kept showing the last known position instead of going blank between screenshots.',
      },
    ],
  },
  {
    version: '2026.07',
    date: '2026-08-08',
    title: 'WHEN TARKOV.DEV GOES DOWN',
    items: [
      {
        tag: 'FIXED',
        title: 'SURVIVES AN UPSTREAM OUTAGE',
        body: 'A failing tarkov.dev endpoint used to leave the app with no quests, items or maps at all. It now recovers on its own and falls back to the REST dataset while the outage lasts.',
      },
      {
        tag: 'IMPROVED',
        title: 'DATA BAKED IN AT BUILD TIME',
        body: 'Quest, item and map payloads ship with the site, so a cold start renders from a local floor instead of waiting on a third party before it can show you anything.',
      },
      {
        tag: 'NEW',
        title: 'IN-RAID VIEW, AND THE MAP GETS THE SPACE',
        body: 'A dedicated in-raid view strips the planning furniture out and gives the map the room it needs while you are actually in a raid.',
      },
      {
        tag: 'CHANGED',
        title: 'PINGS, MARKERS AND DRAWINGS EXPIRE',
        body: 'Everything drawn on a map now has a lifetime and clears itself, so a party that has been running for a week is not planning on top of last Tuesday.',
      },
      {
        tag: 'NEW',
        title: 'THE SCREENSHOT KEY, NAMED',
        body: 'The setup guidance says which key EFT binds screenshots to, and calls out the Windows 11 behaviour that silently swallows it.',
      },
    ],
  },
  {
    version: '2026.06',
    date: '2026-04-17',
    title: 'BOSSES, CLOCKS AND THE RAID BUTTON',
    items: [
      {
        tag: 'NEW',
        title: 'START A RAID TOGETHER',
        body: 'The leader starts a raid and the whole party drops into a shared raid view built around the map, instead of everyone deciding for themselves when the plan became a run.',
      },
      {
        tag: 'NEW',
        title: 'BOSS SPAWNS',
        body: 'Per-map boss cards with spawn chances and escorts, so the squad knows what else is on the map before it commits to a route.',
      },
      {
        tag: 'NEW',
        title: 'TARKOV CLOCKS',
        body: 'Both in-game clocks, live, so you can tell whether you are landing in daylight.',
      },
      {
        tag: 'NEW',
        title: 'QUEST MARKERS ON THE MAP',
        body: 'Objectives from your saved quests are drawn on the map itself, alongside the PMC spawns.',
      },
      {
        tag: 'IMPROVED',
        title: 'YOUR QUEST ORDER IS SAVED',
        body: 'The priority you drag your quests into survives the session, and required items drop off the list once you have found them.',
      },
    ],
  },
  {
    version: '2026.05',
    date: '2026-04-09',
    title: 'QUEST MANAGER',
    items: [
      {
        tag: 'CHANGED',
        title: 'MY QUESTS BECOMES QUEST MANAGER',
        body: 'The quest surface was rebuilt around two cards and a collapsible rail, and renamed for what it actually does. The old quest tab inside the party went away with it.',
      },
      {
        tag: 'NEW',
        title: 'SNAPSHOT AND RESTORE',
        body: 'A bulk change to your quest list can be undone, so clearing the wrong thing is a mistake you can walk back.',
      },
      {
        tag: 'NEW',
        title: 'RECOMMENDED MAPS',
        body: 'A segmented bar shows which map covers the most of your list, and quests several of you share are ranked up, so the squad picks the map that serves everyone.',
      },
      {
        tag: 'NEW',
        title: 'WIKI LINKS',
        body: 'Every quest links out to its wiki article.',
      },
      {
        tag: 'FIXED',
        title: 'COMPLETIONS REACH THE PARTY',
        body: 'Marking a quest done updated your saved list but not the party board. Completions, removals and rejoins now agree with each other.',
      },
    ],
  },
  {
    version: '2026.04',
    date: '2026-04-07',
    title: 'READING YOUR QUEST LIST OFF A SCREENSHOT',
    items: [
      {
        tag: 'NEW',
        title: 'QUEST LIST BY SCREENSHOT',
        body: 'Upload a screenshot of your in-game quest list and it reads the names off it, so first-time setup is not forty manual searches.',
      },
      {
        tag: 'NEW',
        title: 'DRAG TO PRIORITISE',
        body: 'Reorder your quests by dragging them, and the squad sees the order you meant.',
      },
      {
        tag: 'NEW',
        title: 'SKIP A QUEST WITHOUT DELETING IT',
        body: 'Skipped quests stay on your list but arrive in the party pre-skipped, for the ones you are carrying but not working on.',
      },
      {
        tag: 'NEW',
        title: 'OBJECTIVES TAB',
        body: 'The todo list gained a per-objective view, and became the tab the party lands on.',
      },
    ],
  },
  {
    version: '2026.03',
    date: '2026-04-04',
    title: 'SIGN IN, AND BRING FRIENDS',
    items: [
      {
        tag: 'NEW',
        title: 'GOOGLE SIGN-IN',
        body: 'One sign-in path, tied to your Google account, with a callsign you choose once.',
      },
      {
        tag: 'NEW',
        title: 'FRIENDS',
        body: 'Send and accept friend requests, then join a friend’s party without anyone reading a code out loud.',
      },
      {
        tag: 'CHANGED',
        title: 'PARTY CODES AND CALLSIGNS VALIDATED',
        body: 'Codes are harder to guess and callsigns are checked, so a party is not one lucky string away from a stranger.',
      },
      {
        tag: 'IMPROVED',
        title: 'IT WORKS ON A PHONE',
        body: 'The party room and the admin tools reflow for small screens, for the squadmate who is on their phone at work.',
      },
      {
        tag: 'NEW',
        title: 'KAPPA MARKERS AND LINK PREVIEWS',
        body: 'Kappa-required quests are flagged in both quest lists, and a shared link unfurls with artwork instead of a bare URL.',
      },
    ],
  },
  {
    version: '2026.02',
    date: '2026-04-02',
    title: 'KEYS AND REQUIRED ITEMS',
    items: [
      {
        tag: 'NEW',
        title: 'REQUIRED ITEMS',
        body: 'Everything your saved quests ask you to find or hand in, collected into one list instead of read off twelve quest pages.',
      },
      {
        tag: 'NEW',
        title: 'KEY REFERENCE',
        body: 'Which keys open what, filtered per map, with the keys your own quests need called out.',
      },
      {
        tag: 'NEW',
        title: 'COMPLETE, SKIP AND A COMPLETED SECTION',
        body: 'Quests you have finished move out of the working list rather than being deleted.',
      },
      {
        tag: 'NEW',
        title: 'JOIN LINKS',
        body: 'Send a dudgy.net/join/CODE link and the party opens on the other end.',
      },
      {
        tag: 'FIXED',
        title: 'QUESTS SURVIVE A MAP SWITCH',
        body: 'Changing the party map no longer dropped the quest list that came with it.',
      },
    ],
  },
  {
    version: '2026.01',
    date: '2026-03-31',
    title: 'FIRST RAID',
    items: [
      {
        tag: 'NEW',
        title: 'A SHARED BOARD FOR THE SQUAD',
        body: 'Create a party, hand out a six-character code, and everyone is looking at the same map, the same quest list and the same progress as it changes.',
      },
      {
        tag: 'NEW',
        title: 'REAL MAPS AND PMC SPAWNS',
        body: 'Actual map imagery for the featured maps, with PMC spawn locations marked on them.',
      },
      {
        tag: 'NEW',
        title: 'ACCOUNTS AND SAVED QUESTS',
        body: 'Your quest list is saved to your account and populates your row the moment you join a party, so you set it up once.',
      },
      {
        tag: 'NEW',
        title: 'TODO LIST WITH STARS',
        body: 'A shared todo list where the owner of a quest can star what matters, and ticks land for everyone in real time.',
      },
    ],
  },
]
