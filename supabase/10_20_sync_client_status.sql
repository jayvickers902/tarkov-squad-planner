-- Phase 10 migration 20: unified browser/desktop sync presence.
-- Local clients report only bounded operational metadata. No filenames, paths,
-- log contents, screenshot contents, party codes, or access tokens are stored.

begin;

create table if not exists public.sync_client_status (
  user_id       uuid not null references auth.users(id) on delete cascade,
  client_source text not null check (client_source in ('browser', 'desktop')),
  service       text not null check (service in ('logs', 'pings')),
  configured    boolean not null default false,
  state         text not null check (state in ('watching', 'syncing', 'idle', 'needs_access', 'offline', 'error', 'disabled')),
  detail        text not null default '' check (char_length(detail) <= 160),
  last_sync_at  timestamptz,
  last_seen_at  timestamptz not null default now(),
  primary key (user_id, client_source, service)
);

create index if not exists sync_client_status_user_seen_idx
  on public.sync_client_status (user_id, last_seen_at desc);

alter table public.sync_client_status enable row level security;

-- The table is deliberately RPC-only. The functions below always scope reads
-- and writes to auth.uid(), which keeps another user's status undiscoverable.
revoke all on table public.sync_client_status from public, anon, authenticated;

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
  v_last_sync_at timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_client_source not in ('browser', 'desktop') then raise exception 'invalid client source'; end if;
  if jsonb_typeof(p_statuses) <> 'array' or jsonb_array_length(p_statuses) > 2 then
    raise exception 'invalid status payload';
  end if;

  for v_status in select value from jsonb_array_elements(p_statuses)
  loop
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
      exception when others then
        raise exception 'invalid last sync timestamp';
      end;
      -- A bad client clock must not make a status look current forever.
      v_last_sync_at := least(v_last_sync_at, now() + interval '5 minutes');
    end if;

    insert into public.sync_client_status (
      user_id, client_source, service, configured, state, detail,
      last_sync_at, last_seen_at
    ) values (
      v_uid,
      p_client_source,
      v_service,
      coalesce((v_status->>'configured')::boolean, false),
      v_state,
      v_detail,
      v_last_sync_at,
      now()
    )
    on conflict (user_id, client_source, service) do update set
      configured = excluded.configured,
      state = excluded.state,
      detail = excluded.detail,
      last_sync_at = coalesce(excluded.last_sync_at, public.sync_client_status.last_sync_at),
      last_seen_at = excluded.last_seen_at;
  end loop;

  delete from public.sync_client_status
  where user_id = v_uid and last_seen_at < now() - interval '30 days';
end;
$$;

create or replace function public.get_sync_client_status()
returns table(
  client_source text,
  service text,
  configured boolean,
  state text,
  detail text,
  last_sync_at timestamptz,
  last_seen_at timestamptz,
  is_live boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    status.client_source,
    status.service,
    status.configured,
    status.state,
    status.detail,
    status.last_sync_at,
    status.last_seen_at,
    status.last_seen_at >= now() - interval '90 seconds' as is_live
  from public.sync_client_status status
  where status.user_id = auth.uid()
  order by status.service, status.client_source;
$$;

revoke all on function public.report_sync_client_status(text, jsonb) from public, anon, service_role;
revoke all on function public.get_sync_client_status() from public, anon, service_role;
grant execute on function public.report_sync_client_status(text, jsonb) to authenticated;
grant execute on function public.get_sync_client_status() to authenticated;

commit;
