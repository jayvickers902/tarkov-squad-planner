-- Harness bootstrap: everything the live project supplies that a bare cluster does not.
create schema if not exists auth;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

-- Minimal auth.users: the FK targets and nothing else.
create table if not exists auth.users (
  id uuid primary key,
  created_at timestamptz not null default now()
);

-- The live auth.uid() reads the request JWT claims GUC. Same shape here.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Sequence usage mirrors the live project's default grants.
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;

-- Realtime publication, mirrored from live so sl2_baseline_rls_probe check 5
-- reports the real production membership rather than an empty harness.
do $$ begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
