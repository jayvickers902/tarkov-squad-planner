import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { loadEnv } from 'vite'
// Read from the app rather than pinned: a hardcoded version made every release
// fail six authenticated tests, because the unseen What is New modal then sat
// over the whole UI and swallowed every click.
import { RELEASE_VERSION } from '../src/whatsNew.js'

// Resolved exactly the way `vite build` resolved it for the bundle under test,
// rather than pinned. Pinned, these mocks only matched on a machine whose .env
// happened to name that project: CI builds with VITE_SUPABASE_URL pointing at
// smoke.invalid, so every authenticated request went to a host nothing routed,
// the app never signed in, and all six authenticated tests failed on their
// first assertion while passing locally.
const SUPABASE_ORIGIN = new URL(
  loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL || 'https://smoke.invalid',
).origin
// supabase-js derives its auth storage key from the project ref in that URL, so
// this has to follow the origin rather than name a project of its own: seeded
// against the wrong key the session is simply ignored and the app renders the
// sign-in screen.
const SUPABASE_AUTH_STORAGE_KEY = `sb-${new URL(SUPABASE_ORIGIN).hostname.split('.')[0]}-auth-token`
const USER_ID = '11111111-1111-4111-8111-111111111111'
const PARTY_ID = '22222222-2222-4222-8222-222222222222'
const PARTY_CODE = 'ABC123'
const MEMBER_ID = '33333333-3333-4333-8333-333333333333'
const REGULAR_LOG_FIXTURE = resolve(process.cwd(), 'src/test/fixtures/eft-logs/Logs/0.16.9.0-regular')

