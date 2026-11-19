-- 0082: the referral programme (growth plan step 3).
--
-- Design: docs/superpowers/specs/2026-11-19-referral-programme-design.md
--
-- A player who brings a friend gets coins, but only once the friend has shown
-- they will stay: 2 finished online games, and activity on a later Nepal day
-- than the one they signed up on, at least 8 hours after signing up. Most new
-- players never come back, so paying at install would mostly pay for people
-- who leave, and would be trivial to farm. The 8 hours stop a sign-up at
-- 23:55 from qualifying ten minutes later, after midnight.
--
-- A referral is recorded when a player less than 24 hours old looks up a friend
-- code or joins a friend room by its code (the game function calls
-- referral_attach from those two paths). The first one recorded wins. Bots are
-- never either side, and a pair can only point one way.
--
-- Every rule lives here, so the edge function only calls these functions and the
-- numbers can be tuned without a deploy:
--
--   update app_config
--      set value = jsonb_set(value, '{economy,referral}',
--                            coalesce(value->'economy'->'referral', '{}') || '{"enabled": true}')
--    where key = 'default';
--
-- Coins go through wallet_apply with one ext_id per side, so a referral can
-- never pay twice. If an inviter has hit a cap, the friend is still paid and
-- only the inviter's share is skipped (status inviter_capped).

create table if not exists public.referrals (
  id              uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references auth.users (id) on delete cascade,
  invitee_user_id uuid not null unique references auth.users (id) on delete cascade,
  source          text not null check (source in ('code', 'room')),
  status          text not null default 'pending'
                    check (status in ('pending', 'rewarded', 'inviter_capped')),
  created_at      timestamptz not null default now(),
  qualified_at    timestamptz
);

create index if not exists referrals_inviter_idx on public.referrals (inviter_user_id, created_at);

-- Read only through the game function. No client policies on purpose.
alter table public.referrals enable row level security;

-- ---------------------------------------------------------------------------
-- Config: code defaults, overlaid with app_config.economy.referral
-- ---------------------------------------------------------------------------
create or replace function public.referral_config()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select '{"enabled": false, "inviterCoins": 200, "inviteeCoins": 100, "gamesRequired": 2,
           "attachWindowHours": 24, "minHoursSinceSignup": 8,
           "inviterWeeklyCap": 10, "inviterLifetimeCap": 25}'::jsonb
         || coalesce(
              (select case when jsonb_typeof(value->'economy'->'referral') = 'object'
                           then value->'economy'->'referral' end
                 from app_config where key = 'default'),
              '{}'::jsonb);
$$;

