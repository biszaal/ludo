-- Retention. Nothing in this schema was ever deleted: `moves` grows ~250 rows
-- per game forever, and every finished game keeps its ~2 KB state snapshot.
-- Neither is read after the game ends. Left alone, the two biggest tables in
-- the database are the two nobody queries.
--
-- Three reapers, one function so a single cron entry covers all of them (and
-- so the whole policy is readable in one place). Windows are deliberately
-- generous — this is storage hygiene, not a business rule.

-- ---------------------------------------------------------------------------
-- Support the reaper's own scans. Both are partial/composite so they stay
-- small: the planner needs "old finished games" and "old waiting rooms", never
-- a full ordering of the table.
-- ---------------------------------------------------------------------------
create index if not exists games_finished_updated_idx
  on public.games (updated_at) where status = 'finished';

create index if not exists games_waiting_created_idx
  on public.games (created_at) where status = 'waiting';

create index if not exists moves_created_idx on public.moves (created_at);

-- ---------------------------------------------------------------------------
-- The reaper
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because it runs from cron (as postgres) and calls
-- wallet_apply, which is itself definer-only and revoked from every client role.
create or replace function public.reap_stale_games()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  dead record;
begin
  -- 1. Abandoned matchmaking rooms.
  --
  -- More than housekeeping: quick_match_claim takes the OLDEST open room
  -- (0018), so a room whose host crashed out is the FIRST one handed to every
  -- new searcher — who then gets dealt against a player who will never act,
  -- sits through three bot-played turns, and watches them auto-leave. Reaping
  -- these is a matchmaking-quality fix that happens to also bound the table.
  --
  -- The entry stake was debited when the room was opened, so it has to come
  -- back. ext_id makes the refund idempotent: a re-run, or a crash between the
  -- refund and the delete, cannot pay twice (wallet_txns_ext_id_uidx, 0013).
  -- opLeave's cancel path deletes the row in the same statement it reads the
  -- stake, so a room it handled is already gone by the time we look.
  for dead in
    select id, host_user_id, stake
      from games
     where status = 'waiting'
       and is_quick
       and created_at < now() - interval '15 minutes'
     for update skip locked
  loop
    if dead.stake > 0 then
      perform wallet_apply(
        dead.host_user_id, dead.stake, 'stake-refund', dead.id,
        'earned', 'stale-room:' || dead.id::text
      );
    end if;
    delete from games where id = dead.id;
  end loop;

  -- 2. Friend rooms nobody ever started. No stake rides on these (only quick
  --    match debits), and a room code is worthless a day later.
  delete from games
   where status = 'waiting'
     and not is_quick
     and created_at < now() - interval '24 hours';

  -- 3. Finished games. `players` and `moves` cascade from here (0001), and
  --    player_stats already holds the permanent record of who won what, so the
  --    snapshot itself is what goes. Two months is well past any support
  --    question that could still reference a specific match.
  delete from games
   where status = 'finished'
     and updated_at < now() - interval '60 days';

  -- 4. Move logs for games still around (rematches keep a room alive
  --    indefinitely, so its audit trail would otherwise grow without bound).
  delete from moves
   where created_at < now() - interval '30 days';
end;
$$;

revoke all on function public.reap_stale_games() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schedule. Same guarded pattern as 0015's auto-decline reaper: environments
-- without pg_cron (a local stack) just don't reap, which is harmless — nothing
-- here is load-bearing for correctness.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'reap-stale-games',
      '*/5 * * * *',
      $cron$select public.reap_stale_games()$cron$
    );
  end if;
exception when others then
  null;
end $$;
