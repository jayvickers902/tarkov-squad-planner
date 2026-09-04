-- Validate the two collaboration payload constraints introduced NOT VALID by
-- 10_36_restore_collab_payload_bounds.sql.
--
-- Decision evidence from the linked catalog on 2026-09-03, before 10_36:
--   party_members: 1 row, 0 violations, 360448 total relation bytes
--   parties:       1 row, 0 violations, 212992 total relation bytes
--
-- VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE on each table while it
-- scans existing rows. That permits ordinary reads and writes, but conflicts
-- with concurrent schema maintenance and VACUUM. These tables are currently
-- tiny, so the validation window should be brief. Apply only after 10_36.

begin;

alter table public.party_members
  validate constraint party_members_quest_payload_bounds;

alter table public.parties
  validate constraint party_collaboration_payload_bounds;

commit;
