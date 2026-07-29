-- Server-visible match record, so a public profile can show one.
--
-- Until now stats were device-local only (apps/mobile/src/store/statsStore.ts),
-- which is fine for your own stats screen and useless for anyone else's.
--
-- OWNERSHIP SPLIT: statsStore keys totals by 'ai' | 'pass' | 'online', and AI
-- and pass-and-play never touch the server — so this table IS the 'online'
-- total by definition. Server owns online, device owns ai/pass. The public
-- profile shows only the online record and says so.
--
-- Edge function (service role) writes; everyone reads.

-- ---------------------------------------------------------------------------
-- player_stats
--
-- Deliberately NOT columns on profiles: profiles has a "self update" policy
-- (0003:26), so win counts living there would be client-writable — a player
-- could simply set their own record.
-- ---------------------------------------------------------------------------
create table if not exists public.player_stats (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  games_played int not null default 0 check (games_played >= 0),
  games_won    int not null default 0 check (games_won >= 0),
  last_played_at timestamptz,
  updated_at   timestamptz not null default now()
);

alter table public.player_stats enable row level security;

-- Public: this is what a friend's profile card reads. Only the aggregate is
-- exposed — the UI shows "played / won" and never states a loss count.
drop policy if exists "player_stats: read" on public.player_stats;
create policy "player_stats: read"
  on public.player_stats for select to authenticated using (true);
-- no write policies: edge function (service role) only

drop trigger if exists player_stats_touch_updated_at on public.player_stats;
create trigger player_stats_touch_updated_at
  before update on public.player_stats
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Exactly-once latch, mirroring games.payout_done (0010). Racing finisher
-- paths — opTurn, the bot driver, leave, timeout — all collapse to one write.
-- ---------------------------------------------------------------------------
alter table public.games add column if not exists stats_done boolean not null default false;

-- Record one finished game for every seat at once.
--
-- `select distinct` is load-bearing: `on conflict` raises "cannot affect row a
-- second time" if the same uid appears twice in one statement, which a rematch
-- loop or a malformed players array can produce.
create or replace function public.stats_record(p_user_ids uuid[], p_winner uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into player_stats (user_id, games_played, games_won, last_played_at)
  select distinct u,
         1,
         case when u = p_winner then 1 else 0 end,
         now()
    from unnest(p_user_ids) as u
  on conflict (user_id) do update
    set games_played   = player_stats.games_played + excluded.games_played,
        games_won      = player_stats.games_won + excluded.games_won,
        last_played_at = excluded.last_played_at;
$$;

revoke all on function public.stats_record(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.stats_record(uuid[], uuid) to service_role;
