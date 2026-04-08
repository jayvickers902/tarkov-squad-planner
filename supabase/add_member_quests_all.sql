-- Run this in the Supabase SQL editor
ALTER TABLE parties
  ADD COLUMN IF NOT EXISTS member_quests_all jsonb NOT NULL DEFAULT '{}'::jsonb;
