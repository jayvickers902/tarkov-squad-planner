-- Phase 10 migration 3 of 7.
-- Prerequisites: 10_01_party_members.sql and 10_02_parties_columns.sql.
-- Apply before 10_04_rpcs.sql. Join inserts bypass these policies through
-- security-definer functions; there is deliberately no client insert policy
-- for public.party_members.

-- R2: admin authorization is profile data, never a hardcoded UUID.

alter table public.parties enable row level security;
alter table public.party_members enable row level security;

drop policy if exists "Parties public read" on public.parties;
drop policy if exists "Parties public insert" on public.parties;
drop policy if exists "Parties public update" on public.parties;
drop policy if exists "Parties member read" on public.parties;
drop policy if exists "Parties authenticated insert" on public.parties;
drop policy if exists "Parties member update" on public.parties;

drop policy if exists "map_keys public read" on public.map_keys;
drop policy if exists "map_keys admin write" on public.map_keys;
drop policy if exists "map_loot public read" on public.map_loot;
drop policy if exists "map_loot admin write" on public.map_loot;

drop policy if exists "Profiles public read" on public.profiles;
drop policy if exists "Profiles authenticated read" on public.profiles;

create or replace function public.is_party_member(p_party_id bigint, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.party_members pm
    where pm.party_id = p_party_id
      and pm.user_id = p_user_id
  );
$$;

revoke all on function public.is_party_member(bigint, uuid) from public;
grant execute on function public.is_party_member(bigint, uuid) to authenticated;

create policy "Profiles authenticated read" on public.profiles
  for select using (auth.uid() is not null);

create policy "Parties member read" on public.parties
  for select using (
    public.is_party_member(parties.id, auth.uid())
  );

create policy "Parties member update" on public.parties
  for update using (
    public.is_party_member(parties.id, auth.uid())
  ) with check (
    public.is_party_member(parties.id, auth.uid())
  );

create policy "map_keys authenticated read" on public.map_keys
  for select using (auth.uid() is not null);

create policy "map_keys admin write" on public.map_keys
  for all using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin
    )
  ) with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin
    )
  );

create policy "map_loot authenticated read" on public.map_loot
  for select using (auth.uid() is not null);

create policy "map_loot admin write" on public.map_loot
  for all using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin
    )
  ) with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin
    )
  );

drop policy if exists "Party members read" on public.party_members;
drop policy if exists "Party members insert" on public.party_members;
drop policy if exists "Party members own update" on public.party_members;
drop policy if exists "Party leaders role update" on public.party_members;
drop policy if exists "Party members leave or leader kick" on public.party_members;

create policy "Party members read" on public.party_members
  for select using (
    public.is_party_member(party_members.party_id, auth.uid())
  );

create policy "Party members own update" on public.party_members
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Party leaders role update" on public.party_members
  for update using (
    exists (
      select 1 from public.parties p
      where p.id = party_members.party_id
        and p.leader_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.parties p
      where p.id = party_members.party_id
        and p.leader_id = auth.uid()
    )
    and role in ('leader', 'member')
  );

create policy "Party members leave or leader kick" on public.party_members
  for delete using (
    auth.uid() = user_id
    or exists (
      select 1 from public.parties p
      where p.id = party_members.party_id
        and p.leader_id = auth.uid()
    )
  );

-- RLS gates which rows a client may touch; GRANT gates which columns it may
-- update. Keep these explicit: a blanket UPDATE would let a member rewrite
-- party identity/leadership fields or move their membership row.
revoke update on table public.parties from anon, authenticated;
grant update (
  spawn,
  progress,
  starred,
  quest_order,
  settings,
  drawings,
  markers,
  pings,
  ping_log,
  raid_id,
  last_active_at
) on table public.parties to anon, authenticated;

revoke update on table public.party_members from anon, authenticated;
grant update (quests, quests_all) on table public.party_members to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'parties'
  ) then
    alter publication supabase_realtime add table public.parties;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'party_members'
  ) then
    alter publication supabase_realtime add table public.party_members;
  end if;
end $$;
