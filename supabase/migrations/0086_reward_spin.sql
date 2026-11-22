-- 0086: reward spin, phase 1.
--
-- A prize wheel aimed at getting new players through their first game and back
-- the next day (design: docs/superpowers/specs/2026-11-22-reward-spin-design.md).
-- Three ways to earn a spin:
--
--   daily  once a day, 00:00 UTC reset (the daily bonus's day), wheel by streak
--   first  once per account, after at least one played game
--   match  one per online game finished today while still seated, max 3 a day
--
-- Nothing is granted when a game ends. What a player is owed is DERIVED here
-- from records that already exist (player_stats, today's finished games, this
-- log), so the end-of-match payout path is untouched and a spin can never be
-- lost to a failed write. The prize is picked and paid in the same transaction
-- as the eligibility check (spin_claim).
--
-- Ships switched off: spin.enabled = false in app_config, plus an allowlist for
-- test accounts. This migration is safe to run twice.

-- ---------------------------------------------------------------------------
-- The log: one row per spin taken
-- ---------------------------------------------------------------------------
create table if not exists public.spin_log (
  id            bigint generated always as identity primary key,
  user_id       uuid not null,
  day           date not null,
  source        text not null check (source in ('daily', 'first', 'match')),
  wheel         text not null check (wheel in ('bronze', 'silver', 'gold', 'firstGame')),
  table_version int  not null,
  segment       int  not null,
  coins         int  not null default 0,
  gems          int  not null default 0,
  request_id    uuid not null,
  created_at    timestamptz not null default now()
);
-- No foreign key to auth.users, as with wallet_txns: the ledger outlives accounts.

-- A retried request finds its first answer instead of paying again.
create unique index if not exists spin_log_request_uidx on public.spin_log (user_id, request_id);
-- A race can never pay a daily or a first-game spin twice.
create unique index if not exists spin_log_daily_once on public.spin_log (user_id, day) where source = 'daily';
create unique index if not exists spin_log_first_once on public.spin_log (user_id) where source = 'first';
create index if not exists spin_log_user_day_idx on public.spin_log (user_id, day);

alter table public.spin_log enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'spin_log' and policyname = 'spin_log: read own'
  ) then
    create policy "spin_log: read own" on public.spin_log
      for select to authenticated using (user_id = auth.uid());
  end if;
end $$;
revoke all on public.spin_log from anon, authenticated;
grant select on public.spin_log to authenticated;

-- ---------------------------------------------------------------------------
-- Config: the spin block, seeded once into app_config.default
-- ---------------------------------------------------------------------------
-- Weights are per 1,000. Segment order is wheel order. The live app reads none
-- of this: the server sends each wheel's segments with spin_status, so the
-- drawn wheel and the odds screen always match what pays.
create or replace function public.spin_default_config()
returns jsonb
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select '{
    "enabled": false,
    "allowlistUserIds": [],
    "matchMaxPerDay": 3,
    "dailyCoinCap": 1500,
    "tiers": {"silverFromDay": 3, "goldFromDay": 7},
    "tableVersion": 1,
    "tables": {
      "bronze": [
        {"coins": 25, "w": 280}, {"coins": 50, "w": 300}, {"coins": 75, "w": 150},
        {"coins": 100, "w": 120}, {"coins": 150, "w": 70}, {"gems": 2, "w": 50},
        {"coins": 250, "w": 25}, {"coins": 500, "w": 4}, {"coins": 1000, "w": 1}
      ],
      "silver": [
        {"coins": 50, "w": 300}, {"coins": 75, "w": 220}, {"coins": 100, "w": 180},
        {"coins": 150, "w": 120}, {"gems": 2, "w": 80}, {"coins": 250, "w": 70},
        {"coins": 500, "w": 25}, {"coins": 1000, "w": 5}
      ],
      "gold": [
        {"coins": 100, "w": 300}, {"coins": 150, "w": 250}, {"coins": 200, "w": 180},
        {"gems": 5, "w": 120}, {"coins": 300, "w": 100}, {"coins": 500, "w": 40},
        {"coins": 1000, "w": 10}
      ],
      "firstGame": [
        {"coins": 100, "w": 400}, {"coins": 150, "w": 300}, {"coins": 200, "w": 200},
        {"gems": 5, "w": 80}, {"coins": 500, "w": 20}
      ]
    }
  }'::jsonb
$$;

-- Once: a later edit of the live block (enabling it, the allowlist) is never overwritten.
update public.app_config
   set value = jsonb_set(value, '{spin}', public.spin_default_config())
 where key = 'default' and value->'spin' is null;

create or replace function public.spin_config()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select value->'spin' from app_config where key = 'default'), '{}'::jsonb)
$$;

