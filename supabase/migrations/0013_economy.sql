-- Economy rework: turn coins into a real currency.
--
-- 0010 shipped a closed loop with an unlimited free faucet — any balance under
-- 100 was topped back up on request, so coins could never run out and there was
-- nothing to earn them FOR. This replaces the faucet with real sources (daily
-- bonus, rewarded ads) and real sinks (cosmetics), and lays the ledger
-- groundwork for coin-pack IAP.
--
-- FAIRNESS INVARIANT (product rule, enforced in app + edge function):
-- coins buy ACCESS (match entry) and APPEARANCE (themes, avatars) only. Nothing
-- purchasable may affect a match outcome. That is what keeps a coin-staked PvP
-- game defensible once coins are real-money purchasable.

-- 1. Purchased vs earned ------------------------------------------------------
-- Refunds and store review both need "did they spend money-backed coins?" to be
-- answerable. balance stays the single spendable total; purchased_balance is the
-- money-backed subset of it.
alter table public.wallets     add column if not exists purchased_balance int not null default 0 check (purchased_balance >= 0);
alter table public.wallet_txns add column if not exists bucket text not null default 'earned' check (bucket in ('earned', 'purchased'));
-- External idempotency key: AdMob SSV transaction_id, later the store txn id.
alter table public.wallet_txns add column if not exists ext_id text;
create unique index if not exists wallet_txns_ext_id_uidx on public.wallet_txns (ext_id) where ext_id is not null;

-- 2. Streak + pity state ------------------------------------------------------
alter table public.wallets add column if not exists last_bonus_on date;
alter table public.wallets add column if not exists streak_day    int not null default 0;
alter table public.wallets add column if not exists last_pity_at  timestamptz;

