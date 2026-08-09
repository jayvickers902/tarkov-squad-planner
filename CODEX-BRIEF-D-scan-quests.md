# Codex Brief D — Quest scanner: a truncated response looks like "no quests found"

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ high effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.
**Do not deploy the function.** Authoring only — the owner runs `supabase functions deploy`.

Repo: `c:\projects\tarkov-squad-planner` · branch `phase10-foundation` · live at dudgy.net.
Read `CLAUDE.md` first, especially the Edge Functions section.

---

## Files you own

You may edit **only**:

- `supabase/functions/scan-quests/index.ts`

Three sibling briefs (A, B, C) run against this repo concurrently and own `src/**`,
`index.html` and `public/**`. Touch none of them. Do not edit
`supabase/functions/scan-quests/config.toml`, any `supabase/*.sql`, or
`src/components/QuestScanner.jsx` — if you conclude the client needs a change,
**report it, do not make it.**

## Constraints

- Deno edge function, deployed with `--no-verify-jwt` (auth is handled manually in
  the handler — preserve that).
- The Anthropic key is the Supabase secret `ANTHROPIC_API_KEY`. Never log it, never
  return it, never move it into a response body.
- `RATE_LIMIT` stays at 100/hour/user, admins exempt via `profiles.is_admin`.
- Keep the existing raw-`fetch` transport. Do **not** add the Anthropic SDK — this
  is a Deno edge function with a deliberately minimal import surface, and the
  current code imports only `@supabase/supabase-js` from esm.sh.
- Do not change the response envelope keys the client reads: `{ quests, remaining }`
  on success, `{ error }` on failure. `QuestScanner.jsx` depends on them.

## Working tree

Clean apart from untracked `public/*.png` and `supabase/.temp/linked-project.json`.
Do not revert, stash, clean, commit, amend, or branch.

---

## Task 1 — Replace prompt-and-parse with structured outputs

This is the main event. Current flow, `index.ts:98-133`:

- `max_tokens: 400`
- the prompt ends with *"Return ONLY the JSON array. No explanation, no markdown."*
- the response is `JSON.parse`d; on failure a regex `rawText.match(/\[[\s\S]*\]/)`
  tries to salvage an array; on failure of *that*, `quests = []`

**The bug:** a screenshot with a long quest list blows past 400 tokens. The JSON
array is truncated mid-object. `JSON.parse` throws, the regex either fails or — worse
— matches a truncated array that also fails to parse, and the function returns
`{ quests: [], remaining: N }` with **HTTP 200**. The user is told nothing was found,
their scan is spent, and there is no signal anywhere that the response was cut off.

`claude-haiku-4-5` supports structured outputs, which removes this entire failure
class: the model is constrained to emit schema-valid JSON, so the parse cannot fail.

**Do this:**

1. Add `output_config.format` to the request body with a `json_schema` describing
   the result. The current model returns a bare top-level array; JSON-schema output
   wants an object, so use a wrapper:

   ```jsonc
   {
     "type": "object",
     "properties": {
       "quests": {
         "type": "array",
         "items": {
           "type": "object",
           "properties": {
             "name": { "type": "string" },
             "map":  { "type": ["string", "null"] }
           },
           "required": ["name", "map"],
           "additionalProperties": false
         }
       }
     },
     "required": ["quests"],
     "additionalProperties": false
   }
   ```

   Structured outputs require `additionalProperties: false` and a `required` array on
   every object. Note the nullable `map` — the prompt's "Any location" rule depends
   on `null` being expressible, so use the `["string", "null"]` type form rather than
   omitting the field.
2. **Trim the prompt accordingly.** With the schema enforcing shape, the
   *"Return ONLY the JSON array. No explanation, no markdown."* line and the
   `Example output:` line are now dead weight that can only conflict with the
   schema. Delete them. **Keep** the map-name rules and the "Any location → null"
   rule — those are semantic instructions the schema cannot express.
