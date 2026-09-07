import { expect, test } from '@playwright/test'

const SUPABASE_ORIGIN = 'https://vggbwjboeryxddmxmcjn.supabase.co'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const PARTY_ID = '22222222-2222-4222-8222-222222222222'
const PARTY_CODE = 'ABC123'

function response(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function partySnapshot({ map = null } = {}) {
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
    members: [{
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

async function installAuthenticatedSupabaseMocks(page, { userQuests = [] } = {}) {
  const session = {
    access_token: 'local-playwright-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'local-playwright-refresh-token',
    user: {
      id: USER_ID,
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
    storageKey: 'sb-vggbwjboeryxddmxmcjn-auth-token',
    storedSession: session,
    mapsKey: 'tsp.cache.maps.regular',
    maps: [{ id: '56f40101d2720b2a4d8b45d6', name: 'Customs', normalizedName: 'customs' }],
  })

  let currentParty = null

  // Keep every non-preview request offline. The explicit Supabase handler below
  // is the only service this test exercises, and all responses are local data.
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL('http://127.0.0.1:4173').origin) return route.continue()
    return route.abort()
  })

  await page.route(`${SUPABASE_ORIGIN}/**`, route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()

    if (path === '/rest/v1/rpc/current_profile' && method === 'POST') {
      return response(route, { id: USER_ID, callsign: 'Ranger', is_admin: false })
    }
    if (path === '/rest/v1/user_settings' && method === 'GET') {
      return response(route, { settings: { welcome: { news_version: '2026.20' } } })
    }
    if (path === '/rest/v1/user_quests' && method === 'GET') return response(route, userQuests)
    if (path === '/rest/v1/friendships' && method === 'GET') return response(route, [])
    if (path === '/rest/v1/party_members' && method === 'GET') return response(route, [])

    if (path === '/rest/v1/rpc/create_party' && method === 'POST') {
      currentParty = partySnapshot()
      return response(route, currentParty)
    }
    if (path === '/rest/v1/rpc/select_map_party' && method === 'POST') {
      const body = request.postDataJSON()
      const map = {
        id: body.p_map_id,
        name: body.p_map_name,
        normalizedName: body.p_map_norm,
      }
      currentParty = partySnapshot({ map })
      return response(route, currentParty)
    }
    if (path === '/rest/v1/rpc/start_party_raid' && method === 'POST') {
      currentParty = {
        ...currentParty,
        raid_id: (currentParty?.raid_id || 0) + 1,
        progress: { __raid_start__: Date.now() },
      }
      return response(route, currentParty)
    }

    // Party entry starts a realtime subscription and may issue harmless repair
    // reads. Return the same local snapshot for those reads if they occur.
    if (path === '/rest/v1/parties' && method === 'GET') return response(route, currentParty)
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
