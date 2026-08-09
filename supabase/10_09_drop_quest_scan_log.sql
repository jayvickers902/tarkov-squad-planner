-- Retire the quest-scan rate limiter.
--
-- Quest screenshot scanning moved from the Claude-vision `scan-quests` edge
-- function to Tesseract WASM running in the user's browser. There is no server
-- call left to meter, so the log table and its policies are dead weight.
--
-- Run this only after the client build that drops the edge-function call is
-- deployed. Dropping the table is irreversible — the rows are only rate-limit
-- bookkeeping, but confirm nothing else reads them first.

drop index if exists public.quest_scan_log_user_time_idx;

drop policy if exists "Scan log own insert" on public.quest_scan_log;
drop policy if exists "Scan log own select" on public.quest_scan_log;

drop table if exists public.quest_scan_log;