-- On for everyone, or for an allowlisted test account.
create or replace function public.spin_enabled(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(c->'enabled' = 'true'::jsonb, false)
      or coalesce(jsonb_typeof(c->'allowlistUserIds') = 'array' and c->'allowlistUserIds' ? p_user::text, false)
    from (select public.spin_config() as c) s
$$;

-- A wheel's segments in wheel order. With gems switched off, a gem prize is
-- shown and paid as its coin value, so what is drawn is what pays.
create or replace function public.spin_table(p_wheel text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with g as (
    select coalesce(value->'gems'->'enabled' = 'true'::jsonb, false) as gems_on,
           case when jsonb_typeof(value->'gems'->'exchangeRate') = 'number'
                 and (value->'gems'->>'exchangeRate')::numeric > 0
                then (value->'gems'->>'exchangeRate')::numeric::int else 10 end as rate
      from (select coalesce((select value from app_config where key = 'default'), '{}'::jsonb) as value) v
  )
  select coalesce(jsonb_agg(
           case when seg ? 'gems' and not g.gems_on
                then jsonb_build_object('coins', (seg->>'gems')::int * g.rate, 'w', (seg->>'w')::int)
                else seg end
           order by ord), '[]'::jsonb)
    from g,
         jsonb_array_elements(
           case when jsonb_typeof(public.spin_config()->'tables'->p_wheel) = 'array'
                then public.spin_config()->'tables'->p_wheel else '[]'::jsonb end
         ) with ordinality as t(seg, ord)
$$;

-- The daily-bonus streak as it stands today, whether or not today's bonus is
-- claimed yet (the same rule daily_bonus_claim applies).
create or replace function public.spin_effective_streak(p_user uuid, p_today date)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
             when w.last_bonus_on = p_today then greatest(w.streak_day, 1)
             when w.last_bonus_on = p_today - 1 then least(w.streak_day + 1, 7)
             else 1
           end
      from wallets w
     where w.user_id = p_user
  ), 1)
$$;

-- Online games finished today with this player still in them at the end. A
-- player who left (hasLeft) earns nothing from the game the others finished.
create or replace function public.spin_matches_finished(p_user uuid, p_today date)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(distinct g.id)::int
    from games g
   where g.status = 'finished'
     and (g.updated_at at time zone 'utc')::date = p_today
     and exists (
       select 1
         from jsonb_array_elements(
                case when jsonb_typeof(g.state->'players') = 'array' then g.state->'players' else '[]'::jsonb end
              ) p
        where p->>'userId' = p_user::text
          and coalesce(p->>'hasLeft', 'false') <> 'true'
     )
$$;

-- What this player is owed right now, and the wheel their next spin uses.
create or replace function public.spin_status(p_user uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg         jsonb := public.spin_config();
  today       date := (p_now at time zone 'utc')::date;
  first_state text;
  daily_owed  boolean;
  match_max   int;
  match_owed  int;
  streak      int;
  tier        text;
  next_source text;
  next_wheel  text;
begin
  if not public.spin_enabled(p_user) then
    return jsonb_build_object('enabled', false);
  end if;

  match_max := case when jsonb_typeof(cfg->'matchMaxPerDay') = 'number'
                    then (cfg->>'matchMaxPerDay')::int else 3 end;

  first_state := case
    when exists (select 1 from spin_log where user_id = p_user and source = 'first') then 'used'
    when coalesce((select games_played from player_stats where user_id = p_user), 0) >= 1 then 'owed'
    else 'locked'
  end;

  daily_owed := not exists (
    select 1 from spin_log where user_id = p_user and day = today and source = 'daily'
  );

  match_owed := greatest(0,
    least(match_max, public.spin_matches_finished(p_user, today))
    - (select count(*) from spin_log where user_id = p_user and day = today and source = 'match')::int);

  streak := public.spin_effective_streak(p_user, today);
  tier := case
    when streak >= coalesce((cfg->'tiers'->>'goldFromDay')::int, 7) then 'gold'
    when streak >= coalesce((cfg->'tiers'->>'silverFromDay')::int, 3) then 'silver'
    else 'bronze'
  end;

  if first_state = 'owed' then
    next_source := 'first';  next_wheel := 'firstGame';
  elsif daily_owed then
    next_source := 'daily';  next_wheel := tier;
  elsif match_owed > 0 then
    next_source := 'match';  next_wheel := 'bronze';
  end if;

  return jsonb_build_object(
    'enabled', true,
    'tableVersion', coalesce((cfg->>'tableVersion')::int, 1),
    'owed', jsonb_build_object('first', first_state, 'daily', daily_owed, 'match', match_owed),
    'matchMax', match_max,
    'tier', tier,
    'next', case when next_source is null then null
                 else jsonb_build_object('source', next_source, 'wheel', next_wheel,
                                         'segments', public.spin_table(next_wheel)) end,
    'resetsAt', to_char(today + 1, 'YYYY-MM-DD') || 'T00:00:00Z'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: the game function (service role) only
-- ---------------------------------------------------------------------------
revoke all on function public.spin_default_config() from public, anon, authenticated;
revoke all on function public.spin_config() from public, anon, authenticated;
revoke all on function public.spin_enabled(uuid) from public, anon, authenticated;
revoke all on function public.spin_table(text) from public, anon, authenticated;
revoke all on function public.spin_effective_streak(uuid, date) from public, anon, authenticated;
revoke all on function public.spin_matches_finished(uuid, date) from public, anon, authenticated;
revoke all on function public.spin_status(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.spin_default_config() to service_role;
grant execute on function public.spin_config() to service_role;
grant execute on function public.spin_enabled(uuid) to service_role;
grant execute on function public.spin_table(text) to service_role;
grant execute on function public.spin_effective_streak(uuid, date) to service_role;
grant execute on function public.spin_matches_finished(uuid, date) to service_role;
grant execute on function public.spin_status(uuid, timestamptz) to service_role;
