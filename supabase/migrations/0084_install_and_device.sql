-- 0084: where an Android install came from, and one referral payout per phone.
--
-- Plan: docs/superpowers/plans/2026-11-21-release-1-3-2.md
--
-- install_sources: the Play install referrer, read once on first launch. Only
-- the utm fields and an optional friend code are kept. A friend code that
-- belongs to another player records a referral with source 'link', the same
-- way typing the code in Add Friend does ('code').
--
-- user_devices: a SHA-256 of a device ID (the game function hashes it; the raw
-- ID never reaches the database). It is used for one thing only: a referral is
-- rejected, with nothing paid, when the invitee's phone was already used by the
-- inviter, or by another invitee whose referral already paid. Normal play never
-- looks at it. Apps older than 1.3.2 send no hash, so the rule passes them.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.install_sources (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  platform     text not null check (platform in ('android', 'ios')),
  referrer     text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  friend_code  text,
  created_at   timestamptz not null default now()
);
alter table public.install_sources enable row level security;

create table if not exists public.user_devices (
  user_id     uuid not null references auth.users (id) on delete cascade,
  device_hash text not null check (device_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  primary key (user_id, device_hash)
);
create index if not exists user_devices_hash_idx on public.user_devices (device_hash);
alter table public.user_devices enable row level security;

-- ---------------------------------------------------------------------------
-- referrals: a 'link' source and a 'rejected' status
-- ---------------------------------------------------------------------------
alter table public.referrals drop constraint if exists referrals_source_check;
alter table public.referrals add constraint referrals_source_check
  check (source in ('code', 'room', 'link'));
alter table public.referrals drop constraint if exists referrals_status_check;
alter table public.referrals add constraint referrals_status_check
  check (status in ('pending', 'rewarded', 'inviter_capped', 'rejected'));

-- As 0082, with 'link' accepted.
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
  if p_source is null or p_source not in ('code', 'room', 'link') then return no; end if;

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
-- Record the install source (once per account)
-- ---------------------------------------------------------------------------
create or replace function public.install_source_record(
  p_user         uuid,
  p_platform     text,
  p_referrer     text,
  p_utm_source   text,
  p_utm_medium   text,
  p_utm_campaign text,
  p_friend_code  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  none     constant jsonb := '{"attached": false}';
  friend   text := nullif(upper(btrim(coalesce(p_friend_code, ''))), '');
  owner    uuid;
  inserted int;
  referral jsonb := none;
begin
  if p_user is null or coalesce(p_platform, '') not in ('android', 'ios') then
    return jsonb_build_object('recorded', false, 'referral', none);
  end if;
  if not exists (select 1 from auth.users where id = p_user)
     or exists (select 1 from bot_identities where user_id = p_user) then
    return jsonb_build_object('recorded', false, 'referral', none);
  end if;

  insert into install_sources (user_id, platform, referrer, utm_source, utm_medium, utm_campaign, friend_code)
  values (p_user, p_platform,
          nullif(left(btrim(coalesce(p_referrer, '')), 200), ''),
          nullif(left(btrim(coalesce(p_utm_source, '')), 200), ''),
          nullif(left(btrim(coalesce(p_utm_medium, '')), 200), ''),
          nullif(left(btrim(coalesce(p_utm_campaign, '')), 200), ''),
          left(friend, 200))
  on conflict (user_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    return jsonb_build_object('recorded', false, 'referral', none);
  end if;

  if friend is not null then
    select fc.user_id into owner from friend_codes fc where fc.code = friend;
    if owner is not null and owner <> p_user then
      referral := public.referral_attach(p_user, owner, 'link');
    end if;
  end if;

  return jsonb_build_object('recorded', true, 'referral', referral);
end;
$$;

-- ---------------------------------------------------------------------------
-- Record a device hash for an account
-- ---------------------------------------------------------------------------
create or replace function public.device_record(p_user uuid, p_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted int;
begin
  if p_user is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  if not exists (select 1 from auth.users where id = p_user)
     or exists (select 1 from bot_identities where user_id = p_user) then
    return false;
  end if;
  -- One phone per account is normal; ten is a bound on a misbehaving client.
  if (select count(*) from user_devices where user_id = p_user) >= 10 then return false; end if;

  insert into user_devices (user_id, device_hash) values (p_user, p_hash)
  on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- referral_settle: as 0082, plus the device rule before anything is paid
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
  cfg           jsonb := public.referral_config();
  no            constant jsonb := '{"paid": false}';
  r             referrals%rowtype;
  signed        timestamptz;
  played        int;
  weekly        int;
  total         int;
  inviter_ok    boolean;
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

  -- Came back on a later Nepal day, and at least minHoursSinceSignup later.
  select created_at into signed from auth.users where id = p_invitee;
  if signed is null then return no; end if;
  if (p_now at time zone 'Asia/Kathmandu')::date <= (signed at time zone 'Asia/Kathmandu')::date then
    return no;
  end if;
  if p_now - signed < make_interval(hours => (cfg->>'minHoursSinceSignup')::int) then
    return no;
  end if;

  -- One payout per phone: the inviter's own phone, or a phone that already
  -- earned an invitee reward, settles the referral with nothing paid.
  if exists (select 1
               from user_devices mine
               join user_devices theirs on theirs.device_hash = mine.device_hash
              where mine.user_id = p_invitee
                and theirs.user_id = r.inviter_user_id)
     or exists (select 1
                  from user_devices mine
                  join user_devices theirs on theirs.device_hash = mine.device_hash
                                          and theirs.user_id <> p_invitee
                  join referrals paid on paid.invitee_user_id = theirs.user_id
                                     and paid.status in ('rewarded', 'inviter_capped')
                 where mine.user_id = p_invitee) then
    update referrals set status = 'rejected', qualified_at = p_now where id = r.id;
    return '{"paid": false, "rejected": true}'::jsonb;
  end if;

  balance_after := public.wallet_apply(p_invitee, invitee_coins, 'referral-invitee', null, 'earned',
                                       'referral:' || r.id || ':invitee');
  if balance_after is null then raise exception 'Referral reward could not be credited'; end if;

  select count(*) filter (where qualified_at > p_now - interval '7 days'), count(*)
    into weekly, total
    from referrals
   where inviter_user_id = r.inviter_user_id and status = 'rewarded';
  inviter_ok := weekly < (cfg->>'inviterWeeklyCap')::int
            and total < (cfg->>'inviterLifetimeCap')::int;

  if inviter_ok then
    balance_after := public.wallet_apply(r.inviter_user_id, inviter_coins, 'referral-inviter', null, 'earned',
                                         'referral:' || r.id || ':inviter');
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
-- referral_list: as 0082, with rejected referrals left off the card. Showing
-- them would say exactly which rule a farmer tripped.
-- ---------------------------------------------------------------------------
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
     where (r.inviter_user_id = p_user or r.invitee_user_id = p_user)
       and r.status <> 'rejected'
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
revoke all on function public.install_source_record(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.device_record(uuid, text) from public, anon, authenticated;
revoke all on function public.referral_attach(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.referral_settle(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.referral_list(uuid) from public, anon, authenticated;
grant execute on function public.install_source_record(uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.device_record(uuid, text) to service_role;
grant execute on function public.referral_attach(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.referral_settle(uuid, timestamptz) to service_role;
grant execute on function public.referral_list(uuid) to service_role;