-- ---------------------------------------------------------------------------
-- Record a referral
-- ---------------------------------------------------------------------------
create or replace function public.referral_attach(
  p_invitee uuid,
  p_inviter uuid,
  p_source  text,
  p_now     timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg      jsonb := public.referral_config();
  no       constant jsonb := '{"attached": false}';
  signed   timestamptz;
  inserted int;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return no; end if;
  if p_invitee is null or p_inviter is null or p_invitee = p_inviter then return no; end if;
  if p_source is null or p_source not in ('code', 'room') then return no; end if;

  select created_at into signed from auth.users where id = p_invitee;
  if signed is null
     or signed < p_now - make_interval(hours => (cfg->>'attachWindowHours')::int) then
    return no;
  end if;
  if not exists (select 1 from auth.users where id = p_inviter) then return no; end if;
  if exists (select 1 from bot_identities where user_id in (p_invitee, p_inviter)) then return no; end if;
  -- A pair only ever points one way.
  if exists (select 1 from referrals
              where inviter_user_id = p_invitee and invitee_user_id = p_inviter) then
    return no;
  end if;

  insert into referrals (inviter_user_id, invitee_user_id, source, created_at)
  values (p_inviter, p_invitee, p_source, p_now)
  on conflict (invitee_user_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return no; end if;

  return jsonb_build_object(
    'attached', true,
    'inviteeCoins', (cfg->>'inviteeCoins')::int,
    'gamesRequired', (cfg->>'gamesRequired')::int);
end;
$$;

-- ---------------------------------------------------------------------------
-- Pay a referral once the invitee qualifies
-- ---------------------------------------------------------------------------
create or replace function public.referral_settle(
  p_invitee uuid,
  p_now     timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg          jsonb := public.referral_config();
  no           constant jsonb := '{"paid": false}';
  r            referrals%rowtype;
  signed       timestamptz;
  played       int;
  weekly       int;
  total        int;
  inviter_ok   boolean;
  invitee_coins int := (cfg->>'inviteeCoins')::int;
  inviter_coins int := (cfg->>'inviterCoins')::int;
  balance_after int;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return no; end if;

  select * into r from referrals
   where invitee_user_id = p_invitee and status = 'pending'
     for update;
  if not found then return no; end if;

  select games_played into played from player_stats where user_id = p_invitee;
  if coalesce(played, 0) < (cfg->>'gamesRequired')::int then return no; end if;

  select created_at into signed from auth.users where id = p_invitee;
  if signed is null then return no; end if;
  if (p_now at time zone 'Asia/Kathmandu')::date <= (signed at time zone 'Asia/Kathmandu')::date then
    return no;
  end if;
  if p_now - signed < make_interval(hours => (cfg->>'minHoursSinceSignup')::int) then
    return no;
  end if;

  balance_after := public.wallet_apply(p_invitee, invitee_coins, 'referral-invitee', null,
    'earned', 'referral:' || r.id || ':invitee');
  if balance_after is null then raise exception 'Referral reward could not be credited'; end if;

  select count(*) filter (where qualified_at > p_now - interval '7 days'), count(*)
    into weekly, total
    from referrals
   where inviter_user_id = r.inviter_user_id and status = 'rewarded';
  inviter_ok := weekly < (cfg->>'inviterWeeklyCap')::int
            and total < (cfg->>'inviterLifetimeCap')::int;

  if inviter_ok then
    balance_after := public.wallet_apply(r.inviter_user_id, inviter_coins, 'referral-inviter', null,
      'earned', 'referral:' || r.id || ':inviter');
    if balance_after is null then raise exception 'Referral reward could not be credited'; end if;
  end if;

  update referrals
     set status = case when inviter_ok then 'rewarded' else 'inviter_capped' end,
         qualified_at = p_now
   where id = r.id;

  return jsonb_build_object(
    'paid', true,
    'referralId', r.id,
    'inviterUserId', r.inviter_user_id,
    'inviteeUserId', p_invitee,
    'inviterPaid', inviter_ok,
    'inviterCoins', inviter_coins,
    'inviteeCoins', invitee_coins);
end;
$$;

-- ---------------------------------------------------------------------------
-- What the invite card shows
-- ---------------------------------------------------------------------------
-- `invited`: everyone this player brought, newest first. `invitedBy`: who
-- brought this player, if anyone. Names and avatars are the OTHER player's;
-- games are always the invitee's. Bots cannot appear: they are never recorded.
create or replace function public.referral_list(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with cfg as (select public.referral_config() as c),
  mine as (
    select r.*,
           case when r.inviter_user_id = p_user then r.invitee_user_id else r.inviter_user_id end as other_id,
           coalesce(ps.games_played, 0) as played
      from referrals r
      left join player_stats ps on ps.user_id = r.invitee_user_id
     where r.inviter_user_id = p_user or r.invitee_user_id = p_user
  ),
  items as (
    select mine.inviter_user_id, mine.invitee_user_id, mine.created_at,
           jsonb_build_object(
             'id', mine.id,
             'name', p.display_name,
             'avatarId', p.avatar_id,
             'gamesPlayed', least(mine.played, (cfg.c->>'gamesRequired')::int),
             'state', case mine.status
                        when 'rewarded' then 'rewarded'
                        when 'inviter_capped' then 'capped'
                        else case when mine.played < (cfg.c->>'gamesRequired')::int
                                  then 'playing' else 'nextDay' end
                      end,
             'rewardedAt', mine.qualified_at) as item
      from mine
      cross join cfg
      left join profiles p on p.user_id = mine.other_id
  )
  select jsonb_build_object(
    'config', (select jsonb_build_object(
                 'enabled', coalesce((c->>'enabled')::boolean, false),
                 'inviterCoins', (c->>'inviterCoins')::int,
                 'inviteeCoins', (c->>'inviteeCoins')::int,
                 'gamesRequired', (c->>'gamesRequired')::int) from cfg),
    'invited', coalesce((select jsonb_agg(item order by created_at desc)
                           from items where inviter_user_id = p_user), '[]'::jsonb),
    'invitedBy', (select item from items where invitee_user_id = p_user));
$$;

-- ---------------------------------------------------------------------------
-- Grants: the game function (service_role) only
-- ---------------------------------------------------------------------------
revoke all on function public.referral_config() from public, anon, authenticated;
revoke all on function public.referral_attach(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.referral_settle(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.referral_list(uuid) from public, anon, authenticated;
grant execute on function public.referral_config() to service_role;
grant execute on function public.referral_attach(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.referral_settle(uuid, timestamptz) to service_role;
grant execute on function public.referral_list(uuid) to service_role;
