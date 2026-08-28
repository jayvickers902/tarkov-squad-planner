-- Phase 10 migration 19: authenticated Windows companion heartbeat/status.
-- The companion calls the two RPCs below; the web client reads only the
-- caller's rows to show whether its desktop sync is actually connected.

begin;

create table if not exists public.sync_client_status (
  user_id       uuid not null references auth.users(id) on delete cascade,
  client_source text not null,
  service       text not null,
  configured    boolean not null default false,
  state         text not null default 'offline',
  detail        text not null default '',
  last_sync_at  timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (user_id, client_source, service),
  constraint sync_client_status_source_check check (client_source in ('desktop')),
  constraint sync_client_status_service_check check (service in ('logs', 'pings')),
  constraint sync_client_status_state_check check (
    state in ('watching', 'syncing', 'idle', 'needs_access', 'offline', 'error', 'disabled')
  ),
  constraint sync_client_status_detail_bounds check (octet_length(detail) <= 160)
);

create index if not exists sync_client_status_updated_idx
  on public.sync_client_status (user_id, client_source, updated_at desc);

alter table public.sync_client_status enable row level security;
drop policy if exists "Sync client status own read" on public.sync_client_status;
create policy "Sync client status own read" on public.sync_client_status
  for select to authenticated using (auth.uid() = user_id);

revoke all on table public.sync_client_status from anon, authenticated;
grant select on table public.sync_client_status to authenticated;

create or replace function public.get_desktop_sync_context()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'callsign', coalesce(active.callsign, p.callsign),
    'game_mode', coalesce(active.game_mode, settings.settings->>'game_mode', 'regular'),
    'party_id', active.party_id,
    'party_code', active.party_code,
    'raid_id', active.raid_id,
    'map_norm', active.map_norm
  )
  from (select auth.uid() as user_id) cu
  left join public.profiles p on p.id = cu.user_id
  left join public.user_settings settings on settings.user_id = cu.user_id
  left join lateral (
    select pm.party_id, pm.callsign, party.code as party_code,
      party.game_mode, party.raid_id, party.map_norm
    from public.party_members pm
    join public.parties party on party.id = pm.party_id
    where pm.user_id = cu.user_id
    order by party.last_active_at desc nulls last, party.created_at desc
    limit 1
  ) active on true;
$$;

revoke all on function public.get_desktop_sync_context() from public, anon, service_role;
grant execute on function public.get_desktop_sync_context() to authenticated;

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
  v_service text;
  v_state text;
  v_detail text;
  v_last_sync_at text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_client_source is null or p_client_source <> 'desktop' then
    raise exception 'invalid sync client source';
  end if;
  if p_statuses is null or jsonb_typeof(p_statuses) is distinct from 'array'
     or jsonb_array_length(p_statuses) > 2 then
    raise exception 'invalid sync client status payload';
  end if;

  for v_status in select value from jsonb_array_elements(p_statuses) loop
    if jsonb_typeof(v_status) is distinct from 'object' then
      raise exception 'invalid sync client status';
    end if;
    v_service := lower(v_status->>'service');
    v_state := lower(v_status->>'state');
    v_detail := left(coalesce(v_status->>'detail', ''), 160);
    v_last_sync_at := v_status->>'last_sync_at';
    if v_service not in ('logs', 'pings')
       or v_state not in ('watching', 'syncing', 'idle', 'needs_access', 'offline', 'error', 'disabled')
       or (v_status ? 'configured' and jsonb_typeof(v_status->'configured') is distinct from 'boolean')
       or (v_last_sync_at is not null and v_last_sync_at !~
         '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$') then
      raise exception 'invalid sync client status';
    end if;
    insert into public.sync_client_status (
      user_id, client_source, service, configured, state, detail, last_sync_at, updated_at
    ) values (
      v_uid, p_client_source, v_service,
      coalesce((v_status->>'configured')::boolean, false),
      v_state, v_detail,
      case when v_last_sync_at is null then null else v_last_sync_at::timestamptz end,
      now()
    )
    on conflict (user_id, client_source, service) do update set
      configured = excluded.configured,
      state = excluded.state,
      detail = excluded.detail,
      last_sync_at = excluded.last_sync_at,
      updated_at = now();
  end loop;
end;
$$;

revoke all on function public.report_sync_client_status(text, jsonb) from public, anon, service_role;
grant execute on function public.report_sync_client_status(text, jsonb) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sync_client_status'
  ) then
    alter publication supabase_realtime add table public.sync_client_status;
  end if;
end $$;

commit;
