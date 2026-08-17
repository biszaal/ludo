-- Stale quick rooms owed a refund to EVERY seat, not just the host.
--
-- quick_match_claim debits each player as they claim a seat (quick.ts), so a
-- part-filled 4-player room holds three or four entry fees. 0021's reaper only
-- paid back `host_user_id` and then deleted the game, taking the `players` rows
-- with it — every guest's entry vanished with no ledger row to show for it.
--
-- The refund key is now `leave-refund:<game>:<user>`, the same key opLeave uses.
-- That is deliberate: a guest tapping Cancel at the moment the reaper sweeps
-- their room is an ordinary race, and sharing the key makes the two paths
-- mutually idempotent instead of merely unlikely to collide.

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
  for dead in
    select id, stake
      from games
     where status = 'waiting'
       and is_quick
       and created_at < now() - interval '15 minutes'
     for update skip locked
  loop
    if dead.stake > 0 then
      -- Every seated human. Bots never occupy a waiting quick room (they are
      -- seated by quickBotFill, which starts the game in the same call), so
      -- there is no bot seat to skip here.
      perform wallet_apply(
        p.user_id, dead.stake, 'stake-refund', dead.id,
        'earned', 'leave-refund:' || dead.id::text || ':' || p.user_id::text
      )
      from players p
      where p.game_id = dead.id;
    end if;
    delete from games where id = dead.id;
  end loop;

  -- 2. Friend rooms nobody ever started. No stake rides on these (only quick
  --    match debits before start), and a room code is worthless a day later.
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
