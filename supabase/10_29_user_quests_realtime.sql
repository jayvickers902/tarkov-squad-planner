-- Keep the browser's active quest list synchronized with updates made by the
-- desktop companion's separate Supabase client.
begin;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_quests'
  ) then
    alter publication supabase_realtime add table public.user_quests;
  end if;
end $$;

commit;
