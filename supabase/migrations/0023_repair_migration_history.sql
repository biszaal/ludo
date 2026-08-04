-- Repair the migration history. BOOKKEEPING ONLY — this file creates no
-- objects, changes no data, and touches no schema.
--
-- THE PROBLEM
-- -----------
-- The remote history and this directory use two different version schemes:
--
--   this directory   0001_init.sql … 0022_hot_path_trims.sql   -> version "0001".."0022"
--   remote tracker   20260712174516 "missed_turns", …          -> 11 timestamped rows
--
-- The CLI derives a migration's version from the leading digits of its
-- filename, so NONE of the 22 files here match any row in the remote tracker.
-- `supabase db push` would therefore consider the entire history unapplied and
-- try to replay it — starting with 0001_init against a live, populated
-- database. That is the actual risk this file removes.
--
-- The 11 timestamped rows are the same migrations recorded under the older
-- scheme: their names (missed_turns, state_version, quick_match, coins,
-- quick_size, app_config, economy, friend_discovery, player_stats,
-- user_presence, gems) map exactly onto 0007-0013 and 0015-0018. Note the gaps:
-- 0001-0006, 0014_dice_skins and 0019-0022 were never recorded at all, though
-- all of them are demonstrably applied.
--
-- HOW "APPLIED" WAS VERIFIED (not assumed)
-- ----------------------------------------
--   0001-0006  every table, and the profiles unique index, exist
--   0014       the profiles_enforce_dice_skin trigger exists and is firing
--              (it is what strips an unowned dice skin on write)
--   0019       players has column-scoped UPDATE grants and no table-level one;
--              games/players/moves read policies use is_game_participant()
--   0020       games.replica_identity is set for realtime
--   0021       two cron jobs are registered for the retention reapers
--   0022       games.has_bots exists, maintained by mark_game_has_bots()
--
-- HOW TO APPLY THIS FILE
-- ----------------------
-- Run it directly (SQL editor or psql) — NOT via `supabase db push`, which is
-- the very thing it makes safe. Equivalent official route, if preferred:
--
--   for v in 0001 .. 0023; do supabase migration repair --status applied $v; done
--
-- Afterwards `supabase migration list` should show all 24 files as applied on
-- both sides, and `db push` becomes a no-op until a genuinely new file lands.
--
-- ROLLBACK: delete the rows this inserts. Bookkeeping only — no schema effect.

-- ---------------------------------------------------------------------------
-- 1. Record every migration in this directory as applied.
-- ---------------------------------------------------------------------------
-- Includes 0023 (this file), so a later `db push` doesn't try to run it again.
-- ON CONFLICT keeps the whole thing safely re-runnable.
insert into supabase_migrations.schema_migrations (version, name)
values
  ('0001', 'init'),
  ('0002', 'lock_writes'),
  ('0003', 'profiles'),
  ('0004', 'turn_deadline'),
  ('0005', 'friends'),
  ('0006', 'unique_display_names'),
  ('0007', 'missed_turns'),
  ('0008', 'state_version'),
  ('0009', 'quick_match'),
  ('0010', 'coins'),
  ('0011', 'quick_size'),
  ('0012', 'app_config'),
  ('0013', 'economy'),
  ('0014', 'dice_skins'),
  ('0015', 'friend_discovery'),
  ('0016', 'player_stats'),
  ('0017', 'user_presence'),
  ('0018', 'gems'),
  ('0019', 'tighten_reads'),
  ('0020', 'games_replica_identity'),
  ('0021', 'retention'),
  ('0022', 'hot_path_trims'),
  ('0023', 'repair_migration_history')
on conflict (version) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Drop the superseded timestamped rows.
-- ---------------------------------------------------------------------------
-- These duplicate migrations now recorded above under their file versions.
-- Left in place they are permanent "remote-only" entries in every
-- `supabase migration list`, which is exactly the ambiguity this file exists to
-- end. Deleting a tracker row cannot undo the DDL it recorded — the schema is
-- unaffected either way.
--
-- Scoped deliberately narrowly: only all-digit 14-character versions (the
-- timestamp shape) whose name matches one we just re-recorded. A future
-- timestamped migration from a teammate's CLI would not be touched.
delete from supabase_migrations.schema_migrations
 where version ~ '^\d{14}$'
   and name in (
     'missed_turns', 'state_version', 'quick_match', 'coins', 'quick_size',
     'app_config', 'economy', 'friend_discovery', 'player_stats',
     'user_presence', 'gems'
   );
