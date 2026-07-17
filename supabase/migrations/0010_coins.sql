-- Coins economy. Server-authoritative: clients may only READ their own wallet
-- and ledger; every mutation goes through the edge function (service role) via
-- wallet_apply, so a client can't mint or duplicate coins.
--
-- Rules (v1): new wallets start at 500. Quick match stakes 100 a head, winner
-- takes the pot. A balance below the 100 floor is topped back up to 100 on
-- request (server-guarded), so a player can always afford the next game.

create table if not exists public.wallets (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    int not null default 500 check (balance >= 0),
  updated_at timestamptz not null default now()
);
alter table public.wallets enable row level security;
drop policy if exists "wallets: self read" on public.wallets;
create policy "wallets: self read"
  on public.wallets for select to authenticated using (user_id = auth.uid());
-- no insert/update/delete policies: service-role only

create table if not exists public.wallet_txns (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  delta      int not null,
  reason     text not null,
  game_id    uuid,
  created_at timestamptz not null default now()
);
create index if not exists wallet_txns_user_idx on public.wallet_txns (user_id, created_at desc);
alter table public.wallet_txns enable row level security;
drop policy if exists "txns: self read" on public.wallet_txns;
create policy "txns: self read"
  on public.wallet_txns for select to authenticated using (user_id = auth.uid());

alter table public.games add column if not exists stake int not null default 0;
-- One-shot payout latch: the settle path CAS-claims it, so racing finishers
-- (opTurn vs bot driver vs opLeave) can never pay a pot twice.
alter table public.games add column if not exists payout_done boolean not null default false;

-- Apply a delta atomically: upsert-default the wallet, guard against going
-- negative, and append the ledger row in the same transaction. Returns the new
-- balance, or null when the debit would overdraw (caller surfaces the error).
create or replace function public.wallet_apply(p_user uuid, p_delta int, p_reason text, p_game uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance int;
begin
  insert into wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  update wallets
     set balance = balance + p_delta, updated_at = now()
   where user_id = p_user and balance + p_delta >= 0
   returning balance into new_balance;
  if new_balance is null then
    return null;
  end if;
  insert into wallet_txns (user_id, delta, reason, game_id)
    values (p_user, p_delta, p_reason, p_game);
  return new_balance;
end;
$$;

revoke all on function public.wallet_apply(uuid, int, text, uuid) from public, anon, authenticated;
grant execute on function public.wallet_apply(uuid, int, text, uuid) to service_role;