-- 3. wallet_apply, bucket-aware ----------------------------------------------
-- Deliberately a NEW 6-arg overload rather than a rewrite: Postgres overloads on
-- the argument list, so every existing 4-arg call site (stake, refund, win,
-- floor-topup) keeps working untouched. The old signature becomes a wrapper.
create or replace function public.wallet_apply(
  p_user   uuid,
  p_delta  int,
  p_reason text,
  p_game   uuid,
  p_bucket text,
  p_ext_id text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance   int;
  earned_avail  int;
  from_purchased int;
begin
  if p_bucket not in ('earned', 'purchased') then
    raise exception 'wallet_apply: bad bucket %', p_bucket;
  end if;

  insert into wallets (user_id) values (p_user) on conflict (user_id) do nothing;

  -- Replay guard. A retried SSV callback or store receipt must be a no-op, not
  -- a second credit. Cheap pre-check; the unique index is the real backstop.
  if p_ext_id is not null and exists (select 1 from wallet_txns where ext_id = p_ext_id) then
    select balance into new_balance from wallets where user_id = p_user;
    return new_balance;
  end if;

  if p_delta >= 0 then
    update wallets
       set balance           = balance + p_delta,
           purchased_balance = purchased_balance + case when p_bucket = 'purchased' then p_delta else 0 end,
           updated_at        = now()
     where user_id = p_user
     returning balance into new_balance;
  else
    -- Debits drain earned coins first, so money-backed coins are the last to
    -- go. Keeps the purchased tail meaningful for refund questions.
    select greatest(0, balance - purchased_balance) into earned_avail
      from wallets where user_id = p_user;
    from_purchased := greatest(0, (-p_delta) - earned_avail);

    update wallets
       set balance           = balance + p_delta,
           purchased_balance = greatest(0, purchased_balance - from_purchased),
           updated_at        = now()
     where user_id = p_user and balance + p_delta >= 0
     returning balance into new_balance;
  end if;

  if new_balance is null then
    return null;  -- overdraw; caller surfaces the error
  end if;

  insert into wallet_txns (user_id, delta, reason, game_id, bucket, ext_id)
    values (p_user, p_delta, p_reason, p_game, p_bucket, p_ext_id);
  return new_balance;
exception
  when unique_violation then
    -- Lost a race on ext_id: the other writer already credited it.
    select balance into new_balance from wallets where user_id = p_user;
    return new_balance;
end;
$$;

-- Old signature keeps working: plain earned coins, no external key.
create or replace function public.wallet_apply(p_user uuid, p_delta int, p_reason text, p_game uuid)
returns int
language sql
security definer
set search_path = public
as $$
  select public.wallet_apply(p_user, p_delta, p_reason, p_game, 'earned', null);
$$;

revoke all on function public.wallet_apply(uuid, int, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.wallet_apply(uuid, int, text, uuid, text, text) to service_role;

-- 4. Rewarded-ad grants -------------------------------------------------------
-- Two-phase so a client can never mint coins: the server mints an intent row
-- with the amount frozen, the client shows the ad, and AdMob's signed
-- server-side callback is what flips it to granted. id doubles as the SSV
-- custom_data nonce.
create table if not exists public.ad_rewards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  placement  text not null check (placement in ('coins', 'free-entry', 'double-pot')),
  coins      int  not null check (coins > 0),
  status     text not null default 'pending' check (status in ('pending', 'granted', 'expired')),
  game_id    uuid,
  txn_ext_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index if not exists ad_rewards_user_day_idx on public.ad_rewards (user_id, created_at desc);
alter table public.ad_rewards enable row level security;
drop policy if exists "ad_rewards: self read" on public.ad_rewards;
create policy "ad_rewards: self read"
  on public.ad_rewards for select to authenticated using (user_id = auth.uid());
-- no write policies: edge function (service role) only

-- 5. Cosmetics: catalog + entitlements ---------------------------------------
-- The sinks. Every SKU here is purely visual by rule — if one ever needs a
-- gameplay property, that is a design smell, not a schema change.
create table if not exists public.catalog (
  sku    text primary key,
  kind   text not null check (kind in ('theme', 'avatar', 'entitlement')),
  price  int  not null check (price >= 0),
  active boolean not null default true
);
alter table public.catalog enable row level security;
drop policy if exists "catalog: read" on public.catalog;
create policy "catalog: read"
  on public.catalog for select to authenticated using (true);

create table if not exists public.entitlements (
  user_id     uuid not null references auth.users(id) on delete cascade,
  sku         text not null,
  source      text not null default 'coins' check (source in ('coins', 'grant', 'iap')),
  acquired_at timestamptz not null default now(),
  primary key (user_id, sku)
);
alter table public.entitlements enable row level security;
drop policy if exists "entitlements: self read" on public.entitlements;
create policy "entitlements: self read"
  on public.entitlements for select to authenticated using (user_id = auth.uid());
-- no write policies: edge function (service role) only

-- Seed. Starter set is free so a new player always has choices; the rest are
-- the coin sink. Mirrors BOARD_THEMES (render/boardThemes.ts) and AVATARS
-- (components/Avatar.tsx) — keep in sync when art is added.
insert into public.catalog (sku, kind, price, active) values
  ('theme.classic',  'theme',  0,   true),
  ('theme.night',    'theme',  600, true),
  ('theme.walnut',   'theme',  600, true),
  ('theme.sand',     'theme',  600, true),
  ('avatar.leo',     'avatar', 0,   true),
  ('avatar.sunny',   'avatar', 0,   true),
  ('avatar.coco',    'avatar', 0,   true),
  ('avatar.zara',    'avatar', 0,   true),
  ('avatar.rex',     'avatar', 300, true),
  ('avatar.nina',    'avatar', 300, true),
  ('avatar.milo',    'avatar', 300, true),
  ('avatar.ivy',     'avatar', 300, true),
  ('avatar.ace',     'avatar', 500, true),
  ('avatar.ruby',    'avatar', 500, true),
  ('avatar.bruno',   'avatar', 500, true),
  ('avatar.kito',    'avatar', 500, true),
  -- Sellable later (Phase 8 IAP). Inactive now, but the entitlement is honored
  -- by the ad gates from day one so nothing needs rewiring when it flips on.
  ('noads',          'entitlement', 0, false)
on conflict (sku) do nothing;
