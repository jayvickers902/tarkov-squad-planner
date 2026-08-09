-- Phase 10A migration 3 of 7.
-- Prerequisites: 10a_01_party_members.sql and 10a_02_parties_columns.sql.
-- Apply before 10a_04_rpcs.sql. Join inserts bypass these policies through
-- security-definer functions; there is deliberately no client insert policy
-- for public.party_members.

alter table public.parties enable row level security;
alter table public.party_members enable row level security;

drop policy if exists "Parties public read" on public.parties;
drop policy if exists "Parties public insert" on public.parties;
drop policy if exists "Parties public update" on public.parties;
drop policy if exists "Parties member read" on public.parties;
drop policy if exists "Parties authenticated insert" on public.parties;
drop policy if exists "Parties member update" on public.parties;

create policy "Parties member read" on public.parties
  for select using (
    exists (
      select 1 from public.party_members pm
      where pm.party_id = parties.id
        and pm.user_id = auth.uid()
    )
  );

create policy "Parties authenticated insert" on public.parties
  for insert with check (auth.uid() is not null);

create policy "Parties member update" on public.parties
  for update using (
    exists (
      select 1 from public.party_members pm
      where pm.party_id = parties.id
        and pm.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.party_members pm
      where pm.party_id = parties.id
        and pm.user_id = auth.uid()
    )
  );

drop policy if exists "Party members read" on public.party_members;
drop policy if exists "Party members insert" on public.party_members;
drop policy if exists "Party members own update" on public.party_members;
drop policy if exists "Party leaders role update" on public.party_members;
drop policy if exists "Party members leave or leader kick" on public.party_members;

create policy "Party members read" on public.party_members
  for select using (
    exists (
      select 1 from public.party_members viewer
      where viewer.party_id = party_members.party_id
        and viewer.user_id = auth.uid()
    )
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

