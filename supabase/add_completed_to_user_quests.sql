-- Run this in the Supabase SQL editor
ALTER TABLE user_quests
  ADD COLUMN IF NOT EXISTS completed boolean NOT NULL DEFAULT false;
