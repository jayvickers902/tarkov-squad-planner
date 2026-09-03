# CODEX HANDBACK — Quest-name hex repair

## Verification

- Before: `npm test` — 51 files / 318 tests total; 50 files and 312 tests passed. The six
  failures were all in the unrelated, pre-existing `src/questImportRoutes.test.js` onboarding
  work.
- After: `npm test` — 51 files passed / 325 tests passed.
- After: `npx vite build` — green, 151 modules transformed. Only the existing large-chunk
  advisory was emitted.
- Targeted companion/helper/import tests — 3 files / 57 tests passed.
- Targeted SQL contract test — 1 file / 10 tests passed.

The aggregate suite changed while this work was running because the owner's separate dirty
onboarding work also advanced; this quest-name change did not touch those onboarding files. I
did not run `npm run build`, apply the SQL, reach Supabase, commit, or push. No package manifest
was changed by this work. The prebaked JSON files were already modified on arrival and were not
touched by this work.

## Fixes

1. Moved `MAX_QUEST_NAME_BYTES`, `boundedQuestName`, and `taskMetadataFor` into
   `src/questLogState.js`. The module imports `FEATURED` directly without creating an import
   cycle, so no new helper module was needed. The RPC map allowlist gate and its explanatory
   comment moved with the helper.

2. Widened the companion sync controller's existing `taskIds` option to accept task objects as
   well as ID strings. Known IDs are normalized before the parser/filter pipeline, and object
   metadata enriches outbound events with bounded `quest_name` and allowlisted `map_norm`.
   Plain string IDs preserve the previous no-metadata behavior.

   The external Windows companion should now pass its complete task objects in the existing
   option, for example:

   ```js
   createQuestLogSyncController({
     // ...filesystem, checkpointStore, network, gameMode...
     taskIds: allTasks.map(task => ({
       id: task.id,
       name: task.name,
       map: task.map ? { normalizedName: task.map.normalizedName } : null,
       // `mapNorm: task.mapNorm` is also accepted when the task is already flat.
     })),
   })
   ```

3. Added `supabase/10_26_quest_log_name_repair.sql` as a full `create or replace` of
   `public.reconcile_user_quest_log_events`, carrying `pvp-season` support forward from `10_21`.
   The conflict update repairs `quest_name` only when the stored name equals its quest ID and
   fills only a null `map_norm`; the monotonic update guard is unchanged. The migration is
   unapplied and awaits the owner.

4. Added a bounded client repair pass to `useUserQuests`. It inspects the already-loaded rows,
   resolves only exact 24-hex self-named IDs, preserves real names and populated maps, performs
   user/mode/quest-scoped row updates, checks every Supabase result, updates local state only for
   the active mode, and caps a session pass at 200 rows.

5. Wired the repair through `EftLogSyncProvider`. It waits for the initial quest load and a
   non-empty task list, and App also waits until the quest hook's mode matches the resolved app
   mode so a party-mode transition cannot repair the previous mode's rows. It runs once per
   user/mode per provider session, stays outside the stable context memo dependencies, and
   silently logs failures for a later-session retry.

## SQL contract retargeting

The intended seasonal assertion changed from:

```js
expect(rpcMigration).toMatch(/p_game_mode not in \('regular', 'pve'\)/i)
```

to:

```js
expect(rpcMigration).toMatch(/p_game_mode not in \('regular', 'pve', 'pvp-season'\)/i)
```

Retargeting also exposed one stale premise in the brief: `10_21` does not contain the literal
`auth.uid() is null`; it assigns `auth.uid()` to `v_uid` and checks that variable. Rather than
alter the migration's validation block or weaken the contract, this assertion:

```js
expect(rpcMigration).toMatch(/auth\.uid\(\) is null/i)
```

became these two pinned assertions:

```js
expect(rpcMigration).toMatch(/v_uid uuid := auth\.uid\(\)/i)
expect(rpcMigration).toMatch(/if v_uid is null then raise exception 'not authenticated'/i)
```

The existing negative assertions for `important`, `obj_progress`, and `skipped` remain intact
and pass against `10_26`.
