-- Two per-call round trips the hot paths were paying for no reason.

-- ---------------------------------------------------------------------------
-- 1. games.has_bots — "does this room contain a server-driven seat?"
-- ---------------------------------------------------------------------------
-- afterGameWrite runs after EVERY write in a quick game and its first act is a
-- game_bots lookup, purely to discover there are no bots (which is the case for
-- every quick game that paired two humans). One boolean on the row the caller
-- has already fetched answers it for free.
--
-- Maintained by trigger rather than by the edge function: bot seating happens
-- in one place today, but a flag that can silently go stale is worse than the
-- query it replaces. Fires once per bot seated, never on the turn path.
--
-- Secrecy note (0009): this column IS client-readable, unlike game_bots. It
-- says a room has at least one server-driven seat, never which one — and a
-- client can only read rooms it sits in (0019). Knowing "someone here is a
-- bot" without knowing who is not a tell the UI exposes anywhere.
alter table public.games add column if not exists has_bots boolean not null default false;

create or replace function public.mark_game_has_bots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update games set has_bots = true where id = new.game_id and not has_bots;
  return new;
end;
$$;

drop trigger if exists game_bots_mark on public.game_bots;
create trigger game_bots_mark
  after insert on public.game_bots
  for each row execute function public.mark_game_has_bots();

-- A trigger runs as the table owner and needs no EXECUTE grant, but PostgREST
-- exposes every public function as an RPC — so without this the definer
-- function shows up at /rest/v1/rpc/mark_game_has_bots. Calling it there fails
-- regardless (Postgres won't run a trigger function outside a trigger); this
-- just stops it appearing as an anon-callable definer function in the linter.
revoke all on function public.mark_game_has_bots() from public, anon, authenticated;

-- Backfill rooms seated before the column existed.
update public.games g
   set has_bots = true
 where not g.has_bots
   and exists (select 1 from public.game_bots b where b.game_id = g.id);

-- ---------------------------------------------------------------------------
-- 2. wallet_read — one round trip instead of two
-- ---------------------------------------------------------------------------
-- Every wallet read in the edge function was an upsert (create-if-missing)
-- followed by a select. The upsert exists because a wallet row is created
-- lazily on first read; folding both into one definer function halves the
-- round trips on the wallet/shop/daily-bonus paths.
create or replace function public.wallet_read(p_user uuid)
returns table (
  balance           int,
  purchased_balance int,
  gems              int,
  last_bonus_on     date,
  streak_day        int,
  last_pity_at      timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  return query
    select w.balance, w.purchased_balance, w.gems, w.last_bonus_on, w.streak_day, w.last_pity_at
      from wallets w
     where w.user_id = p_user;
end;
$$;

revoke all on function public.wallet_read(uuid) from public, anon, authenticated;
grant execute on function public.wallet_read(uuid) to service_role;
