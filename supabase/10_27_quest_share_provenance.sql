-- Quest shareability: separate what we know from what we guessed.
--
-- 10_11 created quest_share_overrides as a thin correction layer over the type
-- inference in src/questShare.js. Measured against tarkov.help's curated data,
-- that inference agrees on only 35.6% of tasks and calls 296 of 456 known-solo
-- tasks shareable — which is why the SQUAD badge was pulled in aa590e9. The fix
-- is not a better guess; it is recording provenance so the UI can badge only the
-- rows a human actually verified.
--
-- Two columns are added:
--   source      where the verdict came from. 'manual' for hand-entered rows,
--               'tarkov.help' for rows mirrored from that site's curation.
--   objectives  per-objective verdicts keyed by OUR tarkov.dev objective id:
--               { "<objective id>": "squad" | "personal" }. tarkov.help publishes
--               is_cooperative per objective, which the task-level verdict alone
--               cannot express — a `partial` task needs to say WHICH objective.
--
-- source_ref keeps the upstream slug so a re-sync can find the row it wrote.

alter table public.quest_share_overrides
  add column if not exists source      text  not null default 'manual',
  add column if not exists source_ref  text,
  add column if not exists objectives  jsonb not null default '{}'::jsonb;

alter table public.quest_share_overrides
  drop constraint if exists quest_share_overrides_source_check;
alter table public.quest_share_overrides
  add constraint quest_share_overrides_source_check
  check (source in ('manual', 'tarkov.help'));

-- Every value in `objectives` must be one of the two objective verdicts. Guarding
-- this here keeps a bad sync from writing a shape the client would read as
-- "unknown" and silently fall back to inference on.
--
-- The check lives in an IMMUTABLE function because a CHECK constraint cannot
-- contain a subquery, and walking a jsonb object needs one.
create or replace function public.quest_share_objectives_ok(v jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(v) = 'object'
     and not exists (
       select 1 from jsonb_each_text(v) as kv
       where kv.value not in ('squad', 'personal')
     );
$$;

alter table public.quest_share_overrides
  drop constraint if exists quest_share_overrides_objectives_check;
alter table public.quest_share_overrides
  add constraint quest_share_overrides_objectives_check
  check (public.quest_share_objectives_ok(objectives));

-- The 14 rows seeded by 10_11 were hand-entered from the patch notes; the NOT NULL
-- DEFAULT above already stamps them 'manual', so no backfill is needed.

-- Curated cooperative verdicts mirrored from tarkov.help (CC-by-permission; see
-- CLAUDE.md "Quest Shareability"). Only positive verdicts are mirrored. That site
-- marks 5 of its 562 quest pages; the other 557 carry cooperative_status 'none',
-- which is its unset default and NOT a reviewed "this is solo" judgement, so
-- importing them as `solo` would be reading absence of data as data.
insert into public.quest_share_overrides (task_id, task_name, verdict, source, source_ref, objectives, note) values
  ('66631489acf8442f8b05319f', 'Friend Among Strangers', 'shared', 'tarkov.help', 'a-friend-among-strangers', '{"6667193a41b0135d2df10fd9": "squad"}'::jsonb,
   'Eliminate PMC operatives without killing Scavs.'),
  ('666314b4d7f171c4c20226c3', 'The Good Times - Part 1', 'shared', 'tarkov.help', 'good-times-1', '{"666333e93962787efd64004a": "squad"}'::jsonb,
   'Eliminate PMCs in 6B43 + Kiver-M on Factory.'),
  ('666314b2a9290f9e0806cca3', 'Hell on Earth - Part 2', 'shared', 'tarkov.help', 'hell-on-earth-2', '{"66632deea5607d352f3aa844": "squad"}'::jsonb,
   'Eliminate the hooded men with the double barrel shotgun.'),
  ('5a27bc8586f7741b543d8ea4', 'Wet Job - Part 6', 'shared', 'tarkov.help', 'wet-job-part-6', '{"6a5dea83a4dd339f77be89eb": "squad"}'::jsonb,
   'Eliminate any target with a 7.62x51 DMR over 50m on Shoreline or Lighthouse.'),
  -- The one task that proves why per-objective data matters: the kill is
  -- cooperative, the extract is not. Type inference calls both `squad` and rolls
  -- the task up to `shared`, which is wrong.
  ('67af4c1d8c9482eca103e477', 'Consolation Prize', 'partial', 'tarkov.help', 'consolation-prize',
   '{"67af727750e1b6f21d9f5511": "personal", "67af730c69887224a61084ac": "squad"}'::jsonb,
   'Lab kill count is cooperative; the 15 extracts are not.')
on conflict (task_id) do update set
  task_name  = excluded.task_name,
  verdict    = excluded.verdict,
  source     = excluded.source,
  source_ref = excluded.source_ref,
  objectives = excluded.objectives,
  note       = excluded.note,
  updated_at = now();
