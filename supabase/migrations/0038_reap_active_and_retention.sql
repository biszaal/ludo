-- Reap abandoned ACTIVE games, and stop keeping data nothing reads.
--
-- Two problems, one reaper.
--
-- 1. `reap_stale_games` only ever looked at 'waiting' and 'finished' rows, and
--    the 0034 tick only drives 'active' rows that have a turn_deadline. An
--    active row with a null deadline was therefore invisible to both: this
--    database held one active since 22 June. Worse, a table whose humans had
--    all quit kept its bots playing each other under the tick — one ran for
--    1.5 days and wrote 5,567 move rows. The engine and the tick now end those
--    tables themselves; this pass is the backstop for anything that still gets
--    stranded, and the only thing that can reach a null-deadline row.
--
-- 2. Retention was set when the tables were small and speculative. `moves` is
--    now 11 MB of a 36 MB database and has no reader anywhere in the codebase
--    (0021 said as much and kept 30 days anyway); finished game snapshots are
--    likewise never read back, with player_stats holding the permanent record.
--    rate_limits and ad_rewards had no cleanup at all.
--
-- What is deliberately NOT trimmed: wallet_txns, gem_txns and iap_purchases.
-- Those are the money ledgers — the only record that can answer "where did my
-- coins go" or back a chargeback — and they are small.

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
    select id, stake
      from games
     where status = 'active'
       and not payout_done
       and updated_at < now() - interval '24 hours'
     for update skip locked
  loop
    if dead.stake > 0 then
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
$$;

revoke all on function public.reap_stale_games() from public, anon, authenticated;

-- Supports pass 3. Partial on status so it stays tiny — active rows are the
-- rare case, and this index is only ever scanned by the reaper.
create index if not exists games_active_updated_idx
  on public.games (updated_at)
  where status = 'active';

-- Supports passes 6 and 7, which would otherwise seq-scan every five minutes.
create index if not exists rate_limits_window_idx on public.rate_limits (window_start);
create index if not exists ad_rewards_created_idx on public.ad_rewards (created_at);
