# CLI migrations (intentionally empty)

Do not add the historical `supabase/10_*.sql` files here or rename them to
look applied. The linked project currently reports no rows in the Supabase
migration ledger, while its catalog contains live application objects. A
reviewed, verified baseline must be created here first; after that, add only
timestamped migrations generated/reviewed with the Supabase CLI.

Until the baseline exists, `supabase db reset` is expected to produce an empty
application database and must not be used as a test setup. See
`docs/supabase-database-workflow.md` for the capture, review, and staging
rehearsal procedure.
