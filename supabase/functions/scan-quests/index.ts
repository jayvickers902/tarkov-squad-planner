import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RATE_LIMIT        = 100  // max scans per user per hour
const ADMIN_USER_ID     = 'ce64151c-c10b-45c4-9baa-9fbf794a5945'
const CLAUDE_API   = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PROMPT = `This is a screenshot from the PC game Escape from Tarkov showing a quest/task list. Each row contains: a trader portrait on the left, the quest name in the middle, a map name (like "Woods", "Customs", "Shoreline", etc.), a status label (like "active!"), and a progress percentage on the right.

Extract each quest's name and its map. Return a JSON array of objects with "name" and "map" fields.

Map rules:
- Use the exact map name shown (e.g. "Woods", "Customs", "Interchange", "Shoreline", "Factory", "Lighthouse", "Streets of Tarkov", "Reserve", "Ground Zero", "The Lab")
- If the map shown is "Any location", "Any map", or blank, use null for the map field.

Example output: [{"name":"Health Care Privacy - Part 3","map":"Woods"},{"name":"Shootout Picnic","map":"Woods"},{"name":"Debut","map":null}]

Return ONLY the JSON array. No explanation, no markdown.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS })
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) {
    return json({ error: 'Unauthorized' }, 401)
  }

  // ── Rate limit ────────────────────────────────────────────────────────────
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error: countErr } = await supabase
    .from('quest_scan_log')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', hourAgo)

  if (countErr) {
    return json({ error: 'Failed to check rate limit' }, 500)
  }

  if (user.id !== ADMIN_USER_ID && (count ?? 0) >= RATE_LIMIT) {
    return json({ error: `Rate limit reached — max ${RATE_LIMIT} scans per hour.` }, 429)
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let image: string, mediaType: string
  try {
    const body = await req.json()
    image     = body.image
    mediaType = body.mediaType || 'image/jpeg'
    if (!image) throw new Error('missing image')
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  // ── Log scan before calling Claude (counts even if Claude fails) ──────────
  const { error: logErr } = await supabase
    .from('quest_scan_log')
    .insert({ user_id: user.id })

  if (logErr) {
    return json({ error: 'Failed to log scan' }, 500)
  }

  // ── Call Claude ───────────────────────────────────────────────────────────
  const claudeRes = await fetch(CLAUDE_API, {
    method:  'POST',
    headers: {
      'x-api-key':         Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: 400,
      messages: [{
        role:    'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: mediaType, data: image },
          },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  })

  if (!claudeRes.ok) {
    const err = await claudeRes.text()
    console.error('Claude error:', err)
    return json({ error: 'Vision API error' }, 502)
  }

  const claudeData = await claudeRes.json()
  const rawText    = claudeData.content?.[0]?.text?.trim() ?? '[]'

  type QuestEntry = { name: string; map: string | null }
  let quests: QuestEntry[] = []
  try {
    const parsed = JSON.parse(rawText)
    if (Array.isArray(parsed)) quests = parsed
  } catch {
    const match = rawText.match(/\[[\s\S]*\]/)
    if (match) {
      try { quests = JSON.parse(match[0]) } catch { quests = [] }
    }
  }

  // Remaining scans this hour
  const remaining = RATE_LIMIT - ((count ?? 0) + 1)

  return json({ quests, remaining })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
