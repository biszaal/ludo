-- The day-7 gem bonus was paying every day, forever.
--
-- The streak clamps rather than climbing: `least(prev_streak + 1, p_max)` with
-- p_max = 7. So a player who keeps claiming reaches 7 and STAYS at 7 for as
-- long as they keep showing up. The gem finale in opDailyBonus fires on
-- `streak === gemDay`, which is therefore true every single day from then on,
-- and its replay guard is keyed per DAY (`daily-gems:<user>:<date>`) — so each
-- new day is a new key and pays again.
--
-- Found 2026-08-30. Two users had reached the finale; between them they had
-- collected it 9 times for 45 gems, one of them 7 times. At 60 gems for $0.99
-- that is a paid pack roughly every twelve days, free — against a rewarded-ad
-- grant that is capped at 2 gems and gated behind five ad views a day.
--
-- THE CLAMP STAYS. It was a deliberate choice and it is the reason a loyal
-- player keeps earning 200 coins a day; resetting the streak to 1 would cut
-- that to 50 and punish exactly the players worth keeping. Only the GEM half
-- is wrong, and only in one respect: it should pay when the streak ARRIVES at
-- the finale, not while it sits there.
--
-- Which the caller cannot currently tell. `streak_day` comes back as 7 whether
-- this claim moved it there or it was already 7 yesterday, and with the clamp
-- the run length is not recoverable from the streak either (at 7 for the tenth
-- day running, `today - 6` is not when the run began). So the function has to
-- say. It now also returns the streak as it was BEFORE this claim, and
-- economy.ts pays the finale only on a genuine 6 -> 7 transition.
--
-- Nothing is clawed back. The 45 gems already paid stay paid.
--
-- ROLLBACK: restore the 4-column signature from 0039 and drop the extra
-- column's use in economy.ts. Re-apply the grants in section 2 either way.

-- ---------------------------------------------------------------------------
-- 1. The function
-- ---------------------------------------------------------------------------
-- DROP first: `create or replace` cannot change a function's return type, and
-- this adds a column to the returned table. Safe — nothing but the edge
-- function calls it, and the drop and create are one transaction.
--
-- Adding a column is backward-compatible for the CURRENTLY DEPLOYED edge
-- function, which reads balance/streak_day/claimed/already by name and ignores
-- anything extra. So this migration is safe to apply before its deploy.
drop function if exists public.daily_bonus_claim(uuid, integer, integer, integer);

create function public.daily_bonus_claim(p_user uuid, p_base int, p_step int, p_max int)
returns table (balance int, streak_day int, claimed int, already boolean, prev_streak_day int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  today       date := (now() at time zone 'utc')::date;
  prev_day    date;
  prev_streak int;
  new_streak  int;
  amount      int;
  new_balance int;
begin
  insert into wallets (user_id) values (p_user) on conflict (user_id) do nothing;

  select w.last_bonus_on, w.streak_day, w.balance
    into prev_day, prev_streak, new_balance
    from wallets w
   where w.user_id = p_user
     for update;

  -- Already claimed today. Nothing moved, so the previous streak IS the
  -- current one — which reads as "did not arrive at the finale" downstream.
  if prev_day = today then
    return query select new_balance, prev_streak, 0, true, prev_streak;
    return;
  end if;

  new_streak := case
    when prev_day = today - 1 then least(prev_streak + 1, p_max)
    else 1
  end;

  amount := p_base + p_step * (new_streak - 1);

  update wallets
     set last_bonus_on = today,
         streak_day    = new_streak,
         -- Qualified: bare `balance` here is ambiguous with the OUT parameter.
         balance       = wallets.balance + amount,
         updated_at    = now()
   where wallets.user_id = p_user
   returning wallets.balance into new_balance;

  insert into wallet_txns (user_id, delta, reason, game_id, bucket, ext_id)
  values (p_user, amount, 'daily-bonus', null, 'earned',
          'daily:' || p_user::text || ':' || today::text);

  return query select new_balance, new_streak, amount, false, prev_streak;
exception
  when unique_violation then
    -- A concurrent claim won the day. Report the settled state, and report the
    -- streak as unchanged by US so the finale cannot be paid twice by a race.
    select w.balance, w.streak_day into new_balance, new_streak
      from wallets w where w.user_id = p_user;
    return query select new_balance, new_streak, 0, true, new_streak;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Grants — re-applied, because DROP took them with it
-- ---------------------------------------------------------------------------
-- This is the 0024 lesson in its most easily-missed form. Dropping a function
-- discards its ACL, and Supabase's default privileges hand a freshly created
-- one straight back to anon and authenticated. Recreating a SECURITY DEFINER
-- function that moves currency without restating this would quietly publish it
-- at /rest/v1/rpc/daily_bonus_claim, where anyone signed in could mint their
-- own bonus.
--
-- Note the grammar 0026 had to learn: revoking from PUBLIC does not remove
-- Supabase's explicit role grants. The roles must be named.
revoke all on function public.daily_bonus_claim(uuid, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.daily_bonus_claim(uuid, integer, integer, integer)
  to service_role;
