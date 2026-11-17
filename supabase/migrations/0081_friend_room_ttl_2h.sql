-- 0081 — friend rooms nobody started are reaped after 2 hours, not 24.
--
-- APPLIED TO PRODUCTION BY HAND on 2026-11-16 09:28 UTC, through the dashboard,
-- before this file existed. The tracker row it got was a timestamp
-- (20261116092816), the same drift 0023 had to repair; it was renamed to 0081
-- on 2026-11-17 so `supabase db push` reads this file as already applied.
--
-- The only change from 0077's reap_stale_games is step 2: a waiting friend room
-- is deleted after 2 hours instead of 24. Hosts often stay marked connected, so
-- age is the only reliable sign a room was abandoned. No coins ride on these
-- (nothing is debited before a friend room starts), so closing one owes nobody
-- anything. The rest of the function is unchanged; the body below is the text
-- that was applied, verbatim.

CREATE OR REPLACE FUNCTION public.reap_stale_games()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    select id, stake, atomic_quick
      from games
     where status = 'waiting'
       and is_quick
       and created_at < now() - interval '15 minutes'
     for update skip locked
  loop
    if dead.atomic_quick and dead.stake > 0 then
      perform refund_quick_entries(dead.id, null);
    elsif dead.stake > 0 then
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
  --    match debits before start). Cut from 24 hours to 2 hours: a friend
  --    room that nobody joined in 2 hours is abandoned, and hosts often stay
  --    marked connected, so age is the only reliable signal.
  delete from games
   where status = 'waiting'
     and not is_quick
     and created_at < now() - interval '2 hours';

  -- 3. Active games nobody has touched in a day.
  --
  -- The turn clock runs in seconds and the tick drives every reachable table
  -- once a minute, so a row still 'active' 24 hours later is one no live path
  -- can advance. Refund rather than judge: nobody finished, so there is no
  -- winner to pay, and the entry fees are still sitting debited.
  --
  -- Bot seats are skipped — the house stands their entry, so crediting a bot
  -- wallet would mint coins that no player ever paid in. The refund key matches
  -- opLeave's, making this mutually idempotent with a player who taps Leave at
  -- the same moment. `payout_done` guards a game that somehow paid out already.
  for dead in
    select id, stake, atomic_quick
      from games
     where status = 'active'
       and not payout_done
       and updated_at < now() - interval '24 hours'
     for update skip locked
  loop
    if dead.atomic_quick and dead.stake > 0 then
      perform refund_quick_entries(dead.id, null);
    elsif dead.stake > 0 then
      perform wallet_apply(
        p.user_id, dead.stake, 'stake-refund', dead.id,
        'earned', 'leave-refund:' || dead.id::text || ':' || p.user_id::text
      )
      from players p
      where p.game_id = dead.id
        and not exists (
          select 1 from game_bots b
           where b.game_id = dead.id and b.user_id = p.user_id
        );
    end if;
    delete from games where id = dead.id;
  end loop;

  -- 4. Finished games. `players` and `moves` cascade from here (0001), and
  --    player_stats already holds the permanent record of who won what, so the
  --    snapshot itself is what goes. Cut from 60 days to 7: nothing in the app
  --    reads a finished game back — there is no match history screen, and the
  --    Stats screen is device-local — so the only consumer is a support
  --    question asked within the week. Rematch reuses a live row, not a reaped
  --    one, so this cannot break a rematch.
  delete from games
   where status = 'finished'
     and payout_done and stats_done
     and updated_at < now() - interval '7 days';

  -- 5. Move logs. Cut from 30 days to 24 hours. `moves` has no SELECT anywhere
  --    in the codebase and is not in the realtime publication, so nothing reads
  --    it live or later; at 30 days it was the largest table in the database
  --    purely to hold rows nobody would ever look at. A day is enough to debug
  --    a game someone is still complaining about, and rematches (which keep a
  --    room alive indefinitely) no longer accumulate a month of history.
  delete from moves
   where created_at < now() - interval '24 hours';

  -- 6. Rate-limit counters. rate_limit_hit keys on date_trunc('hour', now()),
  --    so any window older than a couple of hours can never be incremented or
  --    read again — it was pure accumulation, one row per user per bucket per
  --    hour, forever.
  delete from rate_limits
   where window_start < now() - interval '2 hours';

  -- 7. Spent rewarded-ad intents. The grant itself lives in wallet_txns /
  --    gem_txns under its own ext_id; this table is only the in-flight
  --    handshake, and a week-old handshake is closed either way.
  delete from ad_rewards
   where created_at < now() - interval '7 days';
end;
$function$;