function response(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function partySnapshot({ map = null, members = null } = {}) {
  return {
    id: PARTY_ID,
    code: PARTY_CODE,
    map_id: map?.id ?? null,
    map_name: map?.name ?? null,
    map_norm: map?.normalizedName ?? null,
    spawn: null,
    progress: {},
    starred: {},
    drawings: [],
    markers: [],
    pings: [],
    ping_log: [],
    leader_id: USER_ID,
    raid_id: 0,
    settings: {},
    quest_order: {},
    game_mode: 'regular',
    active_session_id: null,
    members: members || [{
      user_id: USER_ID,
      callsign: 'Ranger',
      role: 'leader',
      quests: [],
      quests_all: [],
      joined_at: '2026-09-07T00:00:00.000Z',
      last_seen: '2026-09-07T00:00:00.000Z',
    }],
  }
}

function createLocalRealtimeBroker() {
  const connections = new Set()
  const topic = `realtime:party-${PARTY_ID}`
  let lastPartyDeliveryUserIds = []

  function sendReply(ws, joinRef, ref, channel, responseBody = {}) {
    ws.send(JSON.stringify([joinRef, ref, channel, 'phx_reply', { response: responseBody, status: 'ok' }]))
  }

  function attach(ws, userId) {
    const connection = { ws, userId, topics: new Set(), partyUpdatesPaused: false }
    connections.add(connection)
    ws.onMessage(message => {
      let frame
      try { frame = JSON.parse(String(message)) } catch { return }
      const [joinRef, ref, channel, event, payload] = frame
      if (event === 'phx_join') {
        connection.topics.add(channel)
        const filters = payload?.config?.postgres_changes || []
        const postgresChanges = filters.map((filter, index) => ({ ...filter, id: index + 1 }))
        sendReply(ws, joinRef, ref, channel, { postgres_changes: postgresChanges })
        return
      }
      if (event === 'heartbeat' || event === 'presence' || event === 'phx_leave') {
        sendReply(ws, joinRef, ref, channel)
      }
    })
    ws.onClose(() => connections.delete(connection))
  }

  function emitPartyUpdate(record) {
    lastPartyDeliveryUserIds = []
    const payload = {
      data: {
        schema: 'public',
        table: 'parties',
        commit_timestamp: new Date().toISOString(),
        type: 'UPDATE',
        columns: [],
        record,
        old_record: {},
      },
      ids: [1],
    }
    for (const connection of connections) {
      if (connection.topics.has(topic) && !connection.partyUpdatesPaused) {
        connection.ws.send(JSON.stringify([null, null, topic, 'postgres_changes', payload]))
        lastPartyDeliveryUserIds.push(connection.userId)
      }
    }
  }

  async function waitForPartySubscribers(count, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const subscribers = [...connections].filter(connection => connection.topics.has(topic)).length
      if (subscribers >= count) return
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error(`Timed out waiting for ${count} local Realtime party subscribers`)
  }

  async function disconnectPartySubscriber(userId) {
    const connection = [...connections].find(connection => connection.userId === userId && connection.topics.has(topic))
    if (!connection) throw new Error(`No local Realtime party subscriber for ${userId}`)
    connection.partyUpdatesPaused = true
    await connection.ws.close({ code: 1001, reason: 'simulated network interruption' })
  }

  function resumePartyDelivery(userId) {
    for (const connection of connections) {
      if (connection.userId === userId) connection.partyUpdatesPaused = false
    }
  }

  return {
    attach,
    disconnectPartySubscriber,
    emitPartyUpdate,
    getLastPartyDeliveryUserIds: () => [...lastPartyDeliveryUserIds],
    resumePartyDelivery,
    waitForPartySubscribers,
  }
}

function createLocalPartyFixture() {
  return { currentParty: null, realtime: createLocalRealtimeBroker() }
}

async function installAuthenticatedSupabaseMocks(page, { userQuests = [], userId = USER_ID, callsign = 'Ranger', backend = createLocalPartyFixture() } = {}) {
  const session = {
    access_token: 'local-playwright-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'local-playwright-refresh-token',
    user: {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'playwright@example.test',
    },
  }

  await page.addInitScript(({ storageKey, storedSession, mapsKey, maps }) => {
    localStorage.setItem(storageKey, JSON.stringify(storedSession))
    // Seed only the tiny map catalog needed by this critical path. The app's
    // normal prebaked/live loaders remain out of scope for this service test.
    localStorage.setItem(mapsKey, JSON.stringify({ v: 1, savedAt: Date.now(), data: maps }))
  }, {
    storageKey: SUPABASE_AUTH_STORAGE_KEY,
    storedSession: session,
    mapsKey: 'tsp.cache.maps.regular',
    maps: [{ id: '56f40101d2720b2a4d8b45d6', name: 'Customs', normalizedName: 'customs' }],
  })

  // Keep every non-preview request offline. The explicit Supabase handler below
  // is the only service this test exercises, and all responses are local data.
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL('http://127.0.0.1:4173').origin) return route.continue()
    return route.abort()
  })

  await page.context().routeWebSocket(
    `${SUPABASE_ORIGIN.replace('https://', 'wss://')}/realtime/v1/websocket**`,
    ws => backend.realtime.attach(ws, userId),
  )

  await page.route(`${SUPABASE_ORIGIN}/**`, route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()

    if (path === '/rest/v1/rpc/current_profile' && method === 'POST') {
      return response(route, { id: userId, callsign, is_admin: false })
    }
    if (path === '/rest/v1/user_settings' && method === 'GET') {
      return response(route, { settings: { welcome: { news_version: RELEASE_VERSION } } })
    }
    if (path === '/rest/v1/user_quests' && method === 'GET') return response(route, userQuests)
    if (path === '/rest/v1/friendships' && method === 'GET') return response(route, [])
    if (path === '/rest/v1/party_members' && method === 'GET') return response(route, [])

    if (path === '/rest/v1/rpc/create_party' && method === 'POST') {
      backend.currentParty = partySnapshot()
      return response(route, backend.currentParty)
    }
    if (path === '/rest/v1/rpc/select_map_party' && method === 'POST') {
      const body = request.postDataJSON()
      const map = {
        id: body.p_map_id,
        name: body.p_map_name,
        normalizedName: body.p_map_norm,
      }
      backend.currentParty = partySnapshot({ map, members: backend.currentParty?.members })
      backend.realtime.emitPartyUpdate(backend.currentParty)
      return response(route, backend.currentParty)
    }
    if (path === '/rest/v1/rpc/join_party_secure' && method === 'POST') {
      const members = backend.currentParty?.members || []
      if (!members.some(member => member.user_id === userId)) {
        members.push({
          user_id: userId,
          callsign,
          role: 'member',
          quests: [],
          quests_all: [],
          joined_at: '2026-09-07T00:01:00.000Z',
          last_seen: '2026-09-07T00:01:00.000Z',
        })
      }
      backend.currentParty = { ...backend.currentParty, members }
      return response(route, backend.currentParty)
    }
    if (path === '/rest/v1/rpc/start_party_raid' && method === 'POST') {
      backend.currentParty = {
        ...backend.currentParty,
        raid_id: (backend.currentParty?.raid_id || 0) + 1,
        progress: { __raid_start__: Date.now() },
      }
      backend.realtime.emitPartyUpdate(backend.currentParty)
      return response(route, backend.currentParty)
    }
    if (path === '/rest/v1/rpc/reconcile_user_quest_log_events' && method === 'POST') {
      const events = request.postDataJSON()?.p_events
      const affectedTaskIds = Array.isArray(events)
        ? [...new Set(events.map(event => event?.task_id).filter(Boolean))]
        : []
      return response(route, {
        inserted: affectedTaskIds.length,
        updated: 0,
        ignored: 0,
        affected_task_ids: affectedTaskIds,
      })
    }

    // Party entry starts a realtime subscription and may issue harmless repair
    // reads. Return the same local snapshot for those reads if they occur.
    if (path === '/rest/v1/parties' && method === 'GET') return response(route, backend.currentParty)
    if (path === '/rest/v1/party_members' && method !== 'GET') return response(route, [])
    if (path === '/rest/v1/user_settings' && method !== 'GET') return response(route, {})
    return response(route, [])
  })
}

