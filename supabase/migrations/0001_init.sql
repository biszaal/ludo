-- Ludo online multiplayer schema.
-- The `games.state` JSONB column holds the full engine GameState — the
-- authoritative snapshot every client rehydrates from. `players` tracks seats
-- (and lobby membership before a game starts); `moves` is an append-only audit log.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.games (
  id                     uuid primary key default gen_random_uuid(),
  room_code              text not null unique,
  host_user_id           uuid not null,
  status                 text not null default 'waiting'
                           check (status in ('waiting', 'active', 'finished')),
  state                  jsonb,
  current_turn_player_id text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table if not exists public.players (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  user_id      uuid not null,
  color        text not null check (color in ('red', 'green', 'yellow', 'blue')),
  seat         int  not null,
  is_host      boolean not null default false,
  is_connected boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (game_id, user_id),
  unique (game_id, color),
  unique (game_id, seat)
);

create table if not exists public.moves (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  player_id  text not null,
  action     jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists players_game_id_idx on public.players(game_id);
create index if not exists moves_game_id_idx on public.moves(game_id);

-- Keep games.updated_at fresh on every write.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists games_touch_updated_at on public.games;
create trigger games_touch_updated_at
  before update on public.games
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- MVP (Phase 3): any signed-in user (incl. anonymous) may read/write — access is
-- gated by knowing the room code. Phase 4 (Edge Functions) will tighten this to
-- "participants only" and move all writes server-side. See the plan's M4.
-- ---------------------------------------------------------------------------
alter table public.games   enable row level security;
alter table public.players enable row level security;
alter table public.moves   enable row level security;

create policy "games: authenticated read"   on public.games   for select to authenticated using (true);
create policy "games: authenticated insert" on public.games   for insert to authenticated with check (true);
create policy "games: authenticated update" on public.games   for update to authenticated using (true) with check (true);

create policy "players: authenticated read"   on public.players for select to authenticated using (true);
create policy "players: authenticated insert" on public.players for insert to authenticated with check (true);
create policy "players: authenticated update" on public.players for update to authenticated using (true) with check (true);

create policy "moves: authenticated read"   on public.moves for select to authenticated using (true);
create policy "moves: authenticated insert" on public.moves for insert to authenticated with check (true);

-- ---------------------------------------------------------------------------
-- Realtime — broadcast row changes so clients can rehydrate from games.state.
-- REPLICA IDENTITY FULL lets postgres_changes filters/payloads carry full rows.
-- ---------------------------------------------------------------------------
alter table public.games   replica identity full;
alter table public.players replica identity full;

alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.players;
