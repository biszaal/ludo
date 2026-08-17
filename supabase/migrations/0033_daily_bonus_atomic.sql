-- Daily bonus: one transaction instead of two round trips.
--
-- The edge function used to CAS `last_bonus_on` to today and THEN call
-- wallet_apply. Three things went wrong with that:
--
--   1. The CAS burned the day before the coins existed. If the credit failed,
--      the player had spent their claim and got nothing, with no retry path —
--      the next call short-circuits on "already claimed today".
--   2. The credit carried no ext_id, so it was the one balance change in the
--      app that was not replay-guarded.
--   3. walletApply returns null on RPC failure and the response fell back to
--      `balance ?? w.balance` — the PRE-bonus balance — while still reporting
--      `claimed: 50`. The UI celebrated and the number never moved. That is the
--      "I claimed the daily bonus and my coins didn't go up" report.
--
-- Doing both halves in one plpgsql function makes the failure atomic: either
-- the day is claimed and the coins are in the ledger, or neither happened.
-- The ext_id stays as a second line of defence for retries at the HTTP layer.

create or replace function public.daily_bonus_claim(
  p_user  uuid,
  p_base  int,
  p_step  int,
  p_max   int
)
returns table (balance int, streak_day int, claimed int, already boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  today      date := (now() at time zone 'utc')::date;
  prev_day   date;
  prev_streak int;
  new_streak int;
  amount     int;
  new_balance int;
begin
  insert into wallets (user_id) values (p_user) on conflict (user_id) do nothing;

  -- Lock the row for the whole claim. Two taps racing (or a retry overlapping
  -- the original) serialize here instead of both reading "not claimed yet".
  select w.last_bonus_on, w.streak_day, w.balance
    into prev_day, prev_streak, new_balance
    from wallets w
   where w.user_id = p_user
     for update;

  if prev_day = today then
    return query select new_balance, prev_streak, 0, true;
    return;
  end if;

  -- Consecutive only if yesterday's claim is the last one on record.
  new_streak := case
    when prev_day = today - 1 then least(prev_streak + 1, p_max)
    else 1
  end;

  amount := p_base + p_step * (new_streak - 1);

  update wallets
     set last_bonus_on = today,
         streak_day    = new_streak,
         balance       = balance + amount,
         updated_at    = now()
   where user_id = p_user
   returning wallets.balance into new_balance;

  insert into wallet_txns (user_id, delta, reason, game_id, bucket, ext_id)
  values (p_user, amount, 'daily-bonus', null, 'earned',
          'daily:' || p_user::text || ':' || today::text);

  return query select new_balance, new_streak, amount, false;
exception
  when unique_violation then
    -- Another writer already banked today's bonus under the same ext_id. The
    -- whole block rolls back, so report the settled state rather than a claim.
    select w.balance, w.streak_day into new_balance, new_streak
      from wallets w where w.user_id = p_user;
    return query select new_balance, new_streak, 0, true;
end;
$$;

revoke all on function public.daily_bonus_claim(uuid, int, int, int) from public, anon, authenticated;
grant execute on function public.daily_bonus_claim(uuid, int, int, int) to service_role;
