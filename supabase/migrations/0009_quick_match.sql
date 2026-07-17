-- Quick match: a "play online" queue that pairs two searchers into a game, and
-- the hidden-bot machinery that fills a lonely queue after a short wait.
--
-- Secrecy constraint: `games` and `players` are client-readable, so NOTHING in
-- them may say "bot". Bot-ness lives in `game_bots`/`bot_identities`, which
-- have RLS enabled and NO policies — visible only to the service role (the
-- edge function). Bots are real auth users with ordinary `profiles` rows, so
-- clients resolve their names/avatars exactly like a human's.

alter table public.games add column if not exists is_quick boolean not null default false;

-- Fast scan for the claim: only waiting quick games matter.
create index if not exists games_quick_waiting_idx
  on public.games (created_at) where is_quick and status = 'waiting';

-- Which seats in a game are server-driven. Service-role only.
create table if not exists public.game_bots (
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null,
  primary key (game_id, user_id)
);
alter table public.game_bots enable row level security;

-- Reusable bot identities (real auth.users rows, provisioned lazily by the
-- edge function). `in_use_game_id` keeps one identity out of two concurrent
-- games. Service-role only.
create table if not exists public.bot_identities (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  in_use_game_id uuid references public.games(id) on delete set null,
  created_at     timestamptz not null default now()
);
alter table public.bot_identities enable row level security;

-- Atomically claim a seat in the oldest open quick game: the row lock plus the
-- seat insert happen in one transaction, so two simultaneous searchers can
-- never both create fresh rooms (one claims, the other misses and creates).
-- Returns {game_id, player_id} or null when no open game exists.
create or replace function public.quick_match_claim(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g_id uuid;
  pl_id uuid;
begin
  select g.id into g_id
    from games g
   where g.is_quick
     and g.status = 'waiting'
     and not exists (select 1 from players p where p.game_id = g.id and p.user_id = p_user)
     and (select count(*) from players p where p.game_id = g.id) < 2
   order by g.created_at
   limit 1
   for update skip locked;
  if g_id is null then
    return null;
  end if;
  insert into players (game_id, user_id, color, seat)
    values (g_id, p_user, 'yellow', 1)  -- 2-player quick match: red/yellow diagonal
    returning id into pl_id;
  return jsonb_build_object('game_id', g_id, 'player_id', pl_id);
end;
$$;

-- Atomically claim a free bot identity for a game (random pick so repeat
-- searchers don't always meet the same "player"). Null when the pool is empty.
create or replace function public.claim_bot_identity(p_game uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  b_id uuid;
begin
  select user_id into b_id
    from bot_identities
   where in_use_game_id is null
   order by random()
   limit 1
   for update skip locked;
  if b_id is null then
    return null;
  end if;
  update bot_identities set in_use_game_id = p_game where user_id = b_id;
  return b_id;
end;
$$;

-- The claim functions run with definer rights; only the edge function (service
-- role) may call them.
revoke all on function public.quick_match_claim(uuid) from public, anon, authenticated;
revoke all on function public.claim_bot_identity(uuid) from public, anon, authenticated;
grant execute on function public.quick_match_claim(uuid) to service_role;
grant execute on function public.claim_bot_identity(uuid) to service_role;
