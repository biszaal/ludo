-- Gems: the premium currency, plus stake-tiered quick match.
--
-- Gems are deliberately scarce: they arrive only via real-money purchase
-- (two-phase iap_purchases below; a stub provider until real billing ships)
-- or future rare grants. They leave via the premium cosmetics tier and a
-- ONE-WAY gems→coins exchange. There is intentionally no coins→gems path —
-- earned coins can never launder into premium currency.
--
-- FAIRNESS INVARIANT (unchanged from 0013, restated because money is now
-- directly involved): gems buy ACCESS and APPEARANCE only. No SKU kind
-- exists that can touch a match outcome, and adding one is a design smell,
-- not a schema change.

-- 1. Gems balance + ledger ----------------------------------------------------
alter table public.wallets add column if not exists gems int not null default 0 check (gems >= 0);

create table if not exists public.gem_txns (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  delta      int  not null,
  reason     text not null,
  ext_id     text,
  created_at timestamptz not null default now()
);
create unique index if not exists gem_txns_ext_id_uidx on public.gem_txns (ext_id) where ext_id is not null;
create index if not exists gem_txns_user_idx on public.gem_txns (user_id, created_at desc);
alter table public.gem_txns enable row level security;
drop policy if exists "gem_txns: self read" on public.gem_txns;
create policy "gem_txns: self read"
  on public.gem_txns for select to authenticated using (user_id = auth.uid());
-- no write policies: edge function (service role) only

