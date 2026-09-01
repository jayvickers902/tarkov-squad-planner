import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(join(process.cwd(), 'supabase', '10_31_security_definer_acl.sql'), 'utf8')

const anonymousRpcSignatures = [
  'append_drawing(text, jsonb)',
  'append_marker(text, jsonb)',
  'append_party_ping(text, bigint, jsonb)',
  'append_ping(text, jsonb)',
  'clear_my_drawings(text)',
  'clear_my_markers(text)',
  'clear_party_ping_events(text, bigint)',
  'clear_pings(text)',
  'end_raid_session(text, uuid)',
  'get_friend_parties(uuid[])',
  'heartbeat(text)',
  'is_party_member(bigint, uuid)',
  'merge_progress(text, jsonb)',
  'merge_starred(text, jsonb)',
  'open_raid_session(text)',
  'select_map_party(text, jsonb, text, text, text)',
  'set_raid_plan(text, uuid, integer, jsonb)',
  'set_raid_plan_map(text, uuid, integer, text, text, text, jsonb)',
  'set_raid_readiness(text, uuid, integer, boolean, jsonb)',
  'start_party_raid(text, uuid, integer)',
  'start_party_raid(text)',
]

describe('SECURITY DEFINER ACL normalization migration', () => {
  it('removes anonymous execution from every legacy application RPC', () => {
    for (const signature of anonymousRpcSignatures) {
      expect(migration).toContain(`revoke all on function public.${signature} from public, anon;`)
    }
  })

  it('keeps internal helpers inaccessible to API roles', () => {
    expect(migration).toContain(
      'revoke all on function public._party_snapshot(bigint) from public, anon, authenticated, service_role;',
    )
    expect(migration).toContain(
      'revoke all on function public.cleanup_stale() from public, anon, authenticated, service_role;',
    )
  })
})
