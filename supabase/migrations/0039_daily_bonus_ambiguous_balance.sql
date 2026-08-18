-- The daily bonus never paid out: "column reference balance is ambiguous".
--
-- 0033 moved the claim into one transaction, and in doing so gave the function
-- `returns table (balance int, streak_day int, claimed int, already boolean)`.
-- Those output columns are also PL/pgSQL variables in scope for the whole body,
-- so the credit
--
--   update wallets set balance = balance + amount ...
--
-- had two candidates for the `balance` on the RIGHT: the OUT parameter and
-- wallets.balance. Postgres will not guess, and raised 42702 every single time.
-- The LEFT side is fine — a SET target can only be a column — which is why this
-- reads as correct at a glance.
--
-- opDailyBonus turns any RPC error into "Could not claim the bonus. Try again.",
-- and the client turned that into a connection warning, so the real message
-- never surfaced: the bonus had been failing for every player, on every day,
-- since 0033 was applied.
--
-- Every other reference in the function was already alias-qualified (w.balance,
-- wallets.balance in the RETURNING), which is why only this one line broke.

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

  select w.last_bonus_on, w.streak_day, w.balance
    into prev_day, prev_streak, new_balance
    from wallets w
   where w.user_id = p_user
     for update;

  if prev_day = today then
    return query select new_balance, prev_streak, 0, true;
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

  return query select new_balance, new_streak, amount, false;
exception
  when unique_violation then
    select w.balance, w.streak_day into new_balance, new_streak
      from wallets w where w.user_id = p_user;
    return query select new_balance, new_streak, 0, true;
end;
$$;

revoke all on function public.daily_bonus_claim(uuid, int, int, int) from public, anon, authenticated;
grant execute on function public.daily_bonus_claim(uuid, int, int, int) to service_role;