test('authenticated operator creates a party and selects a raid map with local service fixtures', async ({ page }) => {
  await installAuthenticatedSupabaseMocks(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'READY UP, RANGER' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'CREATE PARTY' })).toBeEnabled()

  await page.getByRole('button', { name: 'CREATE PARTY' }).click()
  await expect(page.getByRole('heading', { name: 'NO MAP SELECTED' })).toBeVisible()
  await expect(page.locator('.room-banner-code')).toHaveText(PARTY_CODE)

  const customs = page.getByRole('button', { name: 'CUSTOMS' })
  await expect(customs).toBeVisible()
  await customs.click()

  await expect(page.getByRole('heading', { name: 'CUSTOMS' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'TODO LIST' })).toBeVisible()
  await expect(page.getByText('SELECT MAP FOR THIS RAID')).toBeVisible()
})

test('leader reviews the raid brief and enters the live raid map with local service fixtures', async ({ page }) => {
  await installAuthenticatedSupabaseMocks(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'READY UP, RANGER' })).toBeVisible()
  await page.getByRole('button', { name: 'CREATE PARTY' }).click()
  await page.getByRole('button', { name: 'CUSTOMS' }).click()
  await expect(page.getByRole('heading', { name: 'CUSTOMS' })).toBeVisible()

  await page.getByRole('button', { name: /START RAID/ }).click()
  const brief = page.locator('[role="dialog"][aria-labelledby="sr-title"]')
  await expect(brief).toBeVisible()
  await expect(brief.getByRole('heading', { name: 'QUEST ITEMS TO BRING' })).toBeVisible()
  await expect(brief.getByText('NOTHING TO CARRY IN FOR THIS MAP')).toBeVisible()

  await brief.getByRole('button', { name: "OK — LET'S GO" }).click()
  await expect(page).toHaveURL(/\/party\/ABC123\/raid$/)
  await expect(page.getByRole('button', { name: 'CENTRE ON ME' })).toBeVisible()
})

test('authenticated operator opens Quest Manager and stars a seeded quest locally', async ({ page }) => {
  const quest = {
    user_id: USER_ID,
    game_mode: 'regular',
    quest_id: '5c0d4d1f0000000000000001',
    quest_name: 'Debut',
    map_norm: 'customs',
    important: false,
    skipped: false,
    state: 'active',
    created_at: '2026-09-07T00:00:00.000Z',
  }
  await installAuthenticatedSupabaseMocks(page, { userQuests: [quest] })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'READY UP, RANGER' })).toBeVisible()
  await page.locator('button.lobby-secondary-gold').click()

  await expect(page).toHaveURL(/\/quests$/)
  await expect(page.getByRole('heading', { name: 'QUEST MANAGER' })).toBeVisible()
  await expect(page.getByText('Debut', { exact: true })).toBeVisible()

  const star = page.getByRole('button', { name: 'Mark Debut as important' })
  await expect(star).toHaveAttribute('aria-pressed', 'false')
  await star.click()
  await expect(page.getByRole('button', { name: 'Remove important from Debut' })).toHaveAttribute('aria-pressed', 'true')
})

test('authenticated operator previews and confirms a local EFT log import', async ({ page }) => {
  await installAuthenticatedSupabaseMocks(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'READY UP, RANGER' })).toBeVisible()
  await page.locator('button.lobby-secondary-gold').click()
  await expect(page).toHaveURL(/\/quests$/)

  await page.getByRole('button', { name: 'GET YOUR QUESTS IN' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Quest import' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /Import or sync EFT logs/ }).click()
  await expect(dialog.getByRole('button', { name: 'IMPORT LOG FOLDER ONCE' })).toBeVisible()

  // Use the checked-in regular fixture through the real directory picker. The
  // route aborts every external request, so this proves the worker/parser path
  // and the review decision without a live catalog or uploaded log text.
  await dialog.locator('input[webkitdirectory]').setInputFiles(REGULAR_LOG_FIXTURE)
  await expect(dialog.getByText('3/3 FILES')).toBeVisible()
  await expect(dialog.getByText('2 STATE CHANGES')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'CONFIRM IMPORT' })).toBeEnabled()

  await dialog.getByRole('button', { name: 'CONFIRM IMPORT' }).click()
  await expect(dialog.getByText('APPLIED 2 QUEST STATES.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'VIEW MY QUESTS' })).toBeVisible()
})

