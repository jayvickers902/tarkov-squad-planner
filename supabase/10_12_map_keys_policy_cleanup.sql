-- Retire the pre-cutover map_keys policies.
--
-- map_keys predates the profiles.is_admin flag and still carried three policies
-- that hardcoded a single user's uuid, plus a `using (true)` read policy that
-- made the table anon-readable. Policies OR together, so the hardcoded trio
-- granted writes the is_admin policy was supposed to govern, and the open read
-- policy made "map_keys authenticated read" dead weight.
--
-- End state matches map_loot exactly: authenticated read, is_admin write.

-- Guard: policies OR together, so dropping the hardcoded write policies while
-- no admin exists would leave nobody able to write map_keys. Fail loudly rather
-- than silently locking the table.
do $$
begin
  if not exists (select 1 from public.profiles where is_admin) then
    raise exception
      'Refusing to run: no profile has is_admin = true. Dropping the hardcoded-uuid policies now would leave map_keys unwritable by anyone. Grant admin first.';
  end if;
end $$;

drop policy if exists "map_keys_admin_insert" on public.map_keys;
drop policy if exists "map_keys_admin_update" on public.map_keys;
drop policy if exists "map_keys_admin_delete" on public.map_keys;
drop policy if exists "map_keys_read_all"     on public.map_keys;

-- Reassert the surviving pair so this file is self-contained and idempotent.
drop policy if exists "map_keys authenticated read" on public.map_keys;
drop policy if exists "map_keys admin write"        on public.map_keys;

create policy "map_keys authenticated read" on public.map_keys
  for select using (auth.uid() is not null);

create policy "map_keys admin write" on public.map_keys
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
