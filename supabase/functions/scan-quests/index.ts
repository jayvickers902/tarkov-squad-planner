import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RATE_LIMIT  = 100  // max scans per user per hour
const CLAUDE_API  = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    quests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          map: { type: ['string', 'null'] },
        },
        required: ['name', 'map'],
        additionalProperties: false,
      },
    },
  },
  required: ['quests'],
  additionalProperties: false,
}

const PROMPT = `This is a screenshot from the PC game Escape from Tarkov showing a quest/task list. Each row contains: a trader portrait on the left, the quest name in the middle, a map name (like "Woods", "Customs", "Shoreline", etc.), a status label (like "active!"), and a progress percentage on the right.

Extract each quest's name and its map.

Map rules:
- Use the exact map name shown (e.g. "Woods", "Customs", "Interchange", "Shoreline", "Factory", "Lighthouse", "Streets of Tarkov", "Reserve", "Ground Zero", "The Lab")
- If the map shown is "Any location", "Any map", or blank, use null for the map field.`

type QuestEntry = { name: string; map: string | null }
type TextBlock = { type?: string; text?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return json(null, 204, req)
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'Unauthorized' }, 401, req)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) {
    return json({ error: 'Unauthorized' }, 401, req)
  }

  // ── Rate limit ────────────────────────────────────────────────────────────
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error: countErr } = await supabase
    .from('quest_scan_log')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', hourAgo)

  if (countErr) {
    return json({ error: 'Failed to check rate limit' }, 500, req)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.is_admin && (count ?? 0) >= RATE_LIMIT) {
    return json({ error: `Rate limit reached — max ${RATE_LIMIT} scans per hour.` }, 429, req)
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let image: string, mediaType: string
  try {
    const body = await req.json()
    image = body.image
    mediaType = body.mediaType || 'image/jpeg'
    if (!image) throw new Error('missing image')
  } catch {
    return json({ error: 'Invalid request body' }, 400, req)
  }

  // ── Log scan before calling Claude (counts unless our upstream call fails) ─
  const { data: scanLog, error: logErr } = await supabase
    .from('quest_scan_log')
    .insert({ user_id: user.id })
    .select('id')
    .single()

  if (logErr || !scanLog?.id) {
    return json({ error: 'Failed to log scan' }, 500, req)
  }

  // ── Call Claude ───────────────────────────────────────────────────────────
  let claudeRes: Response
  try {
    claudeRes = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2000,
        output_config: {
          format: {
            type: 'json_schema',
            schema: OUTPUT_SCHEMA,
          },
        },
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: image },
            },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    })
  } catch (error) {
    await refundScan(supabase, scanLog.id)
    console.error('Claude request failed:', error)
    return json({ error: 'Vision API unavailable' }, 502, req)
  }

  if (!claudeRes.ok) {
    let errorText = ''
    try {
      errorText = await claudeRes.text()
    } catch {
      // Preserve the upstream status when its error body cannot be read.
    }
    console.error('Claude error:', claudeRes.status, errorText)
    if (claudeRes.status >= 500) {
      await refundScan(supabase, scanLog.id)
    }
    return json({ error: 'Vision API error' }, 502, req)
  }

  let claudeData: { content?: TextBlock[]; stop_reason?: string; structured_output?: unknown }
  try {
    claudeData = await claudeRes.json()
  } catch (error) {
    await refundScan(supabase, scanLog.id)
    console.error('Claude response parse failed:', error)
    return json({ error: 'Invalid Vision API response' }, 502, req)
  }

  const truncated = claudeData.stop_reason === 'max_tokens'
  // The raw Messages API exposes JSON-output data in its text block. Some SDK
  // responses expose the same value as structured_output; support both shapes.
  const textBlock = claudeData.content?.find(block => block.type === 'text')
  const structuredOutput = claudeData.structured_output ?? textBlock?.text

  let quests: QuestEntry[]
  try {
    const parsed = typeof structuredOutput === 'string'
      ? JSON.parse(structuredOutput)
      : structuredOutput
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.quests)) {
      throw new Error('Structured output did not contain quests')
    }
    quests = parsed.quests
  } catch (error) {
    if (!truncated || typeof structuredOutput !== 'string') {
      await refundScan(supabase, scanLog.id)
      console.error('Claude structured output parse failed:', error)
      return json({ error: 'Invalid Vision API response' }, 502, req)
    }
    quests = extractCompletedQuests(structuredOutput)
  }

  // Remaining scans this hour
  const remaining = RATE_LIMIT - ((count ?? 0) + 1)
  return json({ quests, remaining, ...(truncated ? { truncated: true } : {}) }, 200, req)
})

async function refundScan(supabase: ReturnType<typeof createClient>, scanId: string) {
  try {
    await supabase.from('quest_scan_log').delete().eq('id', scanId)
  } catch {
    // Cleanup must never mask the original upstream failure.
  }
}

function extractCompletedQuests(text: string): QuestEntry[] {
  const questsKey = text.indexOf('"quests"')
  if (questsKey < 0) return []

  const arrayStart = text.indexOf('[', questsKey)
  if (arrayStart < 0) return []

  const quests: QuestEntry[] = []
  let objectStart = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = arrayStart + 1; index < text.length; index += 1) {
    const character = text[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
    } else if (character === '{') {
      if (depth === 0) objectStart = index
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth === 0 && objectStart >= 0) {
        try {
          const quest = JSON.parse(text.slice(objectStart, index + 1))
          if (quest && typeof quest.name === 'string' && (typeof quest.map === 'string' || quest.map === null)) {
            quests.push(quest)
          }
        } catch {
          // Ignore only the incomplete object at the end of a truncated array.
        }
        objectStart = -1
      }
    }
  }

  return quests
}

function json(body: unknown, status = 200, req: Request) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

function corsHeaders(req: Request) {
  // Set ALLOWED_ORIGIN=* for local development against localhost:5173.
  const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') || 'https://dudgy.net'
  const requestOrigin = req.headers.get('Origin')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }

  if (allowedOrigin === '*' || (requestOrigin && requestOrigin === allowedOrigin)) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin === '*' ? '*' : requestOrigin!
  }

  return headers
}