3. **Delete the regex salvage path** (`index.ts:128-133`). It exists only to paper
   over unconstrained output. With structured outputs it is unreachable, and leaving
   it would silently swallow real errors.
4. Read the result from the response's structured output rather than
   `content[0].text`, and pull `quests` out of the wrapper object so the returned
   envelope stays `{ quests: [...], remaining: N }` exactly as before.
5. Bump `max_tokens` from 400 to something that comfortably fits a full quest
   screen — 2000 is reasonable for ~40 entries. Cheap insurance; Haiku pricing makes
   this negligible.
6. **Still handle `stop_reason === "max_tokens"` explicitly.** Structured outputs
   guarantee *shape*, not *completeness* — a hard cap can still truncate. When you
   see it, return HTTP 200 with the quests you did get **plus** a `truncated: true`
   field, so the client can tell the user "we got the first N, scan the rest".
   Adding a key is safe; the client ignores unknown fields.

## Task 2 — Do not charge a scan for our own failure

`index.ts:82-88` inserts the `quest_scan_log` row **before** calling Claude. The
comment says this is deliberate ("counts even if Claude fails") and as abuse
prevention that is defensible — a user cannot burn tokens for free by forcing errors.

But it currently also punishes the user for **our** outages: a 502 from the Anthropic
API, or a `fetch` that throws, still consumes one of their 100 hourly scans.

Split the difference on cause:
- **Keep the pre-charge.** Do not move the insert.
- When the Claude call fails with a **5xx** or the `fetch` itself throws, delete that
  log row before returning the error, so the scan is refunded. Capture the inserted
  row's `id` (add `.select('id').single()` to the insert) so you can delete precisely
  that row and not a concurrent one.
- **Do not refund on 4xx** — a 400 or 413 means a bad image or an oversized payload,
  which is user-caused and should count.
- If the refund delete itself fails, swallow it and still return the original error.
  Never let cleanup mask the real failure.

## Task 3 — Two small hardening items

1. **CORS.** `index.ts:8` sets `Access-Control-Allow-Origin: '*'` on an
   authenticated, billed endpoint. Auth is enforced so this is not an auth hole, but
   there is no reason for any origin to reach it. Read an allowed origin from an env
   var (`ALLOWED_ORIGIN`) and fall back to `https://dudgy.net` when unset, echoing it
   only when the request `Origin` matches. Keep `*` behaviour available via the env
   var so local dev against `localhost:5173` is not broken — document that in a
   comment.
2. **Unhandled throws.** The `fetch` to `CLAUDE_API` and the `claudeRes.json()` parse
   are both unguarded; a network blip becomes an unhandled rejection and an opaque
   500 with no CORS headers, which the browser reports as a CORS error rather than a
   server error — actively misleading when debugging. Wrap the Claude call in
   `try/catch` and return a proper `json({ error: ... }, 502)` (which already applies
   CORS) on failure.

---

## Verify

You cannot deploy, and you should not. Verify statically:

1. `npx deno check supabase/functions/scan-quests/index.ts` if a Deno toolchain is
   available. If it is not, say so plainly in your report rather than skipping the
   step silently — do **not** install Deno.
2. Re-read the final file and confirm by inspection:
   - no code path returns `{ quests: [] }` with HTTP 200 as a result of a parse or
     truncation failure
   - the regex salvage block is gone
   - `ANTHROPIC_API_KEY` appears exactly once, in the request header
   - the success envelope still has `quests` and `remaining`
   - every early return goes through `json()` so CORS headers are always present
3. Cross-check `src/components/QuestScanner.jsx` **read-only** and confirm the
   client tolerates the new `truncated` field and every error path you can return.
   Report anything the client mishandles — do not edit it.

## Acceptance

- Structured outputs in place; the parse cannot fail on well-formed model output.
- Truncation is reported to the user instead of masquerading as an empty result.
- Anthropic 5xx and network errors refund the scan; 4xx does not.
- CORS is pinned by default with a documented dev escape hatch.
- No SDK added, no deploy performed, no file outside
  `supabase/functions/scan-quests/index.ts` modified.