test('party member converges on a leader map change through the local Realtime subscription', async ({ browser }) => {
  const backend = createLocalPartyFixture()
  const leaderContext = await browser.newContext()
  const memberContext = await browser.newContext()
  const leaderPage = await leaderContext.newPage()
  const memberPage = await memberContext.newPage()

  try {
    await installAuthenticatedSupabaseMocks(leaderPage, { backend })
    await installAuthenticatedSupabaseMocks(memberPage, { backend, userId: MEMBER_ID, callsign: 'Scout' })

    await leaderPage.goto('/')
    await expect(leaderPage.getByRole('heading', { name: 'READY UP, RANGER' })).toBeVisible()
    await leaderPage.getByRole('button', { name: 'CREATE PARTY' }).click()
    await expect(leaderPage.getByRole('heading', { name: 'NO MAP SELECTED' })).toBeVisible()

    await memberPage.goto('/')
    await expect(memberPage.getByRole('heading', { name: 'READY UP, SCOUT' })).toBeVisible()
    await memberPage.locator('#party-code').fill(PARTY_CODE)
    await memberPage.getByRole('button', { name: 'JOIN' }).click()
    await expect(memberPage.getByRole('heading', { name: 'NO MAP SELECTED' })).toBeVisible()

    // This waits for both real supabase.channel(...).subscribe() calls to
    // complete their mocked Phoenix joins before the leader emits a row update.
    await backend.realtime.waitForPartySubscribers(2)

    await leaderPage.getByRole('button', { name: 'CUSTOMS' }).click()
    await expect(leaderPage.getByRole('heading', { name: 'CUSTOMS' })).toBeVisible()
    await expect(memberPage.getByRole('heading', { name: 'CUSTOMS' })).toBeVisible()
    await expect(memberPage.locator('.room-banner-code')).toHaveText(PARTY_CODE)
  } finally {
    await Promise.all([leaderContext.close(), memberContext.close()])
  }
})

test('disconnected party member repairs a missed map update through the visibility recovery path', async ({ browser }) => {
  const backend = createLocalPartyFixture()
  const leaderContext = await browser.newContext()
  const memberContext = await browser.newContext()
  const leaderPage = await leaderContext.newPage()
  const memberPage = await memberContext.newPage()

  try {
    await installAuthenticatedSupabaseMocks(leaderPage, { backend })
    await installAuthenticatedSupabaseMocks(memberPage, { backend, userId: MEMBER_ID, callsign: 'Scout' })

    await leaderPage.goto('/')
    await expect(leaderPage.getByRole('button', { name: 'CREATE PARTY' })).toBeVisible()
    await leaderPage.getByRole('button', { name: 'CREATE PARTY' }).click()
    await expect(leaderPage.getByRole('heading', { name: 'NO MAP SELECTED' })).toBeVisible()

    await memberPage.goto('/')
    await memberPage.locator('#party-code').fill(PARTY_CODE)
    await memberPage.getByRole('button', { name: 'JOIN' }).click()
    await expect(memberPage.getByRole('heading', { name: 'NO MAP SELECTED' })).toBeVisible()
    await backend.realtime.waitForPartySubscribers(2)

    // Close only the member's real Realtime transport and drop the next row
    // event. The member must remain stale until the app's recovery read runs.
    await backend.realtime.disconnectPartySubscriber(MEMBER_ID)
    await leaderPage.getByRole('button', { name: 'CUSTOMS' }).click()
    await expect(leaderPage.getByRole('heading', { name: 'CUSTOMS' })).toBeVisible()
    expect(backend.realtime.getLastPartyDeliveryUserIds()).toEqual([USER_ID])
    await expect(memberPage.getByRole('heading', { name: 'NO MAP SELECTED' })).toBeVisible()

    // visibilitychange is the app's documented reconnect/visibility repair
    // path; it calls fetchPartyById and converges from the shared HTTP snapshot.
    await memberPage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(memberPage.getByRole('heading', { name: 'CUSTOMS' })).toBeVisible()
  } finally {
    backend.realtime.resumePartyDelivery(MEMBER_ID)
    await Promise.all([leaderContext.close(), memberContext.close()])
  }
})
