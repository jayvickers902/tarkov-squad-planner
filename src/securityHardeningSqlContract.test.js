import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(join(process.cwd(), 'supabase', '10_30_security_hardening.sql'), 'utf8')

describe('database security hardening migration', () => {
  it('enforces one active party and serializes membership changes', () => {
    expect(migration).toContain('create unique index if not exists party_members_one_active_party_idx')
    expect(migration).toContain('partition by user_id')
    expect(migration).toContain("raise exception 'already in a party'")
    expect(migration).toContain('create table if not exists public.party_creation_limits')
    expect(migration).toContain('party creation rate limit exceeded')
    expect(migration).toContain("interval '1 hour'")
    expect(migration).toContain('create temporary table _duplicate_party_ids')
    expect(migration).toContain('delete from public.parties where id = v_party_id')
    expect(migration).toContain("set role = 'leader'")
    expect(migration).toMatch(/create or replace function public\.(create_party|join_party_secure|force_join_party|leave_party)/g)
    expect(migration).toContain('pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0))')
    expect(migration).toContain("perform public._remove_party_member(v_old_party, auth.uid())")
  })

  it('bounds callsigns at both profile and party snapshot boundaries', () => {
    expect(migration).toContain('profiles_callsign_bounds')
    expect(migration).toContain('party_members_callsign_bounds')
    expect(migration).toContain("callsign ~ '^[A-Za-z0-9 _-]+$'")
    expect(migration).toContain('octet_length(callsign) between 1 and 20')
    expect(migration.match(/not valid;/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('bounds report identifiers and caps each account under concurrency', () => {
    expect(migration).toContain('quest_share_reports_identifier_bounds')
    expect(migration).toContain("task_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]*$'")
    expect(migration).toContain('enforce_quest_share_report_row_cap')
    expect(migration).toContain('hashtextextended(affected_user_id::text, 0)')
    expect(migration).toContain('maximum 5000')
    expect(migration).toContain('referencing new table as inserted')
  })

  it('serves tallies from a transactionally maintained summary', () => {
    expect(migration).toContain('create table if not exists public.quest_share_tally_counts')
    expect(migration).toContain('create trigger maintain_quest_share_tally')
    expect(migration).toMatch(/create or replace function public\.quest_share_tallies\(\)[\s\S]*?from public\.quest_share_tally_counts/i)
    expect(migration).toContain('on conflict (task_id, objective_id) do update')
    expect(migration).toContain('order by (squad_count::bigint + personal_count::bigint) desc')
    expect(migration).toContain('limit 5000')
    expect(migration.indexOf('drop trigger if exists maintain_quest_share_tally')).toBeLessThan(
      migration.indexOf('drop function if exists public.sync_quest_share_tally'),
    )
  })

  it('removes Supabase default grants before exposing authenticated RPCs', () => {
    for (const signature of [
      '_remove_party_member(bigint, uuid)',
      'create_party(text, jsonb, jsonb, jsonb)',
      'join_party_secure(text, jsonb, jsonb, jsonb)',
      'force_join_party(text, jsonb, jsonb, jsonb)',
      'leave_party(text)',
      'kick_member(text, uuid)',
      '_adjust_quest_share_tally(text, text, text, integer)',
      'quest_share_tallies()',
      'report_quest_share(text, text, text)',
    ]) {
      expect(migration).toContain(
        `revoke all on function public.${signature} from public, anon, authenticated, service_role;`,
      )
    }
  })
})
