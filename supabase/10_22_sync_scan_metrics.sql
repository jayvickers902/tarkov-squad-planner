-- Phase 10 migration 22: bounded, privacy-safe desktop scan observability.
-- Metrics contain counts and an opaque scanner version only; no paths, IDs,
-- filenames, profile labels, or log text are accepted or stored.

begin;

alter table public.sync_client_status add column if not exists scan_files integer;
alter table public.sync_client_status add column if not exists scan_sessions integer;
alter table public.sync_client_status add column if not exists scan_candidates integer;
alter table public.sync_client_status add column if not exists scan_matched integer;
alter table public.sync_client_status add column if not exists scan_applied integer;
alter table public.sync_client_status add column if not exists scan_active integer;
alter table public.sync_client_status add column if not exists scan_selection text;
alter table public.sync_client_status add column if not exists scanner_version text;
alter table public.sync_client_status enable row level security;
revoke all on table public.sync_client_status from public, anon, authenticated;

alter table public.sync_client_status drop constraint if exists sync_client_status_scan_counts_check;
alter table public.sync_client_status add constraint sync_client_status_scan_counts_check check (
  (scan_files is null or scan_files between 0 and 100000)
  and (scan_sessions is null or scan_sessions between 0 and 10000)
  and (scan_candidates is null or scan_candidates between 0 and 1000)
  and (scan_matched is null or scan_matched between 0 and 1000000)
  and (scan_applied is null or scan_applied between 0 and 1000000)
  and (scan_active is null or scan_active between 0 and 1000000)
);
alter table public.sync_client_status drop constraint if exists sync_client_status_scan_selection_check;
alter table public.sync_client_status add constraint sync_client_status_scan_selection_check check (
  scan_selection is null or scan_selection in ('none', 'auto', 'confirmed', 'required', 'unknown')
);
alter table public.sync_client_status drop constraint if exists sync_client_status_scanner_version_check;
alter table public.sync_client_status add constraint sync_client_status_scanner_version_check check (
  scanner_version is null
  or (char_length(scanner_version) between 1 and 32 and scanner_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$')
);

create or replace function public.report_sync_client_status(
  p_client_source text,
  p_statuses jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_status jsonb;
  v_metrics jsonb;
  v_service text;
  v_state text;
  v_detail text;
  v_last_sync_at timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_client_source not in ('browser', 'desktop') then raise exception 'invalid client source'; end if;
  if jsonb_typeof(p_statuses) <> 'array' or jsonb_array_length(p_statuses) > 2 then
    raise exception 'invalid status payload';
  end if;

  for v_status in select value from jsonb_array_elements(p_statuses)
  loop
    if jsonb_typeof(v_status) is distinct from 'object' then raise exception 'invalid status payload'; end if;
    v_service := lower(trim(coalesce(v_status->>'service', '')));
    v_state := lower(trim(coalesce(v_status->>'state', '')));
    v_detail := left(trim(coalesce(v_status->>'detail', '')), 160);
    v_last_sync_at := null;
    if v_service not in ('logs', 'pings') then raise exception 'invalid sync service'; end if;
    if v_state not in ('watching', 'syncing', 'idle', 'needs_access', 'offline', 'error', 'disabled') then
      raise exception 'invalid sync state';
    end if;
    if nullif(v_status->>'last_sync_at', '') is not null then
      begin
        v_last_sync_at := (v_status->>'last_sync_at')::timestamptz;
      exception when others then raise exception 'invalid last sync timestamp'; end;
      v_last_sync_at := least(v_last_sync_at, now() + interval '5 minutes');
    end if;

    v_metrics := v_status->'scan_metrics';
    if v_metrics is not null and jsonb_typeof(v_metrics) is distinct from 'object' then
      raise exception 'invalid scan metrics';
    end if;
    if v_metrics is not null and v_service <> 'logs' then raise exception 'invalid scan metrics'; end if;
    if v_metrics is not null and exists (
      select 1 from jsonb_each(v_metrics) metric
      where metric.key not in ('files', 'sessions', 'candidates', 'matched', 'applied', 'active', 'selection', 'scanner_version')
    ) then raise exception 'invalid scan metrics'; end if;
    -- Numeric text is checked before its integer cast; CASE keeps malformed
    -- JSON from reaching a cast even if the planner reorders predicates.
    if v_metrics is not null and exists (
      select 1 from jsonb_each(v_metrics) metric
      where metric.key in ('files', 'sessions', 'candidates', 'matched', 'applied', 'active')
        and (jsonb_typeof(metric.value) <> 'number' or metric.value::text !~ '^[0-9]{1,7}$')
    ) then raise exception 'invalid scan metrics'; end if;
    if v_metrics is not null and exists (
      select 1 from jsonb_each(v_metrics) metric
      where metric.key = 'files' and case when metric.value::text ~ '^[0-9]{1,7}$' then (metric.value #>> '{}')::integer else 0 end > 100000
    ) then raise exception 'invalid scan metrics'; end if;
    if v_metrics is not null and exists (
      select 1 from jsonb_each(v_metrics) metric
      where metric.key = 'sessions' and case when metric.value::text ~ '^[0-9]{1,7}$' then (metric.value #>> '{}')::integer else 0 end > 10000
    ) then raise exception 'invalid scan metrics'; end if;
    if v_metrics is not null and exists (
      select 1 from jsonb_each(v_metrics) metric
      where metric.key in ('candidates', 'matched', 'applied', 'active')
        and case when metric.value::text ~ '^[0-9]{1,7}$' then (metric.value #>> '{}')::integer else 0 end > 1000000
    ) then raise exception 'invalid scan metrics'; end if;
    if v_metrics is not null and ((v_metrics ? 'selection') and (
      jsonb_typeof(v_metrics->'selection') <> 'string'
      or v_metrics->>'selection' not in ('none', 'auto', 'confirmed', 'required', 'unknown')
    )) then raise exception 'invalid scan metrics'; end if;
    if v_metrics is not null and ((v_metrics ? 'scanner_version') and (
      jsonb_typeof(v_metrics->'scanner_version') <> 'string'
      or v_metrics->>'scanner_version' !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$'
    )) then raise exception 'invalid scan metrics'; end if;

    insert into public.sync_client_status (
      user_id, client_source, service, configured, state, detail, last_sync_at, last_seen_at,
      scan_files, scan_sessions, scan_candidates, scan_matched, scan_applied, scan_active,
      scan_selection, scanner_version
    ) values (
      v_uid, p_client_source, v_service, coalesce((v_status->>'configured')::boolean, false),
      v_state, v_detail, v_last_sync_at, now(),
      case when v_metrics ? 'files' then (v_metrics->>'files')::integer end,
      case when v_metrics ? 'sessions' then (v_metrics->>'sessions')::integer end,
      case when v_metrics ? 'candidates' then (v_metrics->>'candidates')::integer end,
      case when v_metrics ? 'matched' then (v_metrics->>'matched')::integer end,
      case when v_metrics ? 'applied' then (v_metrics->>'applied')::integer end,
      case when v_metrics ? 'active' then (v_metrics->>'active')::integer end,
      v_metrics->>'selection', v_metrics->>'scanner_version'
    )
    on conflict (user_id, client_source, service) do update set
      configured = excluded.configured,
      state = excluded.state,
      detail = excluded.detail,
      last_sync_at = coalesce(excluded.last_sync_at, public.sync_client_status.last_sync_at),
      last_seen_at = excluded.last_seen_at,
      scan_files = coalesce(excluded.scan_files, public.sync_client_status.scan_files),
      scan_sessions = coalesce(excluded.scan_sessions, public.sync_client_status.scan_sessions),
      scan_candidates = coalesce(excluded.scan_candidates, public.sync_client_status.scan_candidates),
      scan_matched = coalesce(excluded.scan_matched, public.sync_client_status.scan_matched),
      scan_applied = coalesce(excluded.scan_applied, public.sync_client_status.scan_applied),
      scan_active = coalesce(excluded.scan_active, public.sync_client_status.scan_active),
      scan_selection = coalesce(excluded.scan_selection, public.sync_client_status.scan_selection),
      scanner_version = coalesce(excluded.scanner_version, public.sync_client_status.scanner_version);
  end loop;

  delete from public.sync_client_status
  where user_id = v_uid and last_seen_at < now() - interval '30 days';
end;
$$;

-- Return columns are part of the function type, so drop/recreate is required
-- when adding scan metrics. Existing callers that ignore extra fields remain
-- fully compatible; the report RPC signature itself is unchanged.
drop function if exists public.get_sync_client_status();
create function public.get_sync_client_status()
returns table(
  client_source text, service text, configured boolean, state text, detail text,
  last_sync_at timestamptz, last_seen_at timestamptz, is_live boolean,
  scan_files integer, scan_sessions integer, scan_candidates integer,
  scan_matched integer, scan_applied integer, scan_active integer,
  scan_selection text, scanner_version text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select status.client_source, status.service, status.configured, status.state, status.detail,
    status.last_sync_at, status.last_seen_at,
    status.last_seen_at >= now() - interval '90 seconds' as is_live,
    status.scan_files, status.scan_sessions, status.scan_candidates,
    status.scan_matched, status.scan_applied, status.scan_active,
    status.scan_selection, status.scanner_version
  from public.sync_client_status status
  where status.user_id = auth.uid()
  order by status.service, status.client_source;
$$;

revoke all on function public.report_sync_client_status(text, jsonb) from public, anon, service_role;
revoke all on function public.get_sync_client_status() from public, anon, service_role;
grant execute on function public.report_sync_client_status(text, jsonb) to authenticated;
grant execute on function public.get_sync_client_status() to authenticated;

commit;
