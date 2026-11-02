-- Online Blitz: a game's mode, and matchmaking pools split by it.
--
-- Blitz itself lives in the game state (rules.tokensToWin), which is what the
-- engine reads. This column exists for the time BEFORE there is a state: a
-- waiting room has to remember what it is going to deal, and quick match has to
-- pool by it. Rematches read the mode off the previous state, not from here.
--
-- ORDER: apply this BEFORE deploying the function that reads games.mode (deal.ts,
-- room.ts, quick.ts). Old function + this migration is fully safe: the old code
-- calls the 3-arg claim, which from here on claims classic rooms only, and every
-- row it writes takes the classic default. The other way round breaks every deal.

alter table public.games
  add column if not exists mode text not null default 'classic';

alter table public.games
  drop constraint if exists games_mode_check;
alter table public.games
  add constraint games_mode_check check (mode in ('classic', 'blitz'));

-- Same claim as 0018, plus the pool. No default on p_mode, deliberately: with a
-- default, a 3-arg call matches both overloads and PostgREST cannot pick one.
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
   where g.is_quick
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

drop index if exists public.games_quick_pool_idx;
create index if not exists games_quick_pool_idx
  on public.games (quick_size, stake, mode) where status = 'waiting' and is_quick;

-- Off until the deployed function has been smoke-tested: a client reading this
-- as true against the old function would ask for Blitz and silently get classic.
update public.app_config
   set value = jsonb_set(value, '{modes}', '{"blitzOnline": false}'::jsonb, true),
       updated_at = now()
 where key = 'default';
