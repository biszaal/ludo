-- Deploy before the matching game function. Drain staked friend-room starts
-- during cutover: old workers still use the old debit/refund sequence.
-- Additive; do not reset historical payout flags or rewrite old ledgers here.

-- Serialize seat insertion with a deal. A caller that read 'waiting' before
-- another request started the match must not insert a new seat afterwards.
create or replace function public.require_waiting_game_for_seat()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare game_status text;
begin
  select status into game_status from games where id = new.game_id for update;
  if game_status is distinct from 'waiting' then
    raise exception 'That room is no longer open.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger players_require_waiting_game
  before insert on public.players
  for each row execute function public.require_waiting_game_for_seat();
revoke all on function public.require_waiting_game_for_seat() from public, anon, authenticated;

-- The engine prepares the state; SQL commits it together with ALL stakes.
-- Only the service role may provide that state. The server has already checked
-- host authorization; the database rechecks the version and exact seated users.
create or replace function public.deal_staked_room(
  p_game uuid, p_version bigint, p_state jsonb,
  p_deadline timestamptz, p_fold_writes boolean
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  g games%rowtype;
  roster jsonb;
  expected_roster jsonb;
  seat_row record;
  balance_after int;
begin
  select * into g from games where id = p_game for update;
  if not found then return jsonb_build_object('error', 'Game not found.'); end if;
  if g.status <> 'waiting' or g.state_version <> p_version then
    if g.state is not null then
      return jsonb_build_object('state', g.state, 'v', g.state_version, 'started', false);
    end if;
    return jsonb_build_object('error', 'The room changed. Try starting again.');
  end if;
  if g.is_quick or g.stake <= 0 then
    return jsonb_build_object('error', 'This room does not require stake collection.');
  end if;
  if p_state is null or p_state->>'gameId' is distinct from p_game::text
     or p_state->>'status' is distinct from 'active'
     or jsonb_typeof(p_state->'players') is distinct from 'array' then
    raise exception 'Invalid initial game state';
  end if;

  -- Lock existing seats against deletion while collecting. New inserts take
  -- the games-row lock in the trigger above, so the roster cannot grow here.
  perform id from players where game_id = p_game order by id for update;
  select jsonb_agg(jsonb_build_object('id', id::text, 'userId', user_id::text) order by seat)
    into roster from players where game_id = p_game;
  select jsonb_agg(jsonb_build_object('id', p->>'id', 'userId', p->>'userId') order by n)
    into expected_roster
    from jsonb_array_elements(p_state->'players') with ordinality as x(p, n);
  if jsonb_array_length(p_state->'players') not between 2 and 4
     or roster is distinct from expected_roster then
    return jsonb_build_object('error', 'The seats changed. Try starting again.');
  end if;

  -- A legacy attempt may have refunded a debit whose key is still present, or
  -- died before refunding it. Refuse ambiguous rooms; reconcile their history
  -- during cutover instead of guessing whether another charge is safe.
  if exists (select 1 from wallet_txns where game_id = p_game
             and ext_id like 'room-stake:%') then
    return jsonb_build_object('error', 'Reopen this room before playing for coins.');
  end if;

  -- Deterministic wallet order limits deadlocks when users share other rooms.
  -- An exception aborts this entire subtransaction, including earlier debits.
  begin
    for seat_row in
      select p.user_id from players p
       where p.game_id = p_game
         and not exists (select 1 from game_bots b
                         where b.game_id = p_game and b.user_id = p.user_id)
       order by p.user_id
    loop
      -- wallet_apply reads earned/purchased funds before updating the balance.
      -- Hold the wallet lock across that read even when another room is paying
      -- or charging the same account concurrently.
      insert into wallets(user_id) values (seat_row.user_id) on conflict (user_id) do nothing;
      perform user_id from wallets where user_id = seat_row.user_id for update;
      balance_after := public.wallet_apply(seat_row.user_id, -g.stake, 'stake', p_game,
        'earned', 'room-start:' || p_game || ':' || seat_row.user_id);
      if balance_after is null then
        raise exception 'insufficient funds' using errcode = 'LD001';
      end if;
    end loop;

    update games set state = p_state, status = 'active',
      current_turn_player_id = p_state->>'currentTurnPlayerId',
      turn_deadline = p_deadline, state_version = g.state_version + 1,
      fold_writes = p_fold_writes
      where id = p_game;
  exception when sqlstate 'LD001' then
    return jsonb_build_object('error', 'A player does not have enough coins for this pot.');
  end;
  return jsonb_build_object('state', p_state, 'v', g.state_version + 1, 'started', true);
end;
$$;

revoke all on function public.deal_staked_room(uuid, bigint, jsonb, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.deal_staked_room(uuid, bigint, jsonb, timestamptz, boolean)
  to service_role;

-- Settlement reads the durable result under a row lock. A failed credit or
-- stats write rolls back every new credit and both completion flags. Existing
-- win:<game>:<place> keys remain compatible with already-issued partial payouts.
create or replace function public.settle_finished_game(p_game uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  g games%rowtype;
  standings jsonb;
  weights int[];
  shares int[] := '{}';
  total_weight int;
  pot int;
  allocated int := 0;
  i int;
  seat_id text;
  recipient uuid;
  winner uuid;
  user_ids uuid[];
  balance_after int;
begin
  select * into g from games where id = p_game for update;
  if not found or g.status <> 'finished' or g.state is null then return false; end if;
  if g.state->>'status' is distinct from 'finished' then
    raise exception 'Finished game has inconsistent state';
  end if;
  standings := coalesce(g.state->'finishedOrder', '[]'::jsonb);
  if jsonb_array_length(standings) = 0 and g.state->>'winnerPlayerId' is not null then
    standings := jsonb_build_array(g.state->>'winnerPlayerId');
  end if;

  if not g.payout_done then
    if g.stake > 0 then
      weights := case jsonb_array_length(g.state->'players')
        when 2 then array[1] when 3 then array[2,1] when 4 then array[5,2,1]
        else null end;
      if weights is null then raise exception 'Invalid payout seat count'; end if;
      pot := g.stake * jsonb_array_length(g.state->'players');
      select sum(w) into total_weight from unnest(weights) w;
      for i in 1..array_length(weights, 1) loop
        shares := array_append(shares, (pot::bigint * weights[i] / total_weight)::int);
        allocated := allocated + shares[i];
      end loop;
      shares[1] := shares[1] + pot - allocated;
      -- Lock all participating wallets in user order before paying place order.
      perform w.user_id from wallets w
        where w.user_id in (select (p->>'userId')::uuid
          from jsonb_array_elements(g.state->'players') p)
        order by w.user_id for update;
      for i in 1..array_length(shares, 1) loop
        seat_id := standings->>(i - 1);
        if seat_id is null then continue; end if;
        select (p->>'userId')::uuid into recipient
          from jsonb_array_elements(g.state->'players') p where p->>'id' = seat_id;
        if recipient is null or exists (select 1 from game_bots
          where game_id = p_game and user_id = recipient) then continue; end if;
        balance_after := public.wallet_apply(recipient, shares[i], 'win', p_game,
          'earned', 'win:' || p_game || ':' || (i - 1));
        if balance_after is null then raise exception 'Payout could not be credited'; end if;
      end loop;
    end if;
    update games set payout_done = true where id = p_game;
  end if;

  if not g.stats_done then
    select array_agg(distinct (p->>'userId')::uuid) filter (where p->>'userId' is not null)
      into user_ids from jsonb_array_elements(g.state->'players') p;
    select (p->>'userId')::uuid into winner
      from jsonb_array_elements(g.state->'players') p where p->>'id' = standings->>0;
    if coalesce(array_length(user_ids, 1), 0) > 0 then
      perform public.stats_record(user_ids, winner);
    end if;
    update games set stats_done = true where id = p_game;
  end if;
  return true;
end;
$$;

revoke all on function public.settle_finished_game(uuid) from public, anon, authenticated;
grant execute on function public.settle_finished_game(uuid) to service_role;

create index if not exists games_unsettled_result_idx on public.games (updated_at)
  where status = 'finished' and (payout_done = false or stats_done = false);

-- Wake recovery for unpaid rewards OR missing statistics. Preserve gateway auth.
create or replace function public.tick_games()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  fn_url  text;
  fn_key  text;
  fn_auth text;
begin
  -- Keep the wake-up predicate aligned with tick.ts, including free-game stats.
  if not exists (
        select 1 from games
         where status = 'active'
           and turn_deadline is not null
           and turn_deadline < now() - interval '15 seconds'
      )
     and not exists (
        select 1 from games
         where status = 'finished'
           and (payout_done = false or stats_done = false)
      )
  then
    return;
  end if;

  select value into fn_url  from internal_config where key = 'tick_url';
  select value into fn_key  from internal_config where key = 'tick_secret';
  select value into fn_auth from internal_config where key = 'tick_auth_key';
  -- Not configured yet (or a local stack) -- nothing to do, and nothing broken.
  -- fn_auth is in this test deliberately: without it the POST is a guaranteed
  -- 401, so a missing key must mean "do not call", not "call and be rejected".
  if fn_url is null or fn_key is null or fn_auth is null then
    return;
  end if;

  -- Fire and forget. pg_net queues the request and returns immediately, so a
  -- slow or unreachable edge function can never hold the cron worker open.
  --
  -- Note this means a REJECTED request is silent here too: check
  -- net._http_response, not cron.job_run_details, to see whether a tick landed.
  perform net.http_post(
    url     := fn_url,
    headers := jsonb_build_object(
                 'Content-Type',   'application/json',
                 'Authorization',  'Bearer ' || fn_auth,
                 'x-tick-secret',  fn_key
               ),
    body    := jsonb_build_object('op', 'tick'),
    timeout_milliseconds := 20000
  );
end;
$$;

revoke all on function public.tick_games() from public, anon, authenticated;

-- Retain unfinished settlement evidence until recovery succeeds.
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
