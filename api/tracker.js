const TRACKER_API = 'https://api.tarkovtracker.org'
const TRACKER_MODES = { PVP_: 'regular', PVE_: 'pve', SZN_: 'pvp-season' }

// Keep the server boundary independent from Vite's extensionless browser
// imports. This mirrors parseTrackerToken without retaining the raw token.
function parseServerToken(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'empty' }
  const token = raw.trim()
  if (/^tt_/i.test(token)) return { ok: false, reason: 'legacy' }
  for (const [prefix, mode] of Object.entries(TRACKER_MODES)) {
    if (token.startsWith(prefix) && new RegExp(`^${prefix}[0-9a-f]+$`, 'i').test(token)) {
      return { ok: true, mode }
    }
  }
  return { ok: false, reason: 'invalid' }
}

function json(res, status, body, headers = {}) {
  res.status(status)
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  return res.json(body)
}

function header(req, name) {
  const value = req.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

function serviceConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return url && key ? { url, key } : null
}

async function authenticate(req, config) {
  const authorization = header(req, 'authorization')
  if (typeof authorization !== 'string' || !/^Bearer\s+\S+$/i.test(authorization)) return null

  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.key,
      Authorization: authorization,
    },
  })
  if (!response.ok) return null
  const user = await response.json().catch(() => null)
  return typeof user?.id === 'string' && user.id ? user.id : null
}

function restHeaders(config, extra = {}) {
  return {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function loadIntegration(config, userId) {
  const query = `user_id=eq.${encodeURIComponent(userId)}&select=tracker_token,tracker_mode`
  const response = await fetch(`${config.url}/rest/v1/user_integrations?${query}`, {
    headers: restHeaders(config),
  })
  if (!response.ok) throw new Error('integration read failed')
  const rows = await response.json()
  return Array.isArray(rows) ? rows[0] || null : null
}

async function saveIntegration(config, userId, token, mode) {
  const now = new Date().toISOString()
  const response = await fetch(`${config.url}/rest/v1/user_integrations?on_conflict=user_id`, {
    method: 'POST',
    headers: restHeaders(config, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({
      user_id: userId,
      tracker_token: token,
      tracker_mode: mode,
      linked_at: now,
      updated_at: now,
    }),
  })
  if (!response.ok) throw new Error('integration write failed')
}

async function deleteIntegration(config, userId) {
  const query = `user_id=eq.${encodeURIComponent(userId)}`
  const response = await fetch(`${config.url}/rest/v1/user_integrations?${query}`, {
    method: 'DELETE',
    headers: restHeaders(config),
  })
  if (!response.ok) throw new Error('integration delete failed')
}

async function trackerProgress(token, ifNoneMatch) {
  const headers = { Authorization: `Bearer ${token}` }
  if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch
  return fetch(`${TRACKER_API}/progress`, { headers })
}

async function upstreamError(response) {
  const body = await response.json().catch(() => null)
  if (response.status === 401) {
    const upstreamMessage = typeof body?.error === 'string' ? body.error.toLowerCase() : ''
    if (upstreamMessage.includes('format')) {
      return { status: 401, body: { error: 'legacy', message: 'This token format is outdated. Reissue a token on TarkovTracker.' } }
    }
    return { status: 401, body: { error: 'invalid_token', message: 'TarkovTracker rejected this token. It may be revoked.' } }
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after')
    return {
      status: 429,
      body: {
        error: 'quota',
        retryAfter: retryAfter || null,
        message: retryAfter
          ? `TarkovTracker daily quota reached. Try again in ${retryAfter} seconds.`
          : 'TarkovTracker daily quota reached. Try again later.',
      },
    }
  }
  return { status: 502, body: { error: 'upstream', message: 'TarkovTracker is unavailable right now.' } }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return json(res, 405, { error: 'method_not_allowed', message: 'Use POST for tracker requests.' })
  }

  const config = serviceConfig()
  if (!config) return json(res, 500, { error: 'server_config', message: 'Tracker sync is not configured.' })

  let body
  try {
    body = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(req.body || '{}')
  } catch {
    return json(res, 400, { error: 'bad_request', message: 'Invalid JSON request.' })
  }

  let userId
  try {
    userId = await authenticate(req, config)
  } catch {
    return json(res, 401, { error: 'unauthorized', message: 'Sign in again to use tracker sync.' })
  }
  if (!userId) return json(res, 401, { error: 'unauthorized', message: 'Sign in again to use tracker sync.' })

  const action = body?.action
  if (action === 'link') {
    const parsed = parseServerToken(body?.token)
    if (!parsed.ok) {
      if (parsed.reason === 'legacy') {
        return json(res, 400, { error: 'legacy', message: 'This token format is outdated. Reissue a token on TarkovTracker.' })
      }
      return json(res, 400, { error: 'invalid_token', message: 'Enter a valid TarkovTracker token.' })
    }

    const token = body.token.trim()
    let upstream
    try {
      upstream = await trackerProgress(token)
    } catch {
      return json(res, 502, { error: 'upstream', message: 'TarkovTracker is unavailable right now.' })
    }
    if (!upstream.ok) {
      const failure = await upstreamError(upstream)
      return json(res, failure.status, failure.body)
    }

    const upstreamBody = await upstream.json().catch(() => null)
    if (!upstreamBody?.data || typeof upstreamBody.data !== 'object') {
      return json(res, 502, { error: 'upstream', message: 'TarkovTracker returned an unusable response.' })
    }
    try {
      await saveIntegration(config, userId, token, parsed.mode)
    } catch {
      return json(res, 500, { error: 'server_config', message: 'Could not save the tracker link.' })
    }
    return json(res, 200, {
      mode: parsed.mode,
      displayName: upstreamBody.data.displayName || null,
      playerLevel: Number.isFinite(Number(upstreamBody.data.playerLevel)) ? Number(upstreamBody.data.playerLevel) : null,
    })
  }

  if (action === 'progress') {
    let integration
    try {
      integration = await loadIntegration(config, userId)
    } catch {
      return json(res, 500, { error: 'server_config', message: 'Could not load the tracker link.' })
    }
    if (!integration?.tracker_token) return json(res, 404, { error: 'not_linked', message: 'No TarkovTracker account is linked.' })

    let upstream
    try {
      upstream = await trackerProgress(integration.tracker_token, header(req, 'if-none-match'))
    } catch {
      return json(res, 502, { error: 'upstream', message: 'TarkovTracker is unavailable right now.' })
    }
    if (upstream.status === 304) {
      const etag = upstream.headers.get('etag')
      if (etag) res.setHeader('ETag', etag)
      return res.status(304).end()
    }
    if (!upstream.ok) {
      const failure = await upstreamError(upstream)
      return json(res, failure.status, failure.body)
    }
    const upstreamBody = await upstream.json().catch(() => null)
    if (!upstreamBody || typeof upstreamBody !== 'object' || !upstreamBody.data || typeof upstreamBody.data !== 'object') {
      return json(res, 502, { error: 'upstream', message: 'TarkovTracker returned an unusable response.' })
    }
    const etag = upstream.headers.get('etag')
    if (etag) res.setHeader('ETag', etag)
    return json(res, 200, { ...upstreamBody, mode: integration.tracker_mode })
  }

  if (action === 'unlink') {
    try {
      await deleteIntegration(config, userId)
    } catch {
      return json(res, 500, { error: 'server_config', message: 'Could not unlink the tracker account.' })
    }
    return json(res, 200, { unlinked: true })
  }

  return json(res, 400, { error: 'bad_request', message: 'Unknown tracker action.' })
}
