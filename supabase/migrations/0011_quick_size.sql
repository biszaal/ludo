-- Quick match sizes: the searcher chooses a 2-player (1v1) or 4-player room.
-- Rooms carry their target size; the matchmaking pools are separated by it, so
-- a 1v1 searcher never lands in a 4-player room. The claim seats the caller and
-- reports how full the room now is — the edge function starts it when full (or
-- bot-fills the rest after the client's wait window).

alter table public.games add column if not exists quick_size int not null default 2
  check (quick_size in (2, 4));

-- The old 2-only claim is superseded (drop by exact signature — Postgres
-- overloads functions by argument list).
drop function if exists public.quick_match_claim(uuid);

-- Atomically claim a seat in the oldest open quick game OF THIS SIZE: the row
-- lock plus the seat insert happen in one transaction, so two simultaneous
-- searchers can never both create fresh rooms (one claims, the other misses
-- and creates). Colors follow the room size: 1v1 seats diagonally opposed
-- (red/yellow), 4-player rooms seat clockwise (red/green/yellow/blue) —
-- mirrors seatColors in the engine/client.
-- Returns {game_id, player_id, seated} or null when no open game exists.
create or replace function public.quick_match_claim(p_user uuid, p_size int)
returns jsonb
language plpgsql
security definer
set search_path = public
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

revoke all on function public.quick_match_claim(uuid, int) from public, anon, authenticated;
grant execute on function public.quick_match_claim(uuid, int) to service_role;