-- 2. gem_apply ----------------------------------------------------------------
-- A NEW function, not a wallet_apply overload: gems have no earned/purchased
-- buckets, and the coin pair's 4/6-arg signatures stay untouched. Same replay
-- guard (ext_id pre-check + unique-index backstop) and overdraw discipline.
create or replace function public.gem_apply(
  p_user   uuid,
  p_delta  int,
  p_reason text,
  p_ext_id text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_gems int;
begin
  insert into wallets (user_id) values (p_user) on conflict (user_id) do nothing;

  if p_ext_id is not null and exists (select 1 from gem_txns where ext_id = p_ext_id) then
    select gems into new_gems from wallets where user_id = p_user;
    return new_gems;
  end if;

  update wallets
     set gems       = gems + p_delta,
         updated_at = now()
   where user_id = p_user and gems + p_delta >= 0
   returning gems into new_gems;

  if new_gems is null then
    return null;  -- overdraw; caller surfaces the error
  end if;

  insert into gem_txns (user_id, delta, reason, ext_id)
    values (p_user, p_delta, p_reason, p_ext_id);
  return new_gems;
exception
  when unique_violation then
    select gems into new_gems from wallets where user_id = p_user;
    return new_gems;
end;
$$;

revoke all on function public.gem_apply(uuid, int, text, text) from public, anon, authenticated;
grant execute on function public.gem_apply(uuid, int, text, text) to service_role;

-- 3. gems_exchange ------------------------------------------------------------
-- One-way gems→coins, both legs in one transaction. Coins minted from gems
-- are money-backed, so they land in the 'purchased' bucket. The two ledgers
-- get distinct ext_id suffixes so each unique index sees its own key.
create or replace function public.gems_exchange(
  p_user   uuid,
  p_gems   int,
  p_rate   int,
  p_ext_id text
)
returns table (gems int, balance int)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_gems int;
  new_balance int;
begin
  if p_gems <= 0 or p_rate <= 0 then
    raise exception 'gems_exchange: bad args';
  end if;

  new_gems := public.gem_apply(p_user, -p_gems, 'exchange', p_ext_id || ':g');
  if new_gems is null then
    raise exception 'gems_exchange: insufficient gems';
  end if;

  new_balance := public.wallet_apply(p_user, p_gems * p_rate, 'gem-exchange', null, 'purchased', p_ext_id || ':c');
  return query select new_gems, new_balance;
end;
$$;

revoke all on function public.gems_exchange(uuid, int, int, text) from public, anon, authenticated;
grant execute on function public.gems_exchange(uuid, int, int, text) to service_role;

-- 4. IAP purchases (two-phase, stub-ready) -------------------------------------
-- Modeled on ad_rewards: the server mints the row, the credit happens through
-- gem_apply with an ext_id derived from it. A real StoreKit/Play receipt later
-- fills provider/provider_txn_id and uses the exact same credit path — only
-- the verification step changes.
create table if not exists public.iap_purchases (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  product_id      text not null,
  gems            int  not null check (gems > 0),
  provider        text not null default 'stub' check (provider in ('stub', 'appstore', 'play')),
  provider_txn_id text,
  status          text not null default 'pending' check (status in ('pending', 'credited', 'failed')),
  created_at      timestamptz not null default now(),
  credited_at     timestamptz
);
create unique index if not exists iap_provider_txn_uidx
  on public.iap_purchases (provider, provider_txn_id) where provider_txn_id is not null;
alter table public.iap_purchases enable row level security;
drop policy if exists "iap_purchases: self read" on public.iap_purchases;
create policy "iap_purchases: self read"
  on public.iap_purchases for select to authenticated using (user_id = auth.uid());
-- no write policies: edge function (service role) only

-- 5. Stake-tiered quick match --------------------------------------------------
-- Pools separate by stake exactly the way they already separate by size. The
-- 2-arg signature stays as a wrapper (default tier) so the currently-deployed
-- edge function keeps working between this migration and the next deploy;
-- drop it in a later cleanup migration.
create or replace function public.quick_match_claim(p_user uuid, p_size int, p_stake int)
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
     and g.stake = p_stake
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

create or replace function public.quick_match_claim(p_user uuid, p_size int)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.quick_match_claim(p_user, p_size, 100);
$$;

revoke all on function public.quick_match_claim(uuid, int, int) from public, anon, authenticated;
grant execute on function public.quick_match_claim(uuid, int, int) to service_role;

create index if not exists games_quick_pool_idx
  on public.games (quick_size, stake) where status = 'waiting' and is_quick;

-- 6. Currency-aware catalog ----------------------------------------------------
alter table public.catalog add column if not exists currency text not null default 'coins'
  check (currency in ('coins', 'gems'));

alter table public.entitlements drop constraint if exists entitlements_source_check;
alter table public.entitlements add constraint entitlements_source_check
  check (source in ('coins', 'grant', 'iap', 'gems'));

-- 7. Premium seed --------------------------------------------------------------
-- The showcase tier: one dice skin, one board theme, two avatars, priced in
-- gems. Mirrors the client registries (render/diceSkins.ts, render/
-- boardThemes.ts, render/avatars.ts) — parity is test-enforced.
insert into public.catalog (sku, kind, price, currency, active) values
  ('dice.prism',    'dice',   150, 'gems', true),
  ('theme.aurora',  'theme',  250, 'gems', true),
  ('avatar.nova',   'avatar', 100, 'gems', true),
  ('avatar.onyx',   'avatar', 100, 'gems', true)
on conflict (sku) do nothing;

-- 8. Config seed ---------------------------------------------------------------
-- purchasesEnabled stays FALSE until real billing ships: the stub provider
-- must never mint unpaid gems in production. allowStubProvider is the second,
-- server-only lock for internal testing.
update public.app_config
   set value = value
       || jsonb_build_object('gems', jsonb_build_object(
            'enabled', true,
            'purchasesEnabled', false,
            'allowStubProvider', false,
            'exchangeRate', 10,
            'exchangeMin', 10,
            'products', jsonb_build_array(
              jsonb_build_object('id', 'gems.small',  'gems', 60,  'priceUsd', 0.99),
              jsonb_build_object('id', 'gems.medium', 'gems', 340, 'priceUsd', 4.99),
              jsonb_build_object('id', 'gems.large',  'gems', 750, 'priceUsd', 9.99)
            )
          )),
       updated_at = now()
 where key = 'default' and not (value ? 'gems');

update public.app_config
   set value = jsonb_set(value, '{economy,stakeTiers}', '[100, 1000, 10000]'::jsonb),
       updated_at = now()
 where key = 'default' and not (value -> 'economy' ? 'stakeTiers');
