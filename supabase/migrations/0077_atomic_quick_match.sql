-- Apply after 0076. Drain legacy quick queues and old workers before cutover.
-- Updated clients send a request key; old clients receive an upgrade message.
alter table public.games add column atomic_quick boolean not null default false;

-- No game/seat FK: cancellation deletes those rows, but replay and refund
-- evidence must survive. These service-only records contain no public API data.
create table public.quick_entries (
  player_id uuid primary key,
  game_id uuid not null,
  user_id uuid not null,
  amount int not null check(amount > 0),
  purchased_spent int not null check(purchased_spent >= 0 and purchased_spent <= amount),
  refunded boolean not null default false,
  created_at timestamptz not null default now()
);
create index quick_entries_game_idx on public.quick_entries(game_id, user_id);
create table public.quick_match_requests (
  user_id uuid not null,
  request_key text not null check(length(request_key) between 8 and 128),
  game_id uuid not null,
  player_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(user_id, request_key)
);
alter table public.quick_entries enable row level security;
alter table public.quick_match_requests enable row level security;
revoke all on public.quick_entries, public.quick_match_requests from public, anon, authenticated;
grant all on public.quick_entries, public.quick_match_requests to service_role;

create function public.quick_match_enter(p_user uuid, p_size int, p_stake int, p_mode text,
  p_app_version text, p_request text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  g games%rowtype;
  prior quick_match_requests%rowtype;
  pid uuid;
  chair int;
  purchased_before int;
  purchased_after int;
  balance_after int;
  attempt int;
begin
  if p_size not in (2,4) or p_stake <= 0 or p_mode not in ('classic','blitz')
     or p_request is null or length(p_request) not between 8 and 128 then
    raise exception 'Invalid matchmaking request';
  end if;
  -- Serializes multiple devices searching on the same account.
  perform pg_advisory_xact_lock(hashtextextended('quick-user:' || p_user, 0));
  select * into prior from quick_match_requests where user_id=p_user and request_key=p_request;
  if found then
    select * into g from games where id=prior.game_id for update;
    if not found or not exists(select 1 from players where id=prior.player_id and game_id=g.id) then
      return jsonb_build_object('error','That search has ended. Start a new search.');
    end if;
    pid := prior.player_id;
  else
    -- A new tap while seated also resumes that room instead of charging again.
    select games.* into g from games join players p on p.game_id=games.id
      where p.user_id=p_user and games.is_quick and
      (games.status='waiting' or (games.status='active' and exists(
        select 1 from jsonb_array_elements(games.state->'players') s
          where s->>'userId'=p_user::text and coalesce((s->>'hasLeft')::boolean,false)=false)))
      order by games.created_at desc limit 1 for update of games;
    if found then
      if not g.atomic_quick then
        return jsonb_build_object('error','Finish or cancel your previous match before searching again.');
      end if;
      select id into pid from players where game_id=g.id and user_id=p_user;
    else
      -- Pool lock also covers the empty-pool case, so simultaneous arrivals do
      -- not each create an isolated room. Lock order: pool -> game -> wallets.
      perform pg_advisory_xact_lock(hashtextextended('quick-pool:' || p_size || ':' || p_stake || ':' || p_mode,0));
      select * into g from games where is_quick and atomic_quick and status='waiting'
        and quick_size=p_size and stake=p_stake and mode=p_mode
        and (select count(*) from players where game_id=games.id)<p_size
        order by created_at limit 1 for update;
      if not found then
        for attempt in 1..8 loop
          begin
            insert into games(room_code,host_user_id,is_quick,atomic_quick,quick_size,stake,mode)
              values((select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',1+floor(random()*31)::int,1),'') from generate_series(1,4)),p_user,true,true,p_size,p_stake,p_mode)
              returning * into g;
            exit;
          exception when unique_violation then
            if attempt=8 then raise; end if;
          end;
        end loop;
      end if;
      select n into chair from generate_series(0,p_size-1) n
        where not exists(select 1 from players where game_id=g.id and seat=n) order by n limit 1;
      if chair is null then raise exception 'Queue is full'; end if;
      insert into players(game_id,user_id,color,seat,is_host,app_version)
        values(g.id,p_user,case when p_size=2 then (array['red','yellow'])[chair+1]
          else (array['red','green','yellow','blue'])[chair+1] end,chair,g.host_user_id=p_user,p_app_version)
        returning id into pid;
      insert into wallets(user_id) values(p_user) on conflict do nothing;
      select purchased_balance into purchased_before from wallets where user_id=p_user for update;
      balance_after := wallet_apply(p_user,-p_stake,'stake',g.id,'earned','quick-entry:' || pid);
      if balance_after is null then raise exception 'Not enough coins for this match.' using errcode='LD002'; end if;
      select purchased_balance into purchased_after from wallets where user_id=p_user;
      insert into quick_entries(player_id,game_id,user_id,amount,purchased_spent)
        values(pid,g.id,p_user,p_stake,purchased_before-purchased_after);
      update games set state_version=state_version+1 where id=g.id returning * into g;
    end if;
    insert into quick_match_requests(user_id,request_key,game_id,player_id) values(p_user,p_request,g.id,pid);
  end if;
  return jsonb_build_object('gameId',g.id,'playerId',pid,'waiting',g.status='waiting',
    'state',g.state,'v',g.state_version,'size',g.quick_size,'stake',g.stake,'mode',g.mode,
    'seated',(select count(*) from players where game_id=g.id));
end;
$$;
revoke all on function public.quick_match_enter(uuid,int,int,text,text,text) from public,anon,authenticated;
grant execute on function public.quick_match_enter(uuid,int,int,text,text,text) to service_role;

-- Caller holds the game lock. Refund only durable funded entries; restore the
-- earned/purchased split rather than turning purchased coins into earned coins.
create function public.refund_quick_entries(p_game uuid,p_user uuid default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e quick_entries%rowtype; b int;
begin
  for e in select * from quick_entries where game_id=p_game and not refunded
    and (p_user is null or user_id=p_user) order by user_id,player_id for update
  loop
    if e.amount>e.purchased_spent then
      b:=wallet_apply(e.user_id,e.amount-e.purchased_spent,'stake-refund',p_game,'earned','quick-refund:'||e.player_id||':earned');
      if b is null then raise exception 'Refund failed'; end if;
    end if;
    if e.purchased_spent>0 then
      b:=wallet_apply(e.user_id,e.purchased_spent,'stake-refund',p_game,'purchased','quick-refund:'||e.player_id||':purchased');
      if b is null then raise exception 'Refund failed'; end if;
    end if;
    update quick_entries set refunded=true where player_id=e.player_id;
  end loop;
end;
$$;
revoke all on function public.refund_quick_entries(uuid,uuid) from public,anon,authenticated,service_role;
-- Internal helper: even service callers use the status-checking cancel RPC.

create function public.cancel_quick_match(p_game uuid,p_user uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare g games%rowtype;
begin
  select * into g from games where id=p_game for update;
  if not found then return jsonb_build_object('cancelled',true); end if;
  if not g.atomic_quick or not g.is_quick then raise exception 'Not an atomic quick room'; end if;
  if not exists(select 1 from players where game_id=p_game and user_id=p_user) then
    return jsonb_build_object('cancelled',true);
  end if;
  if g.status<>'waiting' then
    return jsonb_build_object('cancelled',false,'state',g.state,'v',g.state_version);
  end if;
  if g.host_user_id=p_user then
    perform refund_quick_entries(p_game,null);
    delete from games where id=p_game;
  else
    perform refund_quick_entries(p_game,p_user);
    delete from players where game_id=p_game and user_id=p_user;
    update games set state_version=state_version+1 where id=p_game;
  end if;
  return jsonb_build_object('cancelled',true);
end;
$$;
revoke all on function public.cancel_quick_match(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_quick_match(uuid,uuid) to service_role;

create function public.deal_quick_room(p_game uuid,p_version bigint,p_state jsonb,p_deadline timestamptz,p_fold_writes boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare g games%rowtype; roster jsonb; expected jsonb;
begin
  select * into g from games where id=p_game for update;
  if not found then return jsonb_build_object('error','That search has ended.'); end if;
  if g.status<>'waiting' then return jsonb_build_object('state',g.state,'v',g.state_version,'started',false); end if;
  if not g.atomic_quick or not g.is_quick then raise exception 'Not an atomic quick room'; end if;
  if g.state_version<>p_version then return jsonb_build_object('error','The seats changed. Try again.'); end if;
  if p_state->>'gameId' is distinct from p_game::text or p_state->>'status' is distinct from 'active'
    or jsonb_typeof(p_state->'players') is distinct from 'array' then raise exception 'Invalid state'; end if;
  perform id from players where game_id=p_game order by id for update;
  select jsonb_agg(jsonb_build_object('id',id::text,'userId',user_id::text) order by seat) into roster from players where game_id=p_game;
  select jsonb_agg(jsonb_build_object('id',p->>'id','userId',p->>'userId') order by n) into expected
    from jsonb_array_elements(p_state->'players') with ordinality as x(p,n);
  if jsonb_array_length(p_state->'players')<>g.quick_size or roster is distinct from expected then
    return jsonb_build_object('error','The seats changed. Try again.');
  end if;
  if exists(select 1 from players p where p.game_id=p_game
    and not exists(select 1 from game_bots b where b.game_id=p_game and b.user_id=p.user_id)
    and not exists(select 1 from quick_entries e where e.player_id=p.id and e.game_id=p_game
      and e.user_id=p.user_id and e.amount=g.stake and not e.refunded)) then
    raise exception 'An unfunded seat cannot start';
  end if;
  update games set state=p_state,status='active',current_turn_player_id=p_state->>'currentTurnPlayerId',
    turn_deadline=p_deadline,state_version=state_version+1,fold_writes=p_fold_writes where id=p_game returning * into g;
  return jsonb_build_object('state',g.state,'v',g.state_version,'started',true);
end;
$$;
revoke all on function public.deal_quick_room(uuid,bigint,jsonb,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.deal_quick_room(uuid,bigint,jsonb,timestamptz,boolean) to service_role;

-- Register labelled bots in the same transaction as their seat. A failed second
-- HTTP insert must not leave a bot that looks like an unfunded human to the deal.
create function public.register_labelled_bot_seat()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.is_bot then
    insert into game_bots(game_id,user_id,can_chat) values(new.game_id,new.user_id,false) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger players_register_labelled_bot after insert on public.players
  for each row execute function public.register_labelled_bot_seat();
revoke all on function public.register_labelled_bot_seat() from public,anon,authenticated;

-- Old workers must never claim an atomically funded queue.
create or replace function public.quick_match_claim(p_user uuid, p_size int, p_stake int, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g_id uuid;
  pl_id uuid;
  seat_no int;
  seat_color text;
begin
  select g.id into g_id
    from games g
   where g.is_quick and not g.atomic_quick
     and g.status = 'waiting'
     and g.quick_size = p_size
     and g.stake = p_stake
     and g.mode = p_mode
     and not exists (select 1 from players p where p.game_id = g.id and p.user_id = p_user)
     and (select count(*) from players p where p.game_id = g.id) < p_size
   order by g.created_at
   limit 1
   for update skip locked;
  if g_id is null then
    return null;
  end if;

  select count(*) into seat_no from players p where p.game_id = g_id;
  seat_color := case
    when p_size = 2 then (case seat_no when 0 then 'red' else 'yellow' end)
    else (array['red', 'green', 'yellow', 'blue'])[seat_no + 1]
  end;

  insert into players (game_id, user_id, color, seat)
    values (g_id, p_user, seat_color, seat_no)
    returning id into pl_id;
  return jsonb_build_object('game_id', g_id, 'player_id', pl_id, 'seated', seat_no + 1);
end;
$$;

-- The 3-arg form becomes classic-only. Left as it was, it would seat an old
-- client (or the old function) in a Blitz room, whose rules its engine does not
-- know. This is the whole of what keeps old apps out of the Blitz pool.
create or replace function public.quick_match_claim(p_user uuid, p_size int, p_stake int)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.quick_match_claim(p_user, p_size, p_stake, 'classic');
$$;

-- EXECUTE arrives via a default grant to PUBLIC (see 0024), so a new signature
-- has to be locked down by hand. The replaced 3-arg form keeps its grants.
revoke all on function public.quick_match_claim(uuid, int, int, text) from public, anon, authenticated;
grant execute on function public.quick_match_claim(uuid, int, int, text) to service_role;


-- Queue expiry and abandoned games use the same durable refund entries.
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

-- Disclose already-seated computer opponents too; game rules do not change.
update public.players p set is_bot=true from public.game_bots b
 where p.game_id=b.game_id and p.user_id=b.user_id and not p.is_bot;
update public.game_bots set can_chat=false where can_chat;
